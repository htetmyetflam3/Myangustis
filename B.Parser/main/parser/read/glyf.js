















import { loadFont, TtfFont } from "./ttf.js";

const ON_CURVE = 0x01;
const X_SHORT = 0x02;
const Y_SHORT = 0x04;
const REPEAT = 0x08;
const X_SAME = 0x10;
const Y_SAME = 0x20;

const ARG_1_AND_2_ARE_WORDS = 0x0001;
const ARGS_ARE_XY_VALUES = 0x0002;
const MORE_COMPONENTS = 0x0020;
const WE_HAVE_A_SCALE = 0x0008;
const WE_HAVE_AN_X_AND_Y_SCALE = 0x0040;
const WE_HAVE_A_TWO_BY_TWO = 0x0080;


function glyphRange(font, gid) {
  const loca = font.tables.get("loca");
  const glyf = font.tables.get("glyf");
  if (!loca || !glyf || gid < 0 || gid >= font.numGlyphs) return null;
  const long = font.indexToLocFormat !== 0;
  const at = (i) => (long
    ? font.data.readUInt32BE(loca.offset + i * 4)
    : font.data.readUInt16BE(loca.offset + i * 2) * 2);
  const start = at(gid);
  const end = at(gid + 1);
  if (end <= start) return null;
  return { offset: glyf.offset + start, length: end - start };
}





export function glyphContours(font, gid, depth = 0) {
  if (depth > 4) return [];
  const range = glyphRange(font, gid);
  if (!range) return [];
  const d = font.data;
  let p = range.offset;
  const numberOfContours = d.readInt16BE(p);
  p += 10;

  if (numberOfContours < 0) {

    const out = [];
    for (;;) {
      const flags = d.readUInt16BE(p); p += 2;
      const glyphIndex = d.readUInt16BE(p); p += 2;
      let dx = 0; let dy = 0;
      if (flags & ARG_1_AND_2_ARE_WORDS) {
        if (flags & ARGS_ARE_XY_VALUES) { dx = d.readInt16BE(p); dy = d.readInt16BE(p + 2); }
        p += 4;
      } else {
        if (flags & ARGS_ARE_XY_VALUES) { dx = d.readInt8(p); dy = d.readInt8(p + 1); }
        p += 2;
      }
      if (flags & WE_HAVE_A_SCALE) p += 2;
      else if (flags & WE_HAVE_AN_X_AND_Y_SCALE) p += 4;
      else if (flags & WE_HAVE_A_TWO_BY_TWO) p += 8;
      for (const contour of glyphContours(font, glyphIndex, depth + 1)) {
        out.push(contour.map((pt) => ({ x: pt.x + dx, y: pt.y + dy, onCurve: pt.onCurve })));
      }
      if (!(flags & MORE_COMPONENTS)) break;
    }
    return out;
  }

  const endPts = [];
  for (let i = 0; i < numberOfContours; i += 1) { endPts.push(d.readUInt16BE(p)); p += 2; }
  const numPoints = numberOfContours ? endPts[endPts.length - 1] + 1 : 0;
  const instrLen = d.readUInt16BE(p); p += 2 + instrLen;

  const flags = new Uint8Array(numPoints);
  for (let i = 0; i < numPoints;) {
    const f = d.readUInt8(p); p += 1;
    flags[i] = f; i += 1;
    if (f & REPEAT) {
      let n = d.readUInt8(p); p += 1;
      while (n-- > 0 && i < numPoints) { flags[i] = f; i += 1; }
    }
  }

  const xs = new Int32Array(numPoints);
  let x = 0;
  for (let i = 0; i < numPoints; i += 1) {
    const f = flags[i];
    if (f & X_SHORT) { const v = d.readUInt8(p); p += 1; x += (f & X_SAME) ? v : -v; }
    else if (!(f & X_SAME)) { x += d.readInt16BE(p); p += 2; }
    xs[i] = x;
  }
  const ys = new Int32Array(numPoints);
  let y = 0;
  for (let i = 0; i < numPoints; i += 1) {
    const f = flags[i];
    if (f & Y_SHORT) { const v = d.readUInt8(p); p += 1; y += (f & Y_SAME) ? v : -v; }
    else if (!(f & Y_SAME)) { y += d.readInt16BE(p); p += 2; }
    ys[i] = y;
  }

  const contours = [];
  let start = 0;
  for (const end of endPts) {
    const c = [];
    for (let i = start; i <= end && i < numPoints; i += 1) {
      c.push({ x: xs[i], y: ys[i], onCurve: Boolean(flags[i] & ON_CURVE) });
    }
    if (c.length) contours.push(c);
    start = end + 1;
  }
  return contours;
}






export function codepointCloud(font, codePoint, { samplesPerSegment = 3 } = {}) {
  const gid = font.glyphId(codePoint);
  if (!gid) return null;
  const contours = glyphContours(font, gid);
  if (!contours.length) return null;
  const upm = font.unitsPerEm || 1000;
  const pts = [];
  for (const c of contours) {
    for (let i = 0; i < c.length; i += 1) {
      const a = c[i];
      const b = c[(i + 1) % c.length];
      for (let s = 0; s < samplesPerSegment; s += 1) {
        const t = s / samplesPerSegment;
        pts.push([(a.x + (b.x - a.x) * t) / upm, (a.y + (b.y - a.y) * t) / upm]);
      }
    }
  }
  return pts.length ? pts : null;
}

export { loadFont, TtfFont };
