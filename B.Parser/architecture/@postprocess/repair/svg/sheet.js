/*
(Repair 9) Repair branch, position 9 in the chain - reads the vector
glyph sheets the shape matcher (Repair 10) compares against.
This module parses one sheet SVG (glyph outlines in <defs>, labelled
glyph groups placed with <use>) into flat contours per entry.
Restored from the pre-restructure repair cluster; the group pattern
also accepts today's sheets, whose groups carry data-y instead of
the old data-x. Only the sheet reading lives here - matching is
Repair 10, voting is Repair 11.
*/
import fs from "node:fs";
export function parsePathData(d, steps = 8) {
  const toks = d.match(/[MCLZmclzHhVvSsQqTtAa]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const subs = [];
  let cur = null; let x = 0; let y = 0; let sx = 0; let sy = 0; let i = 0;
  const cubic = (x0, y0, x1, y1, x2, y2, x3, y3) => {
    for (let s = 1; s <= steps; s += 1) {
      const t = s / steps; const u = 1 - t;
      cur.push([
        u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
  };
  const num = () => +toks[i++];
  while (i < toks.length) {
    const c = toks[i];
    if (c === "M" || c === "m") {
      i += 1; const nx = num(); const ny = num();
      x = c === "M" ? nx : x + nx; y = c === "M" ? ny : y + ny;
      sx = x; sy = y; cur = [[x, y]]; subs.push(cur);
    } else if (c === "C" || c === "c") {
      i += 1;
      const a = num(); const b = num(); const cc = num(); const dd = num(); const e = num(); const f = num();
      const rel = c === "c";
      cubic(x, y, rel ? x + a : a, rel ? y + b : b, rel ? x + cc : cc, rel ? y + dd : dd, rel ? x + e : e, rel ? y + f : f);
      x = rel ? x + e : e; y = rel ? y + f : f;
    } else if (c === "L" || c === "l") {
      i += 1; const a = num(); const b = num();
      x = c === "L" ? a : x + a; y = c === "L" ? b : y + b;
      if (cur) cur.push([x, y]);
    } else if (c === "Q" || c === "q") {
      i += 1;
      const a = num(); const b = num(); const e = num(); const f = num();
      const rel = c === "q";
      const qx = rel ? x + a : a; const qy = rel ? y + b : b;
      const ex = rel ? x + e : e; const ey = rel ? y + f : f;
      for (let s2 = 1; s2 <= steps; s2 += 1) {
        const t = s2 / steps; const u = 1 - t;
        cur.push([u * u * x + 2 * u * t * qx + t * t * ex, u * u * y + 2 * u * t * qy + t * t * ey]);
      }
      x = ex; y = ey;
    } else if (c === "H" || c === "h") { i += 1; const a = num(); x = c === "H" ? a : x + a; if (cur) cur.push([x, y]); }
    else if (c === "V" || c === "v") { i += 1; const a = num(); y = c === "V" ? a : y + a; if (cur) cur.push([x, y]); }
    else if (c === "Z" || c === "z") { i += 1; if (cur) cur.push([sx, sy]); x = sx; y = sy; }
    else if (!Number.isNaN(+c)) {

      const a = num(); const b = num(); const cc = num(); const dd = num(); const e = num(); const f = num();
      if ([a, b, cc, dd, e, f].some(Number.isNaN)) break;
      cubic(x, y, a, b, cc, dd, e, f); x = e; y = f;
    } else i += 1;
  }
  return subs.filter((s) => s.length > 2);
}
export function loadSvgContours(file, steps = 8) {
  const svg = fs.readFileSync(file, "utf8");
  const ds = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  return ds.flatMap((d) => parsePathData(d, steps));
}
export function bboxOf(contour) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of contour) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}
export function areaOf(contour) {
  let a = 0;
  for (let i = 0; i < contour.length; i += 1) {
    const [x1, y1] = contour[i];
    const [x2, y2] = contour[(i + 1) % contour.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}
export function loadSheet(file, steps = 8) {
  const svg = fs.readFileSync(file, "utf8");
  const defs = new Map();
  const defsBlock = svg.slice(svg.indexOf("<defs>"), svg.indexOf("</defs>") + 7);
  for (const m of defsBlock.matchAll(/<path\s+id="([^"]+)"\s+d="([^"]+)"\s*\/>/g)) {
    defs.set(m[1], parsePathData(m[2], steps));
  }
  const entries = [];
  for (const g of svg.matchAll(/<g\s+id="([^"]*)"\s+data-kind="([^"]*)"\s+data-cp="([^"]*)"\s+data-row="([^"]*)"(?:\s+data-[xy]="([^"]*)")?\s+data-baseline="([^"]*)"\s*>([\s\S]*?)<\/g>/g)) {
    const [, text, kind, cp, row, x, baseline, inner] = g;
    const contours = [];
    for (const u of inner.matchAll(/<use\s+href="#([^"]+)"\s+x="([^"]+)"\s+y="([^"]+)"\s*\/>/g)) {
      const base = defs.get(u[1]);
      if (!base) continue;
      const dx = Number(u[2]); const dy = Number(u[3]);
      for (const c of base) contours.push(c.map(([px, py]) => [px + dx, py + dy]));
    }
    if (contours.length) {
      entries.push({
        text, kind,
        // Canonical codepoint labels: today's sheet writes lowercase
        // hex (U+103c); every consumer compares uppercase (U+103C).
        cp: cp.replace(/u\+([0-9a-f]+)/gi, (_, hex) => "U+" + hex.toUpperCase()),
        row: Number(row), x: Number(x), baseline: Number(baseline),
        contours, shapes: contours.map((c) => ({ contour: c, box: bboxOf(c), area: areaOf(c) })),
      });
    }
  }
  const meta = {};
  const head = svg.slice(0, svg.indexOf(">", svg.indexOf("<svg")));
  for (const m of head.matchAll(/\b(data-[\w-]+|width|height)="([^"]*)"/g)) meta[m[1]] = m[2];
  return { meta, entries, glyphCount: defs.size };
}
