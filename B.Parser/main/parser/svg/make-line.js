// make-line.js — vectorize ONE random line from the original page and emit it
// as a standalone page-width SVG, plus the full sheet it can be overlaid on.
//
// Input is the page exported from the ORIGINAL content stream
// (pdf2svg.py reads the page operators, not the parser's text), so every
// outline below is the page's own artwork.
//
//   node B.Parser/main/parser/svg/make-line.js ./representative-p14.svg
import fs from "node:fs";
import { framesOf, pitchOf, blankOf, overflow, bandFor, lineSvg, sheetSvg, fixed, num } from "./scan-frame.js";

const SRC = process.argv[2] ?? "./representative-p14.svg";
const SEED = Number(process.argv[3] ?? 14);
const SUFFIX = process.argv[4] ?? "";
const ONLY = process.argv[5] ?? "";   // e.g. "1-8" or "1,3,5"; empty = every line
const PAGE = String(SRC).split("/").pop().replace(/\.[^.]*$/, "");

// Size is NOT a constant. Every glyph carries its own: the page export writes
// <use transform="matrix(sx,0,0,-sy,x,y)"> and sx IS the font size in points,
// because the glyph paths in <defs> are in em units. Reading it per line is
// what makes the frame hold on a page set at 11 pt as well as one at 12.96.
const UNITS = 0.9;    // baseline grouping tolerance, as a fraction of the size

function parseLines(spec, n) {
  if (!spec) return null;
  const out = new Set();
  for (const chunk of String(spec).split(",")) {
    const t = chunk.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-").map(Number);
      for (let i = a; i <= b; i += 1) out.add(i);
    } else out.add(Number(t));
  }
  return new Set([...out].filter((v) => v >= 1 && v <= n));
}

const svg = fs.readFileSync(SRC, "utf8");

// ---- ink bbox of a glyph, in em units, from its own path ----------------
const bboxCache = new Map();
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };
const NUM = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

// Glyph bbox in em units, walked command by command. H and V take one number,
// so a naive "numbers come in pairs" scan desyncs and invents ink. Control
// points are included, which makes the box a superset: the fit check can only
// ever be pessimistic, never optimistic.
function bboxOf(d) {
  if (bboxCache.has(d)) return bboxCache.get(d);
  const tok = d.match(NUM) ?? [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const note = (px, py) => {
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  };
  let cmd = null;
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) { cmd = tok[i]; i += 1; }
    if (cmd === null) throw new Error("invalid glyph path: missing command");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { x = sx; y = sy; cmd = null; continue; }
    const n = ARITY[C];
    if (n === undefined) throw new Error(`unsupported glyph path command ${cmd}`);
    if (i + n > tok.length) throw new Error("invalid glyph path: truncated command");
    if (tok.slice(i, i + n).some((v) => /^[A-Za-z]$/.test(v))) {
      throw new Error("invalid glyph path: missing arguments");
    }
    const v = [];
    for (let k = 0; k < n; k += 1) v.push(Number(tok[i + k]));
    i += n;
    const ox = x, oy = y;
    if (C === 'H') { x = rel ? x + v[0] : v[0]; note(x, y); }
    else if (C === 'V') { y = rel ? y + v[0] : v[0]; note(x, y); }
    else if (C === 'M') {
      x = rel ? x + v[0] : v[0]; y = rel ? y + v[1] : v[1];
      sx = x; sy = y; note(x, y); cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      x = rel ? x + v[0] : v[0]; y = rel ? y + v[1] : v[1]; note(x, y);
    } else if (C === 'C') {
      for (let k = 0; k < 6; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[4] : v[4]; y = rel ? oy + v[5] : v[5];
    } else if (C === 'Q') {
      for (let k = 0; k < 4; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[2] : v[2]; y = rel ? oy + v[3] : v[3];
    }
  }
  const r = x0 === Infinity ? null : [x0, y0, x1, y1];
  bboxCache.set(d, r);
  return r;
}

// Retain the source use order and enclosing groups. A group can supply a
// transform, clip, colour or opacity, so emitting bare uses changes the page.
// This reader accepts the SVG form produced by pdf2svg.py; unfamiliar
// containers or references fail explicitly rather than yielding a partial sheet.
const TAGS = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const CSS_ATTRS = ["style", "class"];
const EFFECT_ATTRS = ["stroke", "stroke-width", "filter", "mask", "marker",
  "marker-start", "marker-mid", "marker-end"];

function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag);
  return m ? m[2] : null;
}

function hasAny(tag, names) {
  return names.some((name) => attr(tag, name) !== null);
}

