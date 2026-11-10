/*
(Repair 7) Repair branch, position 7 in the chain - the line-frame scanner inside the line builder (Repair 6).
This module scans a page's glyph positions and decides the text lines (the four-rule frame: rules, baseline, pitch). It is the JS twin of the Python scan_frame.py.
*/
// JS twin of B.Parser/main/Python/scan_frame.py — same API, same bytes.
//
// The parser exists in two languages by design, so this module does not
// shell out to Python and the Python module does not shell out to Node.
// Each is standalone.
//
// THE CONTRACT THAT KEEPS THEM 1:1
//   The two implementations must emit byte-identical SVG for the same
//   input. That is only possible if number formatting is pinned, because
//   the standard formatters disagree:
//
//       JS   (2.5).toFixed(0)      -> "3"      half away from zero
//       Py   f"{2.5:.0f}"          -> "2"      half to even
//       JS   String(12.0)          -> "12"
//       Py   str(12.0)             -> "12.0"
//
//   So both sides use fixed() and num() below and nowhere else.
//
// WHAT THIS FILE IS
//   frameOf / framesOf / pitchOf / blankOf / overflow / brokenByLine /
//   lineSvg / sheetSvg, and the four-rule frame: E = size / 2, rules at
//   b-2E, b-E, b, b+E, canvas locked to the page width.
//
//   The reasoning behind E, and the measurement that rejected per-font
//   coordinates, are in AGENT-NOTE-vector-svg.md.

export const BAND = 0.5;        // E as a fraction of size, calibrated on Myanmar3
export const MIN_PITCH = 2;     // below this, a gap is not between text lines
export const RULE_W = 0.5;      // stroke width of the three rules
export const BASE_W = 0.7;      // stroke width of the baseline rule

// ---------------------------------------------------------------------------
// number formatting — the parity contract, see the module header
// ---------------------------------------------------------------------------

export function fixed(v, digits = 2) {
  // Integer hundredths, rounded half away from zero. Matches Python fixed().
  const scale = 10 ** digits;
  const s = v < 0 ? -1 : 1;
  const n = Math.floor(Math.abs(v) * scale + 0.5);
  const i = Math.floor(n / scale);
  const f = n % scale;
  const sign = s < 0 && n !== 0 ? "-" : "";
  return `${sign}${i}.${String(f).padStart(digits, "0")}`;
}

export function num(v) {
  // Integral floats print without a decimal part. Matches Python num().
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Number.isInteger(v)) return String(v);
  return String(v);
}

export function jsRound(v) {
  // Math.round: halves go towards +inf, so -2.5 -> -2.
  return Math.floor(v + 0.5);
}

function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// the frame
// ---------------------------------------------------------------------------

export function frameOf(baseline, size, band = BAND) {
  // The four rules for one line.
  const E = size * band;
  return {
    baseline,
    size,
    E,
    band,
    r1: baseline - 2 * E,
    r2: baseline - E,
    r3: baseline,
    r4: baseline + E,
    top: baseline - 2 * E,
    bottom: baseline + E,
    slot: 3 * E,
  };
}

export function needOf(baseline, size, uses) {
  // The band a line's own outlines need, as a fraction of size.
  //
  // E must clear 2E of ink above the baseline and E below, so a glyph
  // rising `above` points needs E >= above/2 and one dropping `below`
  // needs E >= below.
  let above = 0.0;
  let below = 0.0;
  for (const u of uses) {
    if (!u.ink) continue;
    const a = baseline - u.ink[1];
    const b = u.ink[3] - baseline;
    if (a > above) above = a;
    if (b > below) below = b;
  }
  if (!size) return 0.0;
  return Math.max(above / (2 * size), below / size);
}

export function bandFor(baseline, size, uses, floor = BAND) {
  // BAND is the floor, the page is the ceiling.
  //
  // Ceiling, not the raw quotient: size * (above / (2 * size)) can land a
  // rounding error below above / 2, which would put the rule a hair inside
  // the ink it was computed to clear. A 3-decimal ceiling is also the
  // precision the frame is written at.
  const need = Math.ceil(needOf(baseline, size, uses) * 1000) / 1000;
  return Math.max(floor, need);
}

export function baseInset(width, strokeWidth) {
  // Half a stroke, so a round cap fits inside the canvas instead of being cut.
  const half = strokeWidth / 2;
  return width > 2 * half ? half : 0.0;
}

export function ruleLine(y, width, strokeWidth) {
  const d = baseInset(width, strokeWidth);
  return `<line x1="${fixed(d)}" y1="${fixed(y)}" `
    + `x2="${fixed(width - d)}" y2="${fixed(y)}"/>`;
}

export function framesOf(lines, band = BAND) {
  // Frames for a page from the parser's own line boundaries.
  //
  // lines yields [x, y, size, text], i.e. PdfPagePieces.lines(). A 5th
  // element overrides the band for that line, which is how the runner
  // feeds in a band raised to fit the line's own ink.
  const out = [];
  lines.forEach((row, i) => {
    const [x, y, size, text] = row;
    const own = row.length > 4 ? row[4] : null;
    const f = frameOf(y, size, own === null || own === undefined ? band : own);
    out.push({ index: i + 1, x, y, size, text, ...f });
  });
  return out;
}

