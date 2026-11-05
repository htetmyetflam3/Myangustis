// scan-frame.js — the four-rule frame, and one SVG per line on a shared canvas.
//
// FINAL DESIGN. Do not redesign this file. The reasoning, the traceback of the
// main-branch vector SVG lane, the keep/update/retire list for the voting and
// matching rules, and the lane verdict this file feeds are all written up in
// AGENT-NOTE-vector-svg.md at the repository root.
//
// The only thing here that is NOT final is B.Parser/main/parser/svg/trace_raster.py, which is
// experimental scratch for the OCR lane.
//
// Drop next to B.Parser/main/parser/text/scan.js and import from there.
// No dependencies, no font files, no font objects.
//
// ---------------------------------------------------------------------------
// WHY THE FRAME IS COMPUTED FROM SIZE ALONE
//
// The four rules are equally spaced, so one number settles the frame. Take E
// as the band width and b as the baseline:
//
//     r1 = b - 2E     r2 = b - E     r3 = b     r4 = b + E
//
// Three bands: above-marks, base letters, below-marks. The slot is 3E tall and
// the baseline sits 2E from its top, i.e. two thirds down.
//
// E was calibrated once, offline, from the ink of the two glyphs that reach
// furthest in a common Burmese text face (Myanmar3):
//
//     ိ  U+102D   highest ink, 0.9389 em  ->  2E >= 0.9389  ->  E >= 0.4694
//     ု  U+102F   deepest ink, 0.4000 em  ->   E >= 0.4000  ->  E >= 0.4000
//
// Binding 0.4694 em; both glyphs are 0.4978 em wide, so the round unit is half
// an em. BAND = 0.5.
//
// Calibrating per font was measured and rejected. Reading whole-font extremes
// across all 109 faces in the repo gives a median requirement of 0.495 em but
// a tail to 0.861 em, because it counts glyphs a line never draws (stacked
// Pali ligatures). Shaping real text across 104 faces needs only 0.495 median
// and 0.582 max. So per-font coordinates are both a 400-file dependency and a
// worse answer. If a page ever does need more room, the check below reports it
// from the page's own outlines, which costs nothing.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Number formatting, pinned so the Python twin emits identical bytes.
//
// `toFixed` and Python's `.2f` disagree on ties: 2.5 -> "2.5" vs "2.5" is fine
// but 2.5.toFixed(0) is "3" while f"{2.5:.0f}" is "2". Both also differ on
// integral floats (String(12.0) is "12", str(12.0) is "12.0"). These two
// helpers are the contract; scan_frame.py implements them character for
// character.
// ---------------------------------------------------------------------------

/** Integer hundredths, rounded half away from zero. */
export function fixed(v, digits = 2) {
  const scale = 10 ** digits;
  const s = v < 0 ? -1 : 1;
  const n = Math.floor(Math.abs(v) * scale + 0.5);
  const i = Math.floor(n / scale);
  const f = n % scale;
  const sign = s < 0 && n !== 0 ? "-" : "";
  return `${sign}${i}.${String(f).padStart(digits, "0")}`;
}

/**
 * Integral floats print without a decimal part.
 *
 * JS already prints 12.0 as "12", so this is String() with a name. It exists
 * because Python does not: str(12.0) is "12.0". scan_frame.py implements the
 * same contract by hand.
 */
export function num(v) {
  return String(v);
}

/** Band width as a fraction of font size. Calibrated on Myanmar3, see above. */
export const BAND = 0.5;

/**
 * The band a page's own outlines actually need, as a fraction of size.
 *
 * E must clear 2E of ink above the baseline and E below, so a glyph rising
 * `above` points needs E >= above/2 and a glyph dropping `below` needs
 * E >= below. Measured from the page, never from a font table.
 *
 * @param {number} baseline  the line's baseline, page points
 * @param {number} size      the line's font size in points
 * @param {Array}  uses      that line's glyphs, with page-space ink boxes
 */
export function needOf(baseline, size, uses) {
  let above = 0;
  let below = 0;
  for (const u of uses) {
    if (!u.ink) continue;
    const a = baseline - u.ink[1];
    const b = u.ink[3] - baseline;
    if (a > above) above = a;
    if (b > below) below = b;
  }
  if (!size) return 0;
  return Math.max(above / (2 * size), below / size);
}

