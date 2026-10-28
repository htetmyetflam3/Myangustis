import { ttfTables } from "./ttf-cmap.js";

































const u16 = (d, o) => (o + 2 <= d.length ? d.readUInt16BE(o) : 0);
const i16 = (d, o) => (o + 2 <= d.length ? d.readInt16BE(o) : 0);
const u32 = (d, o) => (o + 4 <= d.length ? d.readUInt32BE(o) : 0);


function coverage(d, off) {
  const out = [];
  const fmt = u16(d, off);
  if (fmt === 1) {
    const count = u16(d, off + 2);
    for (let i = 0; i < count; i += 1) {
      const at = off + 4 + i * 2;
      if (at + 2 > d.length) break;
      out.push(u16(d, at));
    }
  } else if (fmt === 2) {
    const count = u16(d, off + 2);
    for (let i = 0; i < count; i += 1) {
      const at = off + 4 + i * 6;
      if (at + 6 > d.length) break;
      const start = u16(d, at);
      const end = u16(d, at + 2);
      for (let g = start; g <= end && g <= 0xffff; g += 1) out.push(g);
    }
  }
  return out;
}








const MAX_STEPS = 2_000_000;

export function parseTtfGsubReverse(data) {
  const out = new Map();
  let budget = MAX_STEPS;
  const spend = (n) => { budget -= n; return budget > 0; };
  if (!data || data.length < 12) return out;

  const tables = ttfTables(data);







  if (!tables.has("GSUB")) return out;
  const d = data;
  const gsubOff = tables.get("GSUB")[0];
  if (gsubOff + 10 > d.length) return out;
  const version = u32(d, gsubOff);
  if (version !== 0x00010000 && version !== 0x00010001) return out;

  const lookupList = gsubOff + u16(d, gsubOff + 8);
  const lookupCount = u16(d, lookupList);
  const singles = new Map();

  for (let i = 0; i < lookupCount; i += 1) {
    if (!spend(1)) break;
    const lo = lookupList + u16(d, lookupList + 2 + i * 2);
    if (lo + 6 > d.length) break;
    let lookupType = u16(d, lo);
    const subCount = u16(d, lo + 4);
    for (let s = 0; s < subCount; s += 1) {
      if (!spend(1)) break;
      let so = lo + u16(d, lo + 6 + s * 2);
      let type = lookupType;

      if (lookupType === 7) {
        if (so + 8 > d.length) continue;
        type = u16(d, so + 2);
        so += u32(d, so + 4);
      }
      if (so + 6 > d.length) continue;

      if (type === 1) {


        const fmt = u16(d, so);
        const cov = coverage(d, so + u16(d, so + 2));
        if (!spend(cov.length)) break;
        if (fmt === 1) {
          const delta = i16(d, so + 4);
          for (const gi of cov) {
            const outG = (gi + delta) & 0xffff;
            if (outG !== gi && !singles.has(outG)) singles.set(outG, gi);
          }
        } else if (fmt === 2) {
          const count = u16(d, so + 4);
          for (let k = 0; k < count && k < cov.length; k += 1) {
            const outG = u16(d, so + 6 + k * 2);
            if (outG !== cov[k] && !singles.has(outG)) singles.set(outG, cov[k]);
          }
        }
      } else if (type === 4) {




        const cov = coverage(d, so + u16(d, so + 2));
        const setCount = u16(d, so + 4);





        const sets = Math.min(cov.length, setCount);
        if (!spend(sets)) break;
        for (let k = 0; k < sets; k += 1) {
          const first = cov[k];
          if (!first) continue;
          const lso = so + u16(d, so + 6 + k * 2);
          if (lso + 2 > d.length) break;
          const ligCount = u16(d, lso);
          if (!spend(ligCount)) break;
          for (let l = 0; l < ligCount; l += 1) {
            const lig = lso + u16(d, lso + 2 + l * 2);
            if (lig + 4 > d.length) break;
            const outG = u16(d, lig);
            const compCount = u16(d, lig + 2);
            if (!outG || outG === first || singles.has(outG) || out.has(outG)) continue;
            const comps = [cov[k]];
            let bad = false;
            for (let c = 1; c < compCount; c += 1) {
              const at = lig + 2 + c * 2;
              if (at + 2 > d.length) { bad = true; break; }
              const g = u16(d, at);
              if (!g || g === outG) { bad = true; break; }
              comps.push(g);
            }
            if (!bad) out.set(outG, comps);
          }
        }
      }




    }
  }

  for (const [outG, inG] of singles) if (!out.has(outG)) out.set(outG, [inG]);
  return out;
}




