export function pitchOf(frames) {
  // Modal consecutive baseline gap, rounded the way JS rounds it.
  //
  // Returns 0 when the page has no spacing to report, and callers treat 0
  // as "not uniform" rather than as a number: a signature block stacks
  // names on baselines 0.4 to 1.9 pt apart, and reporting 1.87 pt there
  // invents a spacing nobody set.
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) {
    const d = frames[i].baseline - frames[i - 1].baseline;
    if (d >= MIN_PITCH) gaps.push(jsRound(d * 100) / 100);
  }
  if (!gaps.length) return 0;
  const tally = new Map();
  for (const g of gaps) tally.set(g, (tally.get(g) ?? 0) + 1);
  // count desc, then value asc, stable over insertion order
  const [gap, count] = [...tally.entries()].sort((a, b) => (-a[1] + b[1]) || (a[0] - b[0]))[0];
  return count >= 2 ? gap : 0;
}

export function blankOf(frame, pitch) {
  // What is left between one slot and the next, or null when there is no pitch.
  return pitch ? pitch - frame.slot : null;
}

export function inkOf(use) {
  return use.ink ?? null;
}

export function overflow(frame, uses) {
  // Does this row's ink stay inside its four rules? Needs no font file.
  let lo = Infinity;
  let hi = -Infinity;
  for (const u of uses) {
    const ink = u.ink;
    if (!ink) continue;
    if (ink[1] < lo) lo = ink[1];
    if (ink[3] > hi) hi = ink[3];
  }
  if (lo === Infinity) return { ok: true, above: 0, below: 0 };
  const above = frame.baseline - lo;
  const below = hi - frame.baseline;
  // EPS absorbs floating-point noise only, exactly as in scan_frame.py
  const EPS = 1e-9;
  const ok = above <= 2 * frame.E * (1 + EPS) && below <= frame.E * (1 + EPS);
  return { ok, above, below };
}