/**
 * BAND is the floor, the page is the ceiling: a line gets the calibrated band
 * unless its own ink needs more. Returns BAND itself for an empty line, so a
 * page with no overflow keeps the calibrated frame exactly.
 */
export function bandFor(baseline, size, uses, floor = BAND) {
  // Ceiling, not the raw quotient: size * (above / (2 * size)) can land a
  // rounding error below above / 2, which would put the rule a hair inside the
  // ink it was computed to clear. A 3-decimal ceiling is also the precision the
  // frame is written at, so what is measured is what is drawn.
  const need = Math.ceil(needOf(baseline, size, uses) * 1000) / 1000;
  return Math.max(floor, need);
}

/**
 * The four rules for one line.
 * @param {number} baseline  baseline y in the associated SVG's page coordinates
 * @param {number} size      font size in points
 * @param {number} band      E as a fraction of size
 */
export function frameOf(baseline, size, band = BAND) {
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

/**
 * Frames for a page, straight from the parser's own line boundaries.
 *
 *   const pieces = new PdfPagePieces(dir);
 *   ... pieces.add(...) / pieces.finish(...)
 *   const frames = framesOf(lines);            // yields [x, y, size, text]
 *
 * The caller must first put line coordinates in the same space as the SVG;
 * raw PDF y-up coordinates are not interchangeable with SVG y-down values.
 * A 5th element on a line overrides the band for that line, which is how the
 * runner feeds in a band raised to fit the line's own ink. The page default is
 * the calibrated BAND.
 *
 * @param {Iterable<[number, number, number, string, number?]>} lines
 */
export function framesOf(lines, { band = BAND } = {}) {
  const out = [];
  let i = 0;
  for (const [x, y, size, text, own] of lines) {
    out.push({ index: i += 1, x, y, size, text, ...frameOf(y, size, own ?? band) });
  }
  return out;
}

/**
 * The page's line spacing, taken from the frames and not assumed.
 *
 * Returns 0 when the page has no spacing to report, and callers must treat 0 as
 * "not uniform" rather than as a number. Two things disqualify a page:
 *
 *   - gaps too small to be between text lines. A signature block stacks names
 *     on baselines 0.4 to 1.9 pt apart; taking the modal gap there reports a
 *     pitch of 1.87 pt, which is not a spacing anyone set.
 *   - no gap used more than once. With one of everything there is no mode, and
 *     reporting the smallest such gap is worse than reporting nothing.
 */
export const MIN_PITCH = 2;

export function pitchOf(frames) {
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) {
    const d = frames[i].baseline - frames[i - 1].baseline;
    if (d >= MIN_PITCH) gaps.push(Math.round(d * 100) / 100);
  }
  if (!gaps.length) return 0;
  const tally = new Map();
  for (const g of gaps) tally.set(g, (tally.get(g) || 0) + 1);
  const [gap, count] = [...tally.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return count >= 2 ? gap : 0;
}

/**
 * What is left between one slot and the next. The blank in the sketch.
 * Returns null when the page has no uniform pitch, so nothing prints a blank
 * computed from a spacing that does not exist.
 */
export function blankOf(frame, pitch) {
  return pitch ? pitch - frame.slot : null;
}

/**
 * Vertical ink of one glyph, in page points, from the page's own outlines.
 * `use` is one glyph drawn by the content stream:
 *   { baseline, x, y, href, ink: [x0, y0, x1, y1] }
 * where ink is the glyph bbox already transformed by its matrix.
 */
export function inkOf(use) {
  return use.ink;
}

/**
 * Does this row's ink stay inside its four rules?
 * Runs on the page's outlines, so it needs no font file.
 * @returns {{ok: boolean, above: number, below: number}}
 */
export function overflow(frame, uses) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const u of uses) {
    if (!u.ink) continue;
    if (u.ink[1] < lo) lo = u.ink[1];
    if (u.ink[3] > hi) hi = u.ink[3];
  }
  if (lo === Infinity) return { ok: true, above: 0, below: 0 };
  const above = frame.baseline - lo;   // how far ink rises past the baseline
  const below = hi - frame.baseline;   // how far it drops
  // EPS absorbs floating-point noise only. A rule landing 1e-16 inside the ink
  // that set it is not a fit failure; a visible overflow still is.
  const EPS = 1e-9;
  const ok = above <= 2 * frame.E * (1 + EPS) && below <= frame.E * (1 + EPS);
  return { ok, above, below };
}

