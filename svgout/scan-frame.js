// scan-frame.js — the four-rule frame, and one SVG per line on a shared canvas.
//
// FINAL DESIGN. Do not redesign this file. The reasoning, the traceback of the
// main-branch vector SVG lane, the keep/update/retire list for the voting and
// matching rules, and the lane verdict this file feeds are all written up in
// AGENT-NOTE-vector-svg.md at the repository root.
//
// The only thing here that is NOT final is svgout/trace_raster.py, which is
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

/** Integral floats print without a decimal part. */
export function num(v) {
  return Number.isInteger(v) ? String(v) : String(v);
}

/** Band width as a fraction of font size. Calibrated on Myanmar3, see above. */
export const BAND = 0.5;

/**
 * The four rules for one line.
 * @param {number} baseline  baseline y in page points (PDF user space)
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
 *   const frames = framesOf(pieces.lines());   // yields [x, y, size, text]
 *
 * @param {Iterable<[number, number, number, string]>} lines
 */
export function framesOf(lines, { band = BAND } = {}) {
  const out = [];
  let i = 0;
  for (const [x, y, size, text] of lines) {
    out.push({ index: i += 1, x, y, size, text, ...frameOf(y, size, band) });
  }
  return out;
}

/**
 * The page's line spacing, taken from the frames and not assumed.
 * Modal consecutive baseline gap, ignoring the page-break outliers.
 */
export function pitchOf(frames) {
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) {
    const d = frames[i].baseline - frames[i - 1].baseline;
    if (d > 1) gaps.push(Math.round(d * 100) / 100);
  }
  if (!gaps.length) return 0;
  const tally = new Map();
  for (const g of gaps) tally.set(g, (tally.get(g) || 0) + 1);
  return [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** What is left between one slot and the next. The blank in the sketch. */
export function blankOf(frame, pitch) {
  return pitch - frame.slot;
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
  return { ok: above <= 2 * frame.E && below <= frame.E, above, below };
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
export function lineSvg({ width, frame, uses, defs, pitch, label, paint = {} }) {
  const c = { slot: "#D6EAF8", rule: "#FF6EAE", base: "#FFC300", ink: "#000000", ...paint };
  const pad = frame.size * 0.6;
  const top = frame.r1 - pad;
  const bot = frame.r4 + pad;
  const h = bot - top;

  const used = new Set(uses.map((u) => u.href));
  const defsXml = Object.keys(defs)
    .filter((id) => used.has(id))
    .map((id) => `<path id="${esc(id)}" d="${defs[id]}"/>`)
    .join("");

  const ink = uses.map((u) => u.raw).join("");

  // round tips everywhere, so a rule reads as a drawn line and not a cut edge
  const rules = [frame.r1, frame.r2, frame.r4]
    .map((y) => `<line x1="0" y1="${fixed(y)}" x2="${fixed(width)}" y2="${fixed(y)}"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" `
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
    + `<defs>${defsXml}</defs>\n`
    + `<g fill="${c.ink}">${ink}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="0.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${rules}</g>\n`
    + `<line x1="0" y1="${fixed(frame.r3)}" x2="${fixed(width)}" y2="${fixed(frame.r3)}" stroke="${c.base}" stroke-width="0.7" stroke-linecap="round"/>\n`
    + `</svg>\n`;
}

/**
 * Many lines as one sheet: page-width canvas, page-space coordinates, the
 * sheet grows downwards exactly as far as the requested lines go.
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
export function sheetSvg({ width, rows, defs, pitch, mode = "page", paint = {} }) {
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
      slotRules.push(`<line x1="0" y1="${fixed(y)}" x2="${fixed(width)}" y2="${fixed(y)}"/>`);
    }
    baseRules.push(`<line x1="0" y1="${fixed(b)}" x2="${fixed(width)}" y2="${fixed(b)}"/>`);
  }

  const top = mode === "stack" ? 0 : Math.min(...rows.map((r) => r.frame.r1));
  const h = mode === "stack" ? cursor + 8 : Math.max(...rows.map((r) => r.frame.r4)) - top + 8;
  const defsXml = Object.keys(defs)
    .filter((id) => used.has(id))
    .map((id) => `<path id="${esc(id)}" d="${defs[id]}"/>`)
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-lines="${rows.length}" data-pitch="${fixed(pitch)}" data-band="${num(BAND)}">\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<g fill="${c.slot}">${slots.join("")}</g>\n`
    + `<defs>${defsXml}</defs>\n`
    + `<g fill="${c.ink}">${body.join("")}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="0.5" fill="none" stroke-linecap="round" stroke-linejoin="round">${slotRules.join("")}</g>\n`
    + `<g stroke="${c.base}" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${baseRules.join("")}</g>\n`
    + `</svg>\n`;
}