export function brokenByLine(frames, scan) {
  // Attach scanBrokenSpans results to the lines they fall on.
  return frames.map((f) => {
    const spans = scan(String(f.text ?? "")) || [];
    return { ...f, spans, broken: spans.length > 0 };
  });
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

export const DEFAULT_PAINT = {
  slot: "#D6EAF8", rule: "#FF6EAE", base: "#FFC300", ink: "#000000",
};

export function sourceClip(width, height, clipId, scene) {
  // Keep source ink within the original page viewport.
  if (height === null || height === undefined || clipId === null || clipId === undefined
      || scene === null || scene === undefined) {
    return ["", ""];
  }
  const safeId = esc(clipId);
  return [
    `<defs><clipPath id="${safeId}"><rect x="0" y="0" `
      + `width="${fixed(width)}" height="${fixed(height)}"/></clipPath></defs>`,
    ` clip-path="url(#${safeId})"`,
  ];
}

export function lineSvg(width, frame, uses, defs, {
  pitch = null, label = null, paint = null, definitions = null,
  namespaces = "", scene = null, sourceHeight = null, clipId = null,
  fullPage = false,
} = {}) {
  // One line as a standalone SVG on the page-width canvas.
  const c = { ...DEFAULT_PAINT, ...(paint ?? {}) };
  const pad = frame.size * 0.6;
  const top = fullPage && sourceHeight !== null && sourceHeight !== undefined
    ? Math.min(0, frame.r1 - pad) : frame.r1 - pad;
  const bot = fullPage && sourceHeight !== null && sourceHeight !== undefined
    ? Math.max(sourceHeight, frame.r4 + pad) : frame.r4 + pad;
  const h = bot - top;

  const used = new Set(uses.map((u) => u.href));
  const defsXml = Object.keys(defs).filter((i) => used.has(i))
    .map((i) => `<path id="${esc(i)}" d="${defs[i]}"/>`).join("");

  const ink = scene === null || scene === undefined
    ? uses.map((u) => u.raw).join("") : scene;
  const [clipDef, clipAttr] = sourceClip(width, sourceHeight, clipId, scene);
  const defsBlock = (definitions === null || definitions === undefined
    ? `<defs>${defsXml}</defs>` : definitions) + clipDef;
  const sourceAttr = scene === null || scene === undefined
    ? "" : ` data-source-uses="true"${clipAttr}`;

  const rules = [frame.r1, frame.r2, frame.r4]
    .map((y) => ruleLine(y, width, RULE_W)).join("");
  const bd = baseInset(width, BASE_W);

  const idx = frame.index ?? "";
  const title = label !== null && label !== undefined ? label : `line ${idx !== "" ? idx : "?"}`;
  let pitchAttr = "";
  if (pitch) {
    pitchAttr = ` data-pitch="${fixed(pitch)}" data-blank="${fixed(blankOf(frame, pitch))}"`;
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + `${namespaces} version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" `
    + `viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-line="${idx}" data-baseline="${fixed(frame.baseline)}" `
    + `data-size="${num(frame.size)}" data-E="${fixed(frame.E, 3)}" `
    + `data-rules="${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => fixed(v)).join(",")}"`
    + pitchAttr
    + ` data-glyphs="${uses.length}">\n`
    + `<title>${esc(title)}</title>\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<rect x="0" y="${fixed(frame.r1)}" width="${fixed(width)}" `
    + `height="${fixed(frame.slot)}" fill="${c.slot}"/>\n`
    + `${defsBlock}\n`
    + `<g fill="${c.ink}"${sourceAttr}>${ink}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="${RULE_W}" fill="none" `
    + `stroke-linecap="round" stroke-linejoin="round">${rules}</g>\n`
    + `<line x1="${fixed(bd)}" y1="${fixed(frame.r3)}" `
    + `x2="${fixed(width - bd)}" `
    + `y2="${fixed(frame.r3)}" stroke="${c.base}" stroke-width="${BASE_W}" `
    + 'stroke-linecap="round"/>\n'
    + "</svg>\n";
}

function shiftMatrix(raw, shift) {
  // Translate the glyph's own matrix down by `shift`.
  const m = /transform="matrix\(([^)]*)\)"/.exec(raw);
  if (!m) return raw;
  const p = m[1].split(",").map(Number);
  const repl = `transform="matrix(${num(p[0])},${num(p[1])},${num(p[2])},${num(p[3])},`
    + `${num(p[4])},${fixed(p[5] + shift)})"`;
  return raw.slice(0, m.index) + repl + raw.slice(m.index + m[0].length);
}

export function sheetSvg(width, rows, defs, pitch, {
  mode = "page", paint = null, definitions = null, namespaces = "",
  scene = null, pageHeight = null, sourceHeight = null, clipId = null,
} = {}) {
  // A page-space sheet; full-page height can retain unframed source uses.
  if (!rows.length) {
    throw new Error("sheetSvg: no rows — the line selector matched nothing");
  }
  if (scene !== null && scene !== undefined && mode !== "page") {
    throw new Error("source scene requires page mode");
  }
  const c = { ...DEFAULT_PAINT, ...(paint ?? {}) };

  const used = new Set();
  const body = [];
  const slots = [];
  const slotRules = [];
  const baseRules = [];

  let cursor = 0.0;
  for (const row of rows) {
    const { frame, uses } = row;
    let shift = 0.0;
    if (mode === "stack") {
      shift = cursor - frame.r1;
      cursor += frame.slot + (pitch - frame.slot);
    }

    const g = [];
    for (const u of uses) {
      used.add(u.href);
      g.push(shift === 0 ? u.raw : shiftMatrix(u.raw, shift));
    }
    body.push(g.join(""));

    const b = frame.baseline + shift;
    slots.push(`<rect x="0" y="${fixed(b - 2 * frame.E)}" width="${fixed(width)}" `
      + `height="${fixed(frame.slot)}" fill="${c.slot}"/>`);
    for (const y of [b - 2 * frame.E, b - frame.E, b + frame.E]) {
      slotRules.push(ruleLine(y, width, RULE_W));
    }
    baseRules.push(ruleLine(b, width, BASE_W));
  }

  // one band per line, so the sheet reports the set rather than a single value
  const bandList = [...new Set(rows.map((r) => fixed(r.frame.band, 3)))].sort().join(",");

  let top;
  let h;
  if (mode === "stack") {
    top = 0.0;
    h = cursor + 8;
  } else {
    const rowTop = Math.min(...rows.map((r) => r.frame.r1));
    top = pageHeight === null || pageHeight === undefined ? rowTop : Math.min(0, rowTop);
    const rowBottom = Math.max(...rows.map((r) => r.frame.r4)) + 8;
    h = Math.max(rowBottom, pageHeight === null || pageHeight === undefined ? rowBottom : pageHeight) - top;
  }

  const defsXml = Object.keys(defs).filter((i) => used.has(i))
    .map((i) => `<path id="${esc(i)}" d="${defs[i]}"/>`).join("");
  const [clipDef, clipAttr] = sourceClip(width, sourceHeight, clipId, scene);
  const defsBlock = (definitions === null || definitions === undefined
    ? `<defs>${defsXml}</defs>` : definitions) + clipDef;
  const sourceAttr = scene === null || scene === undefined
    ? "" : ` data-source-uses="true"${clipAttr}`;
  const ink = scene === null || scene === undefined ? body.join("") : scene;

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + `${namespaces} version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" `
    + `viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-lines="${rows.length}"`
    + (pitch ? ` data-pitch="${fixed(pitch)}"` : "")
    + ` data-band="${bandList}">\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<g fill="${c.slot}">${slots.join("")}</g>\n`
    + `${defsBlock}\n`
    + `<g fill="${c.ink}"${sourceAttr}>${ink}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="${RULE_W}" fill="none" `
    + `stroke-linecap="round" stroke-linejoin="round">${slotRules.join("")}</g>\n`
    + `<g stroke="${c.base}" stroke-width="${BASE_W}" fill="none" `
    + `stroke-linecap="round" stroke-linejoin="round">${baseRules.join("")}</g>\n`
    + "</svg>\n";
}
