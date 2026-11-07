// JS twin of B.Parser/main/Python/make_line.py — same input, same bytes.
//
// Standalone: does not call Python. The Python side does not call this
// either. Both read the same page export and must produce identical SVG.
//
//   node make-line.js <page.svg> [seed] [suffix] [only-lines]
//
// Size is NOT a constant. Every glyph carries its own: the page export
// writes <use transform="matrix(sx,0,0,-sy,x,y)"> and sx IS the font size
// in points, because the glyph paths in <defs> are in em units.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  framesOf, pitchOf, blankOf, overflow, bandFor, lineSvg, sheetSvg, fixed, num,
} from "./scan-frame.js";

export const UNITS = 0.9; // baseline grouping tolerance, as a fraction of the size

const NUM = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };

export function bboxOf(d, cache = new Map()) {
  // Glyph bbox in em units, walked command by command.
  //
  // Control points are included, so the box is a superset: the fit check
  // can only be pessimistic, never optimistic. H and V take one number,
  // which is why a naive "numbers come in pairs" scan desyncs and
  // invents ink.
  if (cache.has(d)) return cache.get(d);
  const tok = d.match(NUM) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const note = (px, py) => {
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  };

  let cmd = null;
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) {
      cmd = tok[i];
      i += 1;
    }
    if (cmd === null) throw new Error("invalid glyph path: missing command");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      x = sx;
      y = sy;
      cmd = null;
      continue;
    }
    const n = ARITY[C];
    if (n === undefined) throw new Error(`unsupported glyph path command ${cmd}`);
    if (i + n > tok.length) throw new Error("invalid glyph path: truncated command");
    if (tok.slice(i, i + n).some((v) => /^[A-Za-z]$/.test(v))) {
      throw new Error("invalid glyph path: missing arguments");
    }
    const v = tok.slice(i, i + n).map(Number);
    i += n;
    const ox = x;
    const oy = y;
    if (C === "H") {
      x = rel ? x + v[0] : v[0];
      note(x, y);
    } else if (C === "V") {
      y = rel ? y + v[0] : v[0];
      note(x, y);
    } else if (C === "M") {
      x = rel ? x + v[0] : v[0];
      y = rel ? y + v[1] : v[1];
      sx = x;
      sy = y;
      note(x, y);
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      x = rel ? x + v[0] : v[0];
      y = rel ? y + v[1] : v[1];
      note(x, y);
    } else if (C === "C") {
      for (let k = 0; k < 6; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[4] : v[4];
      y = rel ? oy + v[5] : v[5];
    } else if (C === "Q") {
      for (let k = 0; k < 4; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[2] : v[2];
      y = rel ? oy + v[3] : v[3];
    }
  }

  const r = x0 === Infinity ? null : [x0, y0, x1, y1];
  cache.set(d, r);
  return r;
}

// Preserve every use in its source group/order. The reader accepts the SVG
// form produced by pdf2svg.py; unfamiliar containers or references fail
// explicitly rather than yielding a partial sheet.
const TAGS = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const CSS_ATTRS = ["style", "class"];
const EFFECT_ATTRS = ["stroke", "stroke-width", "filter", "mask", "marker",
  "marker-start", "marker-mid", "marker-end"];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag);
  return m ? m[2] : null;
}

function hasAny(tag, names) {
  return names.some((name) => attr(tag, name) !== null);
}

export function matrix(value) {
  if (value === null || value === undefined) return IDENTITY;
  const m = /^matrix\s*\(([^)]*)\)\s*$/.exec(value.trim());
  if (!m) return null;
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  return parts.length === 6 && parts.every(Number.isFinite) ? parts : null;
}

