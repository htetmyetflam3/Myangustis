














import fs from "node:fs";
import path from "node:path";

import { VECTOR_MAP_DIR } from "../../../_path.js";













let _bars = null;
function bars() {
  if (_bars) return _bars;
  const file = path.join(VECTOR_MAP_DIR, "shape-thresholds.json");
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    _bars = {
      byLabel: new Map(Object.entries(raw.byLabel || {})),




      composition: new Set(raw.composition || []),
      fallback: 0.0016,
    };
  } catch {
    _bars = { byLabel: new Map(), composition: new Set(), fallback: 0.012 };
  }
  return _bars;
}

const isComposition = (a, b) => {
  const t = bars().composition;
  return t.has(`${a}\u0000${b}`) || t.has(`${b}\u0000${a}`);
};







let _alias = null;
function aliasTable() {
  if (_alias !== null) return _alias;
  try {
    const file = path.join(VECTOR_MAP_DIR, "shape-alias.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    _alias = new Set((raw.pairs || []).map(([a, b]) => `${a}\u0000${b}`));
  } catch {
    _alias = new Set();
  }
  return _alias;
}


export function isCrossFontAlias(a, b) {
  const t = aliasTable();
  return t.has(`${a}\u0000${b}`) || t.has(`${b}\u0000${a}`);
}
import { loadSheet } from "./svg.js";

const DEFAULT_SHEET_PREFIX = "PYIDAUNGSU-2.5.2_REGULAR-sheet-";
const DEFAULT_GRID = 48;

let defaultIndex = null;

function allPoints(contours) {
  return contours.flatMap((contour) => contour);
}

function boundsOfPoints(points) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}


export function maskFromContours(contours, size = DEFAULT_GRID, pad = 2) {
  const points = allPoints(contours);
  if (!points.length) return null;
  const box = boundsOfPoints(points);
  if (!(box.w > 0) || !(box.h > 0)) return null;
  const room = Math.max(1, size - pad * 2);
  const scale = Math.min(room / box.w, room / box.h);
  const ox = (size - box.w * scale) / 2 - box.x0 * scale;
  const oy = (size - box.h * scale) / 2 - box.y0 * scale;
  const polys = contours.map((contour) => contour.map(([x, y]) => [x * scale + ox, y * scale + oy]));
  const mask = new Uint8Array(size * size);





  for (let y = 0; y < size; y += 1) {
    const yc = y + 0.5;
    const xs = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i += 1) {
        const [ax, ay] = poly[i];
        const [bx, by] = poly[(i + 1) % poly.length];
        if ((yc >= ay && yc < by) || (yc >= by && yc < ay)) {
          xs.push(ax + ((yc - ay) / (by - ay)) * (bx - ax));
        }
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i] - 0.5));
      const to = Math.min(size - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = from; x <= to; x += 1) mask[y * size + x] = 1;
    }
  }
  return { mask, size, aspect: box.w / box.h };
}

function inkBounds(mask, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 >= x0 && y1 >= y0 ? { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null;
}


export function normalizeRasterMask(mask, width, height, size = DEFAULT_GRID, pad = 2) {
  const box = inkBounds(mask, width, height);
  if (!box) return null;
  const room = Math.max(1, size - pad * 2);
  const scale = Math.min(room / box.w, room / box.h);
  const drawnW = box.w * scale;
  const drawnH = box.h * scale;
  const ox = (size - drawnW) / 2;
  const oy = (size - drawnH) / 2;
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = Math.floor(box.x0 + (x - ox) / scale);
      const sy = Math.floor(box.y0 + (y - oy) / scale);
      if (sx >= box.x0 && sx <= box.x1 && sy >= box.y0 && sy <= box.y1) {
        out[y * size + x] = mask[sy * width + sx];
      }
    }
  }
  return { mask: out, size, aspect: box.w / box.h };
}