/**
 * Attach scanBrokenSpans results to the lines they fall on.
 *
 *   const broken = brokenByLine(frames, (text) => scanBrokenSpans(text));
 *
 * A line is "broken" if the scanner returns anything for it. Nothing is
 * inferred from the font and no word is re-segmented: scan.js decides, this
 * only says which line it decided on.
 */
export function brokenByLine(frames, scan) {
  return frames.map((f) => {
    const spans = scan(String(f.text ?? "")) || [];
    return { ...f, spans, broken: spans.length > 0 };
  });
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * One line as a standalone SVG on the page-width canvas.
 *
 * The canvas width is the page width so sheets overlay each other; the height
 * is only as tall as this line's four rules plus padding. Coordinates stay in
 * page space, so the whole document can be dropped on top of a prebuilt sheet
 * with no transform.
 *
 * @param {object}   o
 * @param {number}   o.width    page width in points
 * @param {object}   o.frame    from frameOf()
 * @param {Array}    o.uses     glyphs of this row, page coordinates
 * @param {object}   o.defs     { id: pathData } for the glyphs used
 * @param {number}   [o.pitch]  page line spacing, for the blank readout
 * @param {object}   [o.paint]  colours
 */
/** Stroke widths of the frame, and the rule endpoints that keep the caps whole. */
export const RULE_W = 0.5;
export const BASE_W = 0.7;

export function baseInset(width, strokeWidth) {
  const half = strokeWidth / 2;
  return width > 2 * half ? half : 0;
}

function ruleLine(y, width, strokeWidth) {
  const d = baseInset(width, strokeWidth);
  return `<line x1="${fixed(d)}" y1="${fixed(y)}" x2="${fixed(width - d)}" y2="${fixed(y)}"/>`;
}

function sourceClip(width, height, id, scene) {
  if (height === null || id === null || scene === null) return { definition: "", attribute: "" };
  const safeId = esc(id);
  return {
    definition: `<defs><clipPath id="${safeId}"><rect x="0" y="0" width="${fixed(width)}" height="${fixed(height)}"/></clipPath></defs>`,
    attribute: ` clip-path="url(#${safeId})"`,
  };
}

export function lineSvg({ width, frame, uses, defs, pitch, label, paint = {}, definitions = null,
  namespaces = "", scene = null, sourceHeight = null, clipId = null, fullPage = false }) {
  const c = { slot: "#D6EAF8", rule: "#FF6EAE", base: "#FFC300", ink: "#000000", ...paint };
  const pad = frame.size * 0.6;
  const top = fullPage && sourceHeight !== null ? Math.min(0, frame.r1 - pad) : frame.r1 - pad;
  const bot = fullPage && sourceHeight !== null ? Math.max(sourceHeight, frame.r4 + pad) : frame.r4 + pad;
  const h = bot - top;

  const used = new Set(uses.map((u) => u.href));
  const defsXml = Object.keys(defs)
    .filter((id) => used.has(id))
    .map((id) => `<path id="${esc(id)}" d="${defs[id]}"/>`)
    .join("");

  const ink = scene ?? uses.map((u) => u.raw).join("");
  const clip = sourceClip(width, sourceHeight, clipId, scene);
  const defsBlock = (definitions ?? `<defs>${defsXml}</defs>`) + clip.definition;
  const sourceAttr = scene === null ? "" : ` data-source-uses="true"${clip.attribute}`;

  // Round tips everywhere, so a rule reads as a drawn line and not a cut edge.
  // The rules are inset by half their stroke width: a line drawn 0..width has
  // half of each round cap outside the canvas, where it is clipped and reads as
  // a square end. Insetting keeps the canvas exactly page width and puts the
  // whole cap inside it.
  const rules = [frame.r1, frame.r2, frame.r4]
    .map((y) => ruleLine(y, width, RULE_W))
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${namespaces} version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" `
    + `viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-line="${frame.index ?? ""}" data-baseline="${fixed(frame.baseline)}" `
    + `data-size="${num(frame.size)}" data-E="${fixed(frame.E, 3)}" `
    + `data-rules="${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => fixed(v)).join(",")}"`
    + (pitch ? ` data-pitch="${fixed(pitch)}" data-blank="${fixed(blankOf(frame, pitch))}"` : "")
    + ` data-glyphs="${uses.length}">\n`
    + `<title>${esc(label ?? `line ${frame.index ?? "?"}`)}</title>\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<rect x="0" y="${fixed(frame.r1)}" width="${fixed(width)}" height="${fixed(frame.slot)}" fill="${c.slot}"/>\n`
    + `${defsBlock}\n`
    + `<g fill="${c.ink}"${sourceAttr}>${ink}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="0.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${rules}</g>\n`
    + `<line x1="${fixed(baseInset(width, BASE_W))}" y1="${fixed(frame.r3)}" x2="${fixed(width - baseInset(width, BASE_W))}" y2="${fixed(frame.r3)}" stroke="${c.base}" stroke-width="${BASE_W}" stroke-linecap="round"/>\n`
    + `</svg>\n`;
}

/**
 * Many lines as one sheet: page-width canvas and page-space coordinates.
 * A full source page can retain its original height so unframed uses stay visible.
 *
 * Rows are stacked at the page's own pitch, so the blank between slots is the
 * blank the PDF set, never a constant.
 *
 * @param {object} o
 * @param {number} o.width      page width in points
 * @param {Array}  o.rows       [{ frame, uses, index }]
 * @param {object} o.defs       { id: pathData }; shared by every row
 * @param {number} o.pitch      page line spacing
 */
export function sheetSvg({ width, rows, defs, pitch, mode = "page", paint = {},
  definitions = null, namespaces = "", scene = null, pageHeight = null, sourceHeight = null, clipId = null }) {
  if (!rows.length) throw new Error("sheetSvg: no rows — the line selector matched nothing");
  if (scene !== null && mode !== "page") throw new Error("source scene requires page mode");
  const c = { slot: "#D6EAF8", rule: "#FF6EAE", base: "#FFC300", ink: "#000000", ...paint };

  const used = new Set();
  const body = [];
  const slots = [];
  const slotRules = [];
  const baseRules = [];

  let cursor = 0;
  for (const { frame, uses } of rows) {
    // page mode keeps the PDF's own coordinates so a single line and the whole
    // sheet sit on top of each other with no transform. stack mode starts at
    // zero and lays rows out at the page pitch instead.
    let shift = 0;
    if (mode === "stack") {
      shift = cursor - frame.r1;
      cursor += frame.slot + (pitch - frame.slot);   // slot + the PDF's blank
    }

    const g = [];
    for (const u of uses) {
      used.add(u.href);
      // translate the glyph's own matrix down by this row's shift
      g.push(shift === 0 ? u.raw : u.raw.replace(/transform="matrix\(([^)]*)\)"/,
        (_, m) => {
          const p = m.split(",").map(Number);
          return `transform="matrix(${p[0]},${p[1]},${p[2]},${p[3]},${p[4]},${fixed(p[5] + shift)})"`;
        }));
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
  const bandList = [...new Set(rows.map((r) => fixed(r.frame.band, 3)))]
    .sort().join(",");

  const rowTop = Math.min(...rows.map((r) => r.frame.r1));
  const top = mode === "stack" ? 0 : (pageHeight === null ? rowTop : Math.min(0, rowTop));
  const rowBottom = Math.max(...rows.map((r) => r.frame.r4)) + 8;
  const h = mode === "stack" ? cursor + 8 : Math.max(rowBottom, pageHeight ?? rowBottom) - top;
  const defsXml = Object.keys(defs)
    .filter((id) => used.has(id))
    .map((id) => `<path id="${esc(id)}" d="${defs[id]}"/>`)
    .join("");
  const clip = sourceClip(width, sourceHeight, clipId, scene);
  const defsBlock = (definitions ?? `<defs>${defsXml}</defs>`) + clip.definition;
  const sourceAttr = scene === null ? "" : ` data-source-uses="true"${clip.attribute}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"${namespaces} version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-lines="${rows.length}"`
    + (pitch ? ` data-pitch="${fixed(pitch)}"` : "")
    + ` data-band="${bandList}">\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<g fill="${c.slot}">${slots.join("")}</g>\n`
    + `${defsBlock}\n`
    + `<g fill="${c.ink}"${sourceAttr}>${scene ?? body.join("")}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="${RULE_W}" fill="none" stroke-linecap="round" stroke-linejoin="round">${slotRules.join("")}</g>\n`
    + `<g stroke="${c.base}" stroke-width="${BASE_W}" fill="none" stroke-linecap="round" stroke-linejoin="round">${baseRules.join("")}</g>\n`
    + `</svg>\n`;
}