export function parseTtfVariantSlots(data) {
  const groups = new Map();
  if (!data || data.length < 12) return [];
  let budget = MAX_STEPS;

  const tables = ttfTables(data);
  if (!tables.has("GSUB")) return [];
  const gsubOff = tables.get("GSUB")[0];
  if (gsubOff + 10 > data.length) return [];
  const version = u32(data, gsubOff);
  if (version !== 0x00010000 && version !== 0x00010001) return [];

  const d = data;
  const lookupList = gsubOff + u16(d, gsubOff + 8);
  const lookupCount = u16(d, lookupList);
  const sequences = [];

  for (let i = 0; i < lookupCount; i += 1) {
    if (budget <= 0) break;
    const lo = lookupList + u16(d, lookupList + 2 + i * 2);
    if (lo + 6 > d.length) break;
    let lookupType = u16(d, lo);
    const subCount = u16(d, lo + 4);
    for (let s = 0; s < subCount; s += 1) {
      budget -= 1;
      if (budget <= 0) break;
      let so = lo + u16(d, lo + 6 + s * 2);
      if (lookupType === 7) {
        if (so + 8 > d.length) continue;
        so += u32(d, so + 4);
        if (u16(d, so) !== 2) continue;
      } else if (lookupType !== 2) {
        continue;
      }
      if (u16(d, so) !== 1) continue;
      const cov = coverage(d, so + u16(d, so + 2));
      const count = u16(d, so + 4);
      for (let k = 0; k < count && k < cov.length; k += 1) {
        const sqo = so + u16(d, so + 6 + k * 2);
        if (sqo + 2 > d.length) break;
        const glyphCount = u16(d, sqo);
        budget -= glyphCount;
        if (budget <= 0) break;
        if (sqo + 2 + glyphCount * 2 > d.length) continue;
        const members = [];
        for (let q = 0; q < glyphCount; q += 1) members.push(u16(d, sqo + 2 + q * 2));
        const base = cov[k];
        const baseAt = members.indexOf(base);
        if (baseAt === -1 || members.length < 2) continue;
        sequences.push({ members, baseAt });
      }
    }
  }







  const together = new Set();
  for (const { members, baseAt } of sequences) {
    for (let i = 0; i < members.length; i += 1) {
      if (i === baseAt) continue;
      for (let j = i + 1; j < members.length; j += 1) {
        if (j === baseAt) continue;
        const a = members[i];
        const b = members[j];
        if (a && b) together.add(a < b ? `${a},${b}` : `${b},${a}`);
      }
    }
  }



  for (const { members, baseAt } of sequences) {
    for (let p = 0; p < members.length; p += 1) {
      if (p === baseAt) continue;
      const gid = members[p];
      if (!gid) continue;
      const key = `${members.length}:${baseAt}:${p}:`
        + members.map((g, i) => (i === p ? "*" : String(g))).join(",");
      let set = groups.get(key);
      if (set === undefined) { set = new Set(); groups.set(key, set); }
      set.add(gid);
    }
  }

  const out = [];
  for (const set of groups.values()) {
    const members = [...set];
    if (members.length < 2) continue;
    let split = false;
    for (let i = 0; i < members.length && !split; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i];
        const b = members[j];
        if (together.has(a < b ? `${a},${b}` : `${b},${a}`)) { split = true; break; }
      }
    }
    if (!split) out.push(members);
  }
  return out;
}