export function distanceField(mask, size) {
  const diagonal = Math.SQRT2;
  const field = new Float32Array(size * size);
  for (let i = 0; i < field.length; i += 1) field[i] = mask[i] ? 0 : size * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = y * size + x;
      if (x) field[i] = Math.min(field[i], field[i - 1] + 1);
      if (y) field[i] = Math.min(field[i], field[i - size] + 1);
      if (x && y) field[i] = Math.min(field[i], field[i - size - 1] + diagonal);
      if (x + 1 < size && y) field[i] = Math.min(field[i], field[i - size + 1] + diagonal);
    }
  }
  for (let y = size - 1; y >= 0; y -= 1) {
    for (let x = size - 1; x >= 0; x -= 1) {
      const i = y * size + x;
      if (x + 1 < size) field[i] = Math.min(field[i], field[i + 1] + 1);
      if (y + 1 < size) field[i] = Math.min(field[i], field[i + size] + 1);
      if (x + 1 < size && y + 1 < size) field[i] = Math.min(field[i], field[i + size + 1] + diagonal);
      if (x && y + 1 < size) field[i] = Math.min(field[i], field[i + size - 1] + diagonal);
    }
  }
  return field;
}

function inkDistance(mask, field) {
  let sum = 0;
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    sum += field[i];
    count += 1;
  }
  return count ? sum / count : Infinity;
}


export function shapeDistance(a, b) {
  if (a.size !== b.size) throw new Error("vector masks use different grids");
  const forward = inkDistance(a.mask, b.field);
  const reverse = inkDistance(b.mask, a.field);
  const aspectPenalty = Math.abs(Math.log(Math.max(0.01, a.aspect) / Math.max(0.01, b.aspect))) * 2;
  return ((forward + reverse) / 2 + aspectPenalty) / a.size;
}

function withField(item) {
  return { ...item, field: distanceField(item.mask, item.size) };
}

export function vectorSheetFiles(dir = VECTOR_MAP_DIR) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(DEFAULT_SHEET_PREFIX) && name.endsWith(".svg"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((name) => path.join(dir, name));
}


export function loadVectorIndex(files = vectorSheetFiles(), { size = DEFAULT_GRID } = {}) {
  const byText = new Map();
  for (const file of files) {
    const sheet = loadSheet(file, 5);
    for (const entry of sheet.entries) {
      if (byText.has(entry.text)) continue;
      const raster = maskFromContours(entry.contours, size);
      if (!raster) continue;
      byText.set(entry.text, withField({
        ...raster,
        text: entry.text,
        codepoints: entry.cp,
        kind: entry.kind,
        sheet: file,
      }));
    }
  }
  return { byText, entries: [...byText.values()], files: [...files], size };
}

export function getDefaultVectorIndex() {
  if (!defaultIndex) defaultIndex = loadVectorIndex();
  return defaultIndex;
}







export function matchRasterMask(mask, width, height, {
  index = getDefaultVectorIndex(),
  candidates = null,
  maxDistance = 0.12,

  minMargin = null,
} = {}) {
  const normalized = normalizeRasterMask(mask, width, height, index.size);
  if (!normalized) return { accepted: false, reason: "empty crop", matches: [] };
  const query = withField(normalized);
  const pool = candidates
    ? [...new Set(candidates)].map((text) => index.byText.get(text)).filter(Boolean)
    : index.entries.filter((entry) => {
      const ratio = normalized.aspect / entry.aspect;
      return ratio >= 0.45 && ratio <= 2.2;
    });
  if (!pool.length) return { accepted: false, reason: "no SVG candidate", matches: [] };
  const matches = pool.map((entry) => ({
    text: entry.text,
    codepoints: entry.codepoints,
    kind: entry.kind,
    distance: shapeDistance(query, entry),
  })).sort((a, b) => a.distance - b.distance);
  const best = matches[0];
  const second = matches[1] ?? null;
  const margin = second ? second.distance - best.distance : Infinity;





  const table = bars();
  const runnerUp = matches[1]?.text ?? null;
  const freeOfMargin = runnerUp !== null && isComposition(best.text, runnerUp);





  const aliased = runnerUp !== null && !freeOfMargin && isCrossFontAlias(best.text, runnerUp);
  const need = minMargin === null
    ? (table.byLabel.get(best.text) ?? table.fallback)
    : minMargin;
  const accepted = !aliased && best.distance <= maxDistance && (freeOfMargin || margin >= need);
  return {
    accepted,
    text: accepted ? best.text : null,
    codepoints: accepted ? best.codepoints : null,
    distance: best.distance,
    margin,
    matches: matches.slice(0, 8),
    need,
    reason: accepted
      ? null
      : aliased
        ? `cross-font alias: the witness crowd draws ${best.text} and ${runnerUp} alike, so shape cannot decide between them`
        : best.distance > maxDistance
          ? "shape too far from SVG"
          : `margin ${margin.toFixed(4)} below ${need.toFixed(4)} needed for ${best.text}`,
  };
}
