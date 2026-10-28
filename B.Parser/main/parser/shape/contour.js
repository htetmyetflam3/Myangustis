


































const SAMPLES = 64;



function polygonArea(points) {
  let sum = 0;
  for (let i = 0, n = points.length; i < n; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function bounds(points) {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const [x, y] of points) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}







function resample(points, count) {
  const n = points.length;
  if (n < 2) return new Array(count).fill(points[0] ?? [0, 0]);
  const seg = [];
  let total = 0;
  for (let i = 0; i < n; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    const d = Math.hypot(bx - ax, by - ay);
    seg.push(d);
    total += d;
  }
  if (total === 0) return new Array(count).fill(points[0]);

  const out = [];
  const step = total / count;
  let i = 0;
  let carried = 0;
  for (let k = 0; k < count; k += 1) {
    let want = k * step;
    while (i < n - 1 && carried + seg[i] < want) { carried += seg[i]; i += 1; }
    const t = seg[i] > 0 ? (want - carried) / seg[i] : 0;
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % n];
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
  return out;
}










export function glyphSignature(contours, { samples = SAMPLES } = {}) {
  const usable = (contours || []).filter((c) => Array.isArray(c) && c.length >= 3);
  if (!usable.length) return null;

  const box = bounds(usable.flat());
  const scale = Math.max(box.w, box.h) || 1;
  const areas = usable.map(polygonArea);
  const total = areas.reduce((a, b) => a + b, 0) || 1;



  const order = usable
    .map((c, i) => ({ c, area: areas[i] }))
    .sort((a, b) => b.area - a.area);

  return {
    count: usable.length,
    aspect: box.h > 0 ? box.w / box.h : 1,
    areas: order.map((o) => o.area / total),
    points: order.map((o) => resample(o.c, samples).map(
      ([x, y]) => [(x - box.x0) / scale, (y - box.y0) / scale],
    )),
  };
}




function cloudDistance(a, b, stride = 1) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += stride) {
    const [ax, ay] = a[i];
    let best = Infinity;
    for (let j = 0; j < b.length; j += stride) {
      const d = (ax - b[j][0]) ** 2 + (ay - b[j][1]) ** 2;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best); n += 1;
  }
  for (let j = 0; j < b.length; j += stride) {
    const [bx, by] = b[j];
    let best = Infinity;
    for (let i = 0; i < a.length; i += stride) {
      const d = (a[i][0] - bx) ** 2 + (a[i][1] - by) ** 2;
      if (d < best) best = d;
    }
    sum += Math.sqrt(best); n += 1;
  }
  return n ? sum / n : Infinity;
}






export function topologyMatches(a, b, { areaTolerance = 0.08, aspectTolerance = 0.22 } = {}) {
  if (!a || !b) return false;

  if (a.count !== b.count) return false;
  if (Math.abs(a.aspect - b.aspect) > aspectTolerance * Math.max(a.aspect, b.aspect)) return false;
  for (let i = 0; i < a.areas.length; i += 1) {
    if (Math.abs(a.areas[i] - b.areas[i]) > areaTolerance) return false;
  }
  return true;
}

















export function contourDistance(a, b, options = {}) {
  const penalty = options.topologyPenalty ?? null;
  if (!topologyMatches(a, b, options)) {
    if (penalty === null) return Infinity;


    const d = cloudDistance(a.points[0], b.points[0], options.stride ?? 1);
    return d + penalty * Math.abs(a.count - b.count);
  }
  const stride = options.stride ?? 1;
  let sum = 0;
  for (let i = 0; i < a.points.length; i += 1) {
    sum += cloudDistance(a.points[i], b.points[i], stride);
  }
  return sum / a.points.length;
}







export function matchContours(signature, index, { maxDistance = 0.08, minMargin = 0.004 } = {}) {
  if (!signature) return { accepted: false, reason: 'empty glyph', matches: [] };

  const viable = [];
  for (const entry of index) {
    if (!topologyMatches(signature, entry.signature)) continue;
    viable.push(entry);
  }
  if (!viable.length) {
    return { accepted: false, reason: `no candidate with ${signature.count} contour(s)`, matches: [], considered: 0 };
  }





  const coarse = viable
    .map((entry) => ({ entry, d: contourDistance(signature, entry.signature, { stride: 4 }) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, 12);

  const scored = coarse
    .map(({ entry }) => ({ text: entry.text, distance: contourDistance(signature, entry.signature) }))
    .sort((x, y) => x.distance - y.distance);

  const best = scored[0];
  const margin = scored.length > 1 ? scored[1].distance - best.distance : Infinity;
  const accepted = best.distance <= maxDistance && margin >= minMargin;
  return {
    accepted,
    text: accepted ? best.text : null,
    distance: best.distance,
    margin,
    considered: viable.length,
    matches: scored.slice(0, 5),
    reason: accepted ? null
      : best.distance > maxDistance ? 'shape too far' : 'ambiguous among same-topology candidates',
  };
}


export function buildContourIndex(entries, options = {}) {
  const index = [];
  for (const entry of entries) {
    const signature = glyphSignature(entry.contours, options);
    if (signature) index.push({ text: entry.text, signature });
  }
  return index;
}




















export function buildFontIndex(fontFile, texts, { loadFont, glyphContours, samples = SAMPLES, codePage = null } = {}) {
  if (typeof loadFont !== 'function' || typeof glyphContours !== 'function') {
    throw new TypeError('buildFontIndex needs loadFont and glyphContours');
  }
  const font = loadFont(fontFile);
  const upm = font.unitsPerEm || 1000;
  const index = [];
  const missing = [];







  if (codePage) {
    for (const [code, text] of codePage) {
      const gid = font.glyphId(code);
      if (!gid) { missing.push(text); continue; }
      const raw = glyphContours(font, gid);
      if (!raw || !raw.length) { missing.push(text); continue; }
      const signature = glyphSignature(
        raw.map((c) => c.map((pt) => [pt.x / upm, pt.y / upm])), { samples },
      );
      if (signature) index.push({ text, code, signature });
      else missing.push(text);
    }
    return { index, missing, font: fontFile, via: 'code-page' };
  }

  for (const text of texts) {


    const cps = [...text];
    if (cps.length !== 1) continue;
    const gid = font.glyphId(cps[0].codePointAt(0));
    if (!gid) { missing.push(text); continue; }
    const raw = glyphContours(font, gid);
    if (!raw || !raw.length) { missing.push(text); continue; }
    const signature = glyphSignature(raw.map((c) => c.map((pt) => [pt.x / upm, pt.y / upm])), { samples });
    if (signature) index.push({ text, signature });
    else missing.push(text);
  }
  return { index, missing, font: fontFile, via: 'unicode' };
}