export function multiply(p, q) {
  if (!p || !q) return null;
  const [a, b, c, d, e, f] = p;
  const [g, h, i, j, k, l] = q;
  return [a * g + c * h, b * g + d * h, a * i + c * j,
    b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

export function readScene(source) {
  const defs = {};
  const pathFlags = {};
  const bodyDefs = {};
  const references = new Set();
  const defined = new Set();
  const allIds = new Set();
  const definitions = [];
  const scene = [];
  const sourceUses = [];
  const groups = [];
  let defsDepth = 0;
  let defsStart = 0;
  let end = 0;
  let root = null;
  let rootClosed = false;
  let stylesheet = false;
  let definitionEffects = false;

  const rememberPath = (gid, tag) => {
    const d = attr(tag, "d");
    if (d === null) return;
    defs[gid] = d;
    pathFlags[gid] = {
      css: hasAny(tag, CSS_ATTRS) || attr(tag, "transform") !== null,
      effects: hasAny(tag, EFFECT_ATTRS),
    };
  };

  TAGS.lastIndex = 0;
  let match;
  while ((match = TAGS.exec(source)) !== null) {
    if (source.slice(end, match.index).includes("<")) {
      throw new Error("malformed SVG markup");
    }
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
    const gid = closing ? null : attr(tag, "id");
    if (gid) {
      if (allIds.has(gid)) {
        throw new Error(`duplicate SVG id ${gid}; the page was not emitted`);
      }
      allIds.add(gid);
    }
    const href = closing ? null : (attr(tag, "xlink:href") ?? attr(tag, "href"));
    if (name === "use" && href && !href.startsWith("#")) {
      throw new Error("unsupported external SVG use reference; the page was not emitted");
    }
    if (name === "image" && href && !href.startsWith("#") && !href.startsWith("data:")) {
      throw new Error("unsupported external SVG image reference; the page was not emitted");
    }
    if ((name === "use" || name === "image") && href && href.startsWith("#")) {
      references.add(href.slice(1));
    }
    for (const ref of tag.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
      const value = ref[2].trim();
      if (!value.startsWith("#")) {
        throw new Error("unsupported external SVG resource; the page was not emitted");
      }
      references.add(value.slice(1));
    }

    if (defsDepth) {
      if (gid) defined.add(gid);
      if (!closing && name === "path" && gid) rememberPath(gid, tag);
      if (!closing && name === "style") stylesheet = true;
      if (!closing && name === "g") {
        if (hasAny(tag, CSS_ATTRS) || attr(tag, "transform") !== null) stylesheet = true;
        if (hasAny(tag, EFFECT_ATTRS)) definitionEffects = true;
      }
      if (name === "defs" && !closing && !selfClosing) defsDepth += 1;
      if (name === "defs" && closing) {
        defsDepth -= 1;
        if (!defsDepth) definitions.push(source.slice(defsStart, end));
      }
      continue;
    }
    if (name === "svg") {
      if (!closing && root === null) {
        root = tag;
      } else if (closing && root && !rootClosed && !groups.length) {
        rootClosed = true;
      } else {
        throw new Error("unsupported nested or malformed SVG root");
      }
      continue;
    }
    if (!root || rootClosed) throw new Error("SVG content outside the root element");
    if (name === "defs") {
      if (closing) throw new Error("unexpected closing defs");
      if (selfClosing) {
        definitions.push(tag);
      } else {
        defsDepth = 1;
        defsStart = match.index;
      }
      continue;
    }
    if (name === "g") {
      if (closing) {
        if (!groups.length) throw new Error("unmatched SVG group");
        groups.pop();
      } else if (!selfClosing) {
        const parent = groups.length
          ? groups[groups.length - 1]
          : { matrix: IDENTITY, css: false, effects: false };
        groups.push({
          matrix: multiply(parent.matrix, matrix(attr(tag, "transform"))),
          css: parent.css || hasAny(tag, CSS_ATTRS),
          effects: parent.effects || hasAny(tag, EFFECT_ATTRS),
        });
      }
      scene.push({ raw: tag });
      continue;
    }
    if (name === "use") {
      if (closing || !selfClosing) throw new Error("unsupported non-empty SVG use");
      const parent = groups.length
        ? groups[groups.length - 1]
        : { matrix: IDENTITY, css: false, effects: false };
      const item = {
        raw: tag, index: sourceUses.length, parent: parent.matrix, href,
        css: parent.css || hasAny(tag, CSS_ATTRS),
        effects: parent.effects || hasAny(tag, EFFECT_ATTRS),
      };
      sourceUses.push(item);
      scene.push(item);
      continue;
    }
    // A body image may be referenced by a later <use>; put that definition
    // in <defs> without drawing the original image a second time.
    if ((name === "image" || name === "path") && gid && selfClosing && !closing) {
      bodyDefs[gid] = tag;
      if (name === "path") rememberPath(gid, tag);
    } else if (!selfClosing || closing) {
      throw new Error(`unsupported SVG container <${name}>`);
    }
  }
  if (source.slice(end).includes("<")) throw new Error("malformed SVG markup");
  if (!root || !rootClosed || defsDepth || groups.length) {
    throw new Error("incomplete SVG page");
  }

  const extra = [];
  for (const gid of references) {
    if (defined.has(gid)) continue;
    const raw = bodyDefs[gid];
    if (raw === undefined) {
      throw new Error(`cannot preserve SVG reference #${gid}: definition is missing or unsupported`);
    }
    defined.add(gid);
    extra.push(raw);
  }
  if (extra.length) definitions.push(`<defs>${extra.join("")}</defs>`);

  const uses = [];
  const unframed = [];
  const cache = new Map();
  for (const item of sourceUses) {
    const href = item.href;
    const gid = href && href.startsWith("#") ? href.slice(1) : null;
    const transform = attr(item.raw, "transform");
    const combined = transform === null ? null : multiply(item.parent, matrix(transform));
    let ox = Number(attr(item.raw, "x") ?? 0);
    let oy = Number(attr(item.raw, "y") ?? 0);
    if (Number.isNaN(ox) || Number.isNaN(oy)) { ox = NaN; oy = NaN; }
    if (!gid || !(gid in defs) || combined === null
        || !Number.isFinite(ox) || !Number.isFinite(oy)
        || stylesheet || item.css || pathFlags[gid].css) {
      unframed.push(item.index);
      continue;
    }
    const [a, b, c, d, tx, ty] = combined;
    const e = tx + a * ox + c * oy;
    const f = ty + b * ox + d * oy;
    const size = Number(fixed(Math.hypot(a, b)));
    // The four rules are horizontal. Keep rotated glyphs on the full page
    // rather than guessing which horizontal line they belong to.
    if (!size || Math.abs(b) > size * 1e-6) {
      unframed.push(item.index);
      continue;
    }
    const bb = bboxOf(defs[gid], cache);
    let ink = null;
    if (bb) {
      const [x0, y0, x1, y1] = bb;
      const xs = [a * x0 + c * y0 + e, a * x1 + c * y0 + e, a * x0 + c * y1 + e, a * x1 + c * y1 + e];
      const ys = [b * x0 + d * y0 + f, b * x1 + d * y0 + f, b * x0 + d * y1 + f, b * x1 + d * y1 + f];
      ink = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    uses.push({
      href: gid, x: e, y: f, ink, size,
      raw: item.raw, index: item.index,
      fullPage: item.effects || pathFlags[gid].effects || definitionEffects,
    });
  }

  const widthAttr = attr(root, "width");
  const heightAttr = attr(root, "height");
  const width = widthAttr === null ? NaN : Number(widthAttr);
  const height = heightAttr === null ? NaN : Number(heightAttr);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("SVG page needs numeric width and height");
  }
  if (attr(root, "xmlns") !== "http://www.w3.org/2000/svg"
      || ![null, "http://www.w3.org/1999/xlink"].includes(attr(root, "xmlns:xlink"))) {
    throw new Error("unsupported SVG root namespace");
  }
  const viewBox = attr(root, "viewBox");
  if (viewBox !== null) {
    const parts = viewBox.trim() ? viewBox.trim().split(/[\s,]+/).map(Number) : [];
    const expected = [0, 0, width, height];
    if (parts.length !== 4 || parts.some((v, i) => !Number.isFinite(v)
        || Math.abs(v - expected[i]) > Math.max(width, height, 1) * 1e-6)) {
      throw new Error("unsupported SVG root viewBox; the page was not emitted");
    }
  }
  for (const name of ["style", "class", "transform", "fill", "stroke", "opacity", "color",
    "clip-path", "mask", "filter", "display", "visibility", "overflow"]) {
    if (attr(root, name) !== null) {
      throw new Error(`unsupported SVG root ${name}; the page was not emitted`);
    }
  }
  const namespaces = [...root.matchAll(/\s+xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)]
    .filter((ns) => ns[1] !== "xlink")
    .map((ns) => ns[0])
    .join("");
  let clipId = "__svg_page_clip";
  while (allIds.has(clipId)) clipId += "_";
  return {
    width, height, defs,
    definitions: definitions.join(""), namespaces, scene,
    uses, unframed, clipId,
  };
}

export function renderScene(scene, selected = null) {
  return scene
    .filter((item) => !("index" in item) || selected === null || selected.has(item.index))
    .map((item) => item.raw)
    .join("");
}

export function modal(values) {
  // Most common value; ties break towards the smaller one.
  const tally = new Map();
  for (const k of values) tally.set(k, (tally.get(k) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
}

export function parseLines(spec, n) {
  // Same contract as parse_lines() in make_line.py. Empty spec -> null.
  if (!spec) return null;
  const out = new Set();
  for (const chunk of String(spec).split(",")) {
    const t = chunk.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-", 2).map(Number);
      for (let v = a; v <= b; v += 1) out.add(v);
    } else {
      out.add(Number(t));
    }
  }
  return new Set([...out].filter((v) => 1 <= v && v <= n));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  };
}

// Group a page export's glyph uses into framed lines. `pageLines` is the
// PDF's own text-layer line metadata ([x, y, size, text] rows, svg-page
// coordinates) when available; without it, rows are inferred from glyph
// baselines and the caller hears about it on stderr in the CLI runner.
export function analysePage(source, { pageLines = null } = {}) {
  const pageScene = readScene(source);
  const { width: W, height: H, defs, uses } = pageScene;
  const unframed = [...pageScene.unframed];
  if (!uses.length) return { pageScene, rows: [], frames: [], pitch: 0, unframed };

  const tol = modal(uses.map((u) => u.size)) * UNITS;

  const inferredRow = (glyphs) => ({
    x: Math.min(...glyphs.map((u) => (u.ink ? u.ink[0] : u.x))),
    y: modal(glyphs.map((u) => Number(fixed(u.y)))),
    size: modal(glyphs.map((u) => u.size)),
    text: "",
    glyphs,
  });
  const nearestRow = (u, candidates) => {
    let best = null;
    let distance = Infinity;
    for (const r of candidates) {
      const d = Math.abs(r.y - u.y);
      if (d < distance) {
        best = r;
        distance = d;
      }
    }
    return distance <= tol ? best : null;
  };

  const unmatchedInk = [];
  let rows;
  if (pageLines) {
    rows = pageLines.map(([x, y, size, text]) => ({ x, y, size, text, glyphs: [] }));
    for (const u of uses) {
      const row = nearestRow(u, rows);
      if (row !== null) row.glyphs.push(u);
      else if (u.ink) unmatchedInk.push(u);
      else unframed.push(u.index);
    }
  } else {
    const buckets = new Map();
    for (const u of uses) {
      if (!u.ink) continue;
      let key = null;
      for (const k of buckets.keys()) {
        if (Math.abs(k - u.y) <= tol) {
          key = k;
          break;
        }
      }
      if (key === null) {
        key = u.y;
        buckets.set(key, []);
      }
      buckets.get(key).push(u);
    }
    rows = [...buckets.values()].map((g) => inferredRow(g));
    for (const u of uses) {
      if (u.ink) continue;
      const row = nearestRow(u, rows);
      if (row !== null) row.glyphs.push(u);
      else unframed.push(u.index);
    }
  }

  let inferredFromUnmatched = 0;
  if (unmatchedInk.length) {
    const buckets = new Map();
    for (const u of unmatchedInk) {
      const key = fixed(u.y);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(u);
    }
    inferredFromUnmatched = buckets.size;
    rows.push(...[...buckets.values()].map((g) => inferredRow(g)));
  }
  rows.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const r of rows) r.band = bandFor(r.y, r.size, r.glyphs);
  const lines = rows.map((r) => [r.x, r.y, r.size, r.text, r.band]);
  const frames = framesOf(lines);
  const pitch = pitchOf(frames);
  return {
    pageScene, rows, frames, pitch, unframed,
    width: W, height: H, defs,
    unmatchedInk: unmatchedInk.length, inferredFromUnmatched,
  };
}

export function lineSvgFor(analysis, index, { label = null } = {}) {
  const { pageScene, frames, rows, pitch } = analysis;
  const frame = frames[index - 1];
  if (!frame) throw new Error(`line ${index} is out of range 1..${frames.length}`);
  const uses = rows[index - 1].glyphs;
  const lineIds = new Set(uses.map((u) => u.index));
  return lineSvg(analysis.width, frame, uses, analysis.defs, {
    pitch,
    label: label ?? `line ${index}`,
    definitions: pageScene.definitions,
    namespaces: pageScene.namespaces,
    sourceHeight: analysis.height,
    clipId: pageScene.clipId,
    fullPage: uses.some((u) => u.fullPage),
    scene: renderScene(pageScene.scene, lineIds),
  });
}

export function sheetSvgFor(analysis, { only = null } = {}) {
  const { pageScene, frames, rows, pitch } = analysis;
  const keep = parseLines(only, frames.length);
  const selected = keep === null ? frames : frames.filter((f) => keep.has(f.index));
  if (!selected.length) {
    throw new Error("the line selector matched nothing; the page was not emitted");
  }
  const allRows = selected.map((f) => ({ frame: f, uses: rows[f.index - 1].glyphs }));
  const allLines = selected.length === frames.length;
  const selectedIds = allLines
    ? null
    : new Set(allRows.flatMap((row) => row.uses.map((u) => u.index)));
  const sheetFullPage = allLines
    || allRows.some((row) => row.uses.some((u) => u.fullPage));
  return sheetSvg(analysis.width, allRows, analysis.defs, pitch, {
    definitions: pageScene.definitions,
    namespaces: pageScene.namespaces,
    scene: renderScene(pageScene.scene, selectedIds),
    sourceHeight: analysis.height,
    clipId: pageScene.clipId,
    pageHeight: sheetFullPage ? analysis.height : null,
  });
}

// ---------------------------------------------------------------------------
// CLI runner — mirrors make_line.py's main(): page export -> a random
// framed line sample plus the full sheet under known/.
// ---------------------------------------------------------------------------

function main(argv) {
  const src = argv[2] ?? "../parser/svg/representative-p14.svg";
  const seed = argv[3] !== undefined ? parseInt(argv[3], 10) : 14;
  const suffix = argv[4] ?? "";
  const only = argv[5] ?? "";
  const page = src.replaceAll("\\", "/").split("/").pop().replace(/\.[^.]*$/, "");

  const svg = fs.readFileSync(src, "utf8");
  const linesPath = src.replace(/\.svg$/, ".lines.json");
  let pageLines = null;
  try {
    const metadata = JSON.parse(fs.readFileSync(linesPath, "utf8"));
    if (metadata.coordinates === "svg-page") {
      pageLines = metadata.lines;
    } else {
      console.error(`unverified coordinates in ${linesPath} — falling back to a baseline tolerance; re-export the page with pdf2svg.py`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.error(`no ${linesPath} — falling back to a baseline tolerance; run pdf2svg.py to get exact line boundaries`);
  }
  if (pageLines !== null && !Array.isArray(pageLines)) {
    throw new Error("invalid page line metadata");
  }
  if (Array.isArray(pageLines) && !pageLines.length) {
    console.error(`no text lines in ${linesPath} — falling back to a baseline tolerance`);
    pageLines = null;
  }

  const analysis = analysePage(svg, { pageLines });
  const { pageScene, frames, rows, pitch, unframed } = analysis;
  const W = analysis.width;
  const H = analysis.height;
  const uses = pageScene.uses;
  if (!uses.length) {
    console.error(`no frameable glyph uses in ${src} — the page was not emitted`);
    return 1;
  }
  if (!rows.length) {
    throw new Error("no text rows or visible glyphs; the page was not emitted");
  }
  if (analysis.unmatchedInk) {
    console.error(`${analysis.unmatchedInk} unmatched glyph uses retained in ${analysis.inferredFromUnmatched} inferred row(s)`);
  }
  if (unframed.length) {
    console.error(`${unframed.length} uses could not be assigned to a line; retained at their original positions on the full sheet`);
  }

  const rnd = mulberry32(seed);
  const pick = 1 + Math.floor(rnd() * frames.length);
  const frame = frames[pick - 1];
  const lineUses = rows[pick - 1].glyphs;

  console.log(`${page}   width ${num(W)}   ${uses.length} glyph uses   ${frames.length} lines`);
  console.log(`assigned ${rows.reduce((n, r) => n + r.glyphs.length, 0)}/${uses.length} glyph uses; ${unframed.length} uses retained unframed on the full sheet`);
  console.log(`sizes ${[...new Set(frames.map((f) => f.size))].sort((a, b) => a - b).map(num).join(", ")}`);
  const blank = blankOf(frame, pitch);
  console.log(`pitch ${pitch ? num(pitch) : "— (not uniform)"}   slot ${fixed(frame.slot)}   blank ${blank === null ? "—" : fixed(blank)}`);
  console.log(`band ${fixed(frame.band, 3)}  E ${fixed(frame.E)}  rules ${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => fixed(v)).join(" / ")}`);
  console.log(`random line ${pick} of ${frames.length}   baseline ${fixed(frame.baseline)}   ${lineUses.length} glyphs`);

  let bad = 0;
  let unchecked = 0;
  for (const f of frames) {
    const glyphs = rows[f.index - 1].glyphs;
    if (glyphs.some((u) => u.fullPage)) {
      unchecked += 1;
      continue;
    }
    const o = overflow(f, glyphs);
    if (!o.ok) {
      bad += 1;
      console.log(`  ! line ${f.index} (size ${num(f.size)}, band ${fixed(f.band, 3)}) ink ${fixed(o.above)} above / ${fixed(o.below)} below`);
    }
  }
  const fitNote = unchecked ? `; ${unchecked} not assessed for strokes or effects` : "";
  console.log(`fit: ${frames.length - bad - unchecked}/${frames.length} lines inside the rules${fitNote}`);

  const lineFullPage = lineUses.some((u) => u.fullPage);
  const keep = parseLines(only, frames.length);
  const selected = keep === null ? frames : frames.filter((f) => keep.has(f.index));
  const sheetFullPage = (keep === null || selected.length === frames.length)
    || selected.some((f) => rows[f.index - 1].glyphs.some((u) => u.fullPage));
  if (lineFullPage || (keep !== null && selected.length !== frames.length && sheetFullPage)) {
    console.error("stroke or effects present; retained the source page viewport to avoid clipping a selected use");
  }

  const lineOutput = lineSvgFor(analysis, pick, { label: `${page} line ${pick}` });
  const sheetOutput = sheetSvgFor(analysis, { only });
  fs.mkdirSync("known", { recursive: true });
  fs.writeFileSync(path.join("known", `line-sample${suffix}.svg`), lineOutput, "utf8");
  fs.writeFileSync(path.join("known", `frame-sheet${suffix}.svg`), sheetOutput, "utf8");
  console.log(`-> known/line-sample${suffix}.svg`);
  console.log(`-> known/frame-sheet${suffix}.svg`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv) ?? 0);
}