function matrix(value) {
  if (value === null) return IDENTITY;
  const m = /^matrix\s*\(([^)]*)\)\s*$/.exec(value.trim());
  if (!m) return null;
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  return parts.length === 6 && parts.every(Number.isFinite) ? parts : null;
}

function multiply(p, q) {
  if (!p || !q) return null;
  const [a, b, c, d, e, f] = p;
  const [g, h, i, j, k, l] = q;
  return [a * g + c * h, b * g + d * h, a * i + c * j,
    b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

function readScene(source) {
  const defs = Object.create(null);
  const pathFlags = Object.create(null);
  const defined = new Set();
  const allIds = new Set();
  const bodyDefs = new Map();
  const references = new Set();
  const definitions = [];
  const scene = [];
  const sourceUses = [];
  const groups = [];
  let defsDepth = 0, defsStart = 0, root = null, rootClosed = false, end = 0;
  let stylesheet = false, definitionEffects = false;

  function rememberPath(id, tag) {
    const d = attr(tag, "d");
    if (d === null) return;
    defs[id] = d;
    pathFlags[id] = { css: hasAny(tag, CSS_ATTRS) || attr(tag, "transform") !== null,
      effects: hasAny(tag, EFFECT_ATTRS) };
  }

  for (const match of source.matchAll(TAGS)) {
    if (source.slice(end, match.index).includes("<")) throw new Error("malformed SVG markup");
    const tag = match[0];
    end = match.index + tag.length;
    if (tag.startsWith("<!--") || tag.startsWith("<?")) continue;
    if (tag.startsWith("<!")) throw new Error("unsupported SVG declaration");
    if (tag.slice(1).includes("<")) throw new Error("malformed SVG markup");
    const nameMatch = /^<\s*(\/?)\s*([A-Za-z_][A-Za-z0-9:_.-]*)/.exec(tag);
    if (!nameMatch) throw new Error("unsupported SVG tag");
    const closing = Boolean(nameMatch[1]);
    const name = nameMatch[2];
    if (name.includes(":")) throw new Error(`unsupported namespaced SVG element <${name}>`);
    const selfClosing = /\/\s*>$/.test(tag);
    const id = closing ? null : attr(tag, "id");
    if (id) {
      if (allIds.has(id)) throw new Error(`duplicate SVG id ${id}; the page was not emitted`);
      allIds.add(id);
    }
    const href = closing ? null : (attr(tag, "xlink:href") ?? attr(tag, "href"));
    if (name === "use" && href && !href.startsWith("#")) {
      throw new Error("unsupported external SVG use reference; the page was not emitted");
    }
    if (name === "image" && href && !href.startsWith("#") && !href.startsWith("data:")) {
      throw new Error("unsupported external SVG image reference; the page was not emitted");
    }
    if ((name === "use" || name === "image") && href?.startsWith("#")) references.add(href.slice(1));
    for (const ref of tag.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
      const value = ref[2].trim();
      if (!value.startsWith("#")) throw new Error("unsupported external SVG resource; the page was not emitted");
      references.add(value.slice(1));
    }

    if (defsDepth) {
      if (id) defined.add(id);
      if (!closing && name === "path" && id) rememberPath(id, tag);
      if (!closing && name === "style") stylesheet = true;
      if (!closing && name === "g") {
        if (hasAny(tag, CSS_ATTRS) || attr(tag, "transform") !== null) stylesheet = true;
        if (hasAny(tag, EFFECT_ATTRS)) definitionEffects = true;
      }
      if (name === "defs" && !closing && !selfClosing) defsDepth += 1;
      if (name === "defs" && closing && --defsDepth === 0) {
        definitions.push(source.slice(defsStart, match.index + tag.length));
      }
      continue;
    }
    if (name === "svg") {
      if (!closing && !root) root = tag;
      else if (closing && root && !rootClosed && groups.length === 0) rootClosed = true;
      else throw new Error("unsupported nested or malformed SVG root");
      continue;
    }
    if (!root || rootClosed) throw new Error("SVG content outside the root element");
    if (name === "defs") {
      if (closing) throw new Error("unexpected closing defs");
      if (selfClosing) definitions.push(tag);
      else { defsDepth = 1; defsStart = match.index; }
      continue;
    }
    if (name === "g") {
      if (closing) {
        if (!groups.length) throw new Error("unmatched SVG group");
        groups.pop();
      } else if (!selfClosing) {
        const parent = groups.length ? groups[groups.length - 1] : { matrix: IDENTITY, css: false, effects: false };
        groups.push({ matrix: multiply(parent.matrix, matrix(attr(tag, "transform"))),
          css: parent.css || hasAny(tag, CSS_ATTRS), effects: parent.effects || hasAny(tag, EFFECT_ATTRS) });
      }
      scene.push({ raw: tag });
      continue;
    }
    if (name === "use") {
      if (closing || !selfClosing) throw new Error("unsupported non-empty SVG use");
      const parent = groups.length ? groups[groups.length - 1] : { matrix: IDENTITY, css: false, effects: false };
      const item = { raw: tag, index: sourceUses.length, parent: parent.matrix, href,
        css: parent.css || hasAny(tag, CSS_ATTRS), effects: parent.effects || hasAny(tag, EFFECT_ATTRS) };
      sourceUses.push(item);
      scene.push(item);
      continue;
    }
    // PyMuPDF can define an image in the page body, then refer to it with a
    // later <use>. Keep the definition in <defs> without drawing it twice.
    if ((name === "image" || name === "path") && id && selfClosing && !closing) {
      bodyDefs.set(id, tag);
      if (name === "path") rememberPath(id, tag);
    } else if (!selfClosing || closing) {
      throw new Error(`unsupported SVG container <${name}>`);
    }
  }
  if (source.slice(end).includes("<")) throw new Error("malformed SVG markup");
  if (!root || !rootClosed || defsDepth || groups.length) throw new Error("incomplete SVG page");

  const extra = [];
  for (const id of references) {
    if (defined.has(id)) continue;
    const raw = bodyDefs.get(id);
    if (!raw) throw new Error(`cannot preserve SVG reference #${id}: definition is missing or unsupported`);
    defined.add(id);
    extra.push(raw);
  }
  if (extra.length) definitions.push(`<defs>${extra.join("")}</defs>`);

  const uses = [], unframed = [];
  for (const item of sourceUses) {
    const id = item.href?.startsWith("#") ? item.href.slice(1) : null;
    const transform = attr(item.raw, "transform");
    const combined = transform === null ? null : multiply(item.parent, matrix(transform));
    const ox = Number(attr(item.raw, "x") ?? 0);
    const oy = Number(attr(item.raw, "y") ?? 0);
    if (!id || !Object.hasOwn(defs, id) || !combined || !Number.isFinite(ox) || !Number.isFinite(oy)
      || stylesheet || item.css || pathFlags[id].css) {
      unframed.push(item.index);
      continue;
    }
    const [a, b, c, d, tx, ty] = combined;
    const e = tx + a * ox + c * oy, f = ty + b * ox + d * oy;
    const size = Number(fixed(Math.hypot(a, b)));
    // Four horizontal rules cannot safely classify a rotated glyph's
    // baseline. Keep it in the page scene instead of guessing a line.
    if (!size || Math.abs(b) > size * 1e-6) { unframed.push(item.index); continue; }
    const bb = bboxOf(defs[id]);
    let ink = null;
    if (bb) {
      const [x0, y0, x1, y1] = bb;
      const xs = [a * x0 + c * y0 + e, a * x1 + c * y0 + e, a * x0 + c * y1 + e, a * x1 + c * y1 + e];
      const ys = [b * x0 + d * y0 + f, b * x1 + d * y0 + f, b * x0 + d * y1 + f, b * x1 + d * y1 + f];
      ink = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    uses.push({ href: id, x: e, y: f, ink, size, raw: item.raw, index: item.index,
      fullPage: item.effects || pathFlags[id].effects || definitionEffects });
  }
  const width = Number(attr(root, "width")), height = Number(attr(root, "height"));
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
    throw new Error("SVG page needs numeric width and height");
  }
  if (attr(root, "xmlns") !== "http://www.w3.org/2000/svg"
    || (attr(root, "xmlns:xlink") !== null && attr(root, "xmlns:xlink") !== "http://www.w3.org/1999/xlink")) {
    throw new Error("unsupported SVG root namespace");
  }
  const viewBox = attr(root, "viewBox");
  if (viewBox !== null) {
    const box = viewBox.trim().split(/[\s,]+/).map(Number);
    const expected = [0, 0, width, height];
    if (box.length !== 4 || box.some((v, i) => !Number.isFinite(v)
      || Math.abs(v - expected[i]) > Math.max(width, height, 1) * 1e-6)) {
      throw new Error("unsupported SVG root viewBox; the page was not emitted");
    }
  }
  for (const name of ["style", "class", "transform", "fill", "stroke", "opacity", "color",
    "clip-path", "mask", "filter", "display", "visibility", "overflow"]) {
    if (attr(root, name) !== null) throw new Error(`unsupported SVG root ${name}; the page was not emitted`);
  }
  const namespaces = [...root.matchAll(/\s+xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)]
    .filter((ns) => ns[1] !== "xlink").map((ns) => ns[0]).join("");
  let clipId = "__svg_page_clip";
  while (allIds.has(clipId)) clipId += "_";
  return { width, height, defs, definitions: definitions.join(""), namespaces, scene, uses, unframed, clipId };
}

function renderScene(scene, selected = null) {
  return scene.map((item) => item.index === undefined || selected === null || selected.has(item.index)
    ? item.raw : "").join("");
}

const pageScene = readScene(svg);
const { width: W, height: H, defs, uses, unframed } = pageScene;
if (!uses.length) {
  console.error(`no frameable glyph uses in ${SRC} — the page was not emitted`);
  process.exit(1);
}

// modal value, ties broken towards the smaller number so both languages agree
function modal(pairs) {
  const tally = new Map();
  for (const k of pairs) tally.set(k, (tally.get(k) ?? 0) + 1);
  return [...tally.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0][0];
}

// the page's dominant size sets the grouping tolerance; each line then takes
// its own size, so a page that mixes 11 pt and 12 pt still frames correctly
const TOL = modal(uses.map((u) => u.size)) * UNITS;

// ---- line boundaries ----------------------------------------------------
// pdf2svg.py writes <page>.lines.json beside the SVG: the PDF's own text-layer
// lines. That file is the authority. Guessing a baseline tolerance merges real
// lines on a page whose sub-headings interleave with the body, so the guess is
// only a fallback and it says so out loud.
const LINES_PATH = SRC.replace(/\.svg$/, ".lines.json");
let pageLines = null;
try {
  const metadata = JSON.parse(fs.readFileSync(LINES_PATH, "utf8"));
  if (metadata.coordinates === "svg-page") pageLines = metadata.lines;
  else console.warn(`unverified coordinates in ${LINES_PATH} — falling back to a baseline tolerance; `
    + "re-export the page with pdf2svg.py");
} catch (err) {
  if (err.code !== "ENOENT") throw err;
  console.warn(`no ${LINES_PATH} — falling back to a baseline tolerance; `
    + "run pdf2svg.py to get exact line boundaries");
}
if (pageLines !== null && !Array.isArray(pageLines)) throw new Error("invalid page line metadata");
if (pageLines && !pageLines.length) {
  console.warn(`no text lines in ${LINES_PATH} — falling back to a baseline tolerance`);
}

function inferredRow(glyphs) {
  return {
    x: Math.min(...glyphs.map((u) => u.ink ? u.ink[0] : u.x)),
    y: modal(glyphs.map((u) => Number(fixed(u.y)))),
    size: modal(glyphs.map((u) => u.size)),
    text: "",
    glyphs,
  };
}

function nearestRow(u, candidates) {
  let best = null, distance = Infinity;
  for (const r of candidates) {
    const d = Math.abs(r.y - u.y);
    if (d < distance) { best = r; distance = d; }
  }
  return distance <= TOL ? best : null;
}

let rows;
const unmatchedInk = [];
if (pageLines?.length) {
  rows = pageLines.map(([x, y, size, text]) => ({ x, y, size, text, glyphs: [] }));
  for (const u of uses) {
    const row = nearestRow(u, rows);
    if (row) row.glyphs.push(u);
    else if (u.ink) unmatchedInk.push(u);
    else unframed.push(u.index);
  }
} else {
  // Empty outlines do not establish a real line by themselves. Attach them to
  // a nearby inferred line, or retain them unframed on the full page sheet.
  const buckets = new Map();
  for (const u of uses.filter((v) => v.ink)) {
    let key = null;
    for (const k of buckets.keys()) if (Math.abs(k - u.y) <= TOL) { key = k; break; }
    if (key === null) { key = u.y; buckets.set(key, []); }
    buckets.get(key).push(u);
  }
  rows = [...buckets.values()].map(inferredRow);
  for (const u of uses.filter((v) => !v.ink)) {
    const row = nearestRow(u, rows);
    if (row) row.glyphs.push(u);
    else unframed.push(u.index);
  }
}

if (unmatchedInk.length) {
  // Metadata can omit visible content. Preserve its actual baseline in extra
  // rows instead of discarding it or assigning it to an unrelated text line.
  const buckets = new Map();
  for (const u of unmatchedInk) {
    const key = fixed(u.y);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(u);
  }
  rows.push(...[...buckets.values()].map(inferredRow));
  console.warn(`${unmatchedInk.length} unmatched glyph uses retained in ${buckets.size} inferred row(s)`);
}
rows.sort((a, b) => a.y - b.y || a.x - b.x);
if (!rows.length) throw new Error("no text rows or visible glyphs; the page was not emitted");
if (unframed.length) {
  console.warn(`${unframed.length} uses could not be assigned to a line; retained at their original positions on the full sheet`);
}

// Each line takes the calibrated band, raised only if its own ink needs more.
// The four rules stay equally spaced; only the spacing scales, so the design
// holds on a page the calibration did not cover.
for (const r of rows) r.band = bandFor(r.y, r.size, r.glyphs);
const lines = rows.map((r) => [r.x, r.y, r.size, r.text, r.band]);
const frames = framesOf(lines);
const pitch = pitchOf(frames);

// ---- one line, picked at random ----------------------------------------
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const rnd = mulberry(SEED);
const pick = 1 + Math.floor(rnd() * frames.length);
const frame = frames[pick - 1];
const rowsUses = (f) => rows[f.index - 1].glyphs;
const lineUses = rowsUses(frame);

console.log(`${PAGE}   width ${W}   ${uses.length} glyph uses   ${frames.length} lines`);
console.log(`assigned ${rows.reduce((n, r) => n + r.glyphs.length, 0)}/${uses.length} glyph uses; `
  + `${unframed.length} uses retained unframed on the full sheet`);
console.log(`sizes ${[...new Set(frames.map((f) => f.size))].sort((p, q) => p - q).join(", ")}`);
const blank = blankOf(frame, pitch);
console.log(`pitch ${pitch ? num(pitch) : "— (not uniform)"}   slot ${fixed(frame.slot)}   `
  + `blank ${blank === null ? "—" : fixed(blank)}`);
console.log(`band ${fixed(frame.band, 3)}  E ${fixed(frame.E)}  `
  + `rules ${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => fixed(v)).join(" / ")}`);
console.log(`random line ${pick} of ${frames.length}   baseline ${fixed(frame.baseline)}   ${lineUses.length} glyphs`);

// fit check from the page's own ink, no font file
let bad = 0, unchecked = 0;
for (const f of frames) {
  const glyphs = rowsUses(f);
  if (glyphs.some((u) => u.fullPage)) { unchecked += 1; continue; }
  const o = overflow(f, glyphs);
  if (!o.ok) { bad += 1; console.log(`  ! line ${f.index} (size ${num(f.size)}, band ${fixed(f.band, 3)}) ink ${fixed(o.above)} above / ${fixed(o.below)} below`); }
}
console.log(`fit: ${frames.length - bad - unchecked}/${frames.length} lines inside the rules`
  + (unchecked ? `; ${unchecked} not assessed for strokes or effects` : ""));

// ---- emit --------------------------------------------------------------
const keep = parseLines(ONLY, frames.length);
const selected = keep === null ? frames : frames.filter((f) => keep.has(f.index));
if (!selected.length) throw new Error("the line selector matched nothing; the page was not emitted");
const all = selected.map((f) => ({ frame: f, uses: rowsUses(f) }));
const allLines = selected.length === frames.length;
const selectedIds = allLines ? null : new Set(all.flatMap((row) => row.uses.map((u) => u.index)));
const lineFullPage = lineUses.some((u) => u.fullPage);
const sheetFullPage = allLines || all.some((row) => row.uses.some((u) => u.fullPage));
if (lineFullPage || (!allLines && sheetFullPage)) {
  console.warn("stroke or effects present; retained the source page viewport to avoid clipping a selected use");
}

const lineOutput = lineSvg({ width: W, frame, uses: lineUses, defs, pitch, label: `${PAGE} line ${pick}`,
  definitions: pageScene.definitions, namespaces: pageScene.namespaces,
  sourceHeight: H, clipId: pageScene.clipId, fullPage: lineFullPage,
  scene: renderScene(pageScene.scene, new Set(lineUses.map((u) => u.index))) });
const sheetOutput = sheetSvg({ width: W, rows: all, defs, pitch, definitions: pageScene.definitions,
  namespaces: pageScene.namespaces, scene: renderScene(pageScene.scene, selectedIds),
  sourceHeight: H, clipId: pageScene.clipId, pageHeight: sheetFullPage ? H : null });
fs.writeFileSync(`known/line-sample${SUFFIX}.svg`, lineOutput);
  fs.writeFileSync(`known/frame-sheet${SUFFIX}.svg`, sheetOutput);

console.log(`-> known/line-sample${SUFFIX}.svg`);
console.log(`-> known/frame-sheet${SUFFIX}.svg`);
