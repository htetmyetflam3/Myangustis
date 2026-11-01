import { ValueError } from "./pylib.js";


















function readU16PythonSlice(buf, a) {
  let start = a < 0 ? buf.length + a : a;
  let stop = a + 2;
  if (stop < 0) stop = buf.length + stop;
  start = Math.min(Math.max(start, 0), buf.length);
  stop = Math.min(Math.max(stop, 0), buf.length);
  if (stop - start !== 2) throw new ValueError("unpack requires a buffer of 2 bytes");
  return buf.readUInt16BE(start);
}

























const SUBTABLE_RANK = [
  [3, 10, 100],
  [0, 4, 95],
  [0, 6, 90],
  [3, 1, 85],
  [0, 3, 80],
  [0, 0, 70],
  [0, 1, 70],
  [0, 2, 70],
  [3, 0, 60],
  [1, 0, 30],
];

function subtableRank(plat, enc) {
  for (const [p, e, rank] of SUBTABLE_RANK) {
    if (p === plat && e === enc) return rank;
  }
  return 10;
}


function readSubtable(sub, out) {
  if (sub.length < 2) return 0;
  const fmt = sub.readUInt16BE(0);
  if (fmt === 4) {
    if (sub.length < 14) return 0;
    const segCount = sub.readUInt16BE(6) >> 1;
    if (sub.length < 14 + segCount * 8) return 0;
    const ends = [];
    for (let i = 0; i < segCount; i += 1) ends.push(sub.readUInt16BE(14 + i * 2));
    const so = 14 + segCount * 2 + 2;
    const starts = [];
    for (let i = 0; i < segCount; i += 1) starts.push(sub.readUInt16BE(so + i * 2));
    const doff = so + segCount * 2;
    const deltas = [];
    for (let i = 0; i < segCount; i += 1) deltas.push(sub.readInt16BE(doff + i * 2));
    const ro = doff + segCount * 2;
    const ranges = [];
    for (let i = 0; i < segCount; i += 1) ranges.push(sub.readUInt16BE(ro + i * 2));
    for (let j = 0; j < segCount; j += 1) {
      if (starts[j] === 0xffff) continue;
      for (let c = starts[j]; c <= ends[j]; c += 1) {
        let gid;
        if (ranges[j] === 0) {
          gid = (c + deltas[j]) & 0xffff;
        } else {

















          const idx = ((ranges[j] / 2) | 0) + (c - starts[j]) + j;
          const addr = ro + idx * 2;
          if (addr + 2 > sub.length) continue;
          gid = readU16PythonSlice(sub, addr);
          if (gid) gid = (gid + deltas[j]) & 0xffff;
        }
        if (gid) out.set(c, gid);
      }
    }
  } else if (fmt === 0) {





    const count = Math.min(256, sub.length - 6);
    if (count < 8) return 0;
    for (let c = 0; c < count; c += 1) {
      const gid = sub[6 + c];
      if (gid) out.set(c, gid);
    }
  } else if (fmt === 6) {
    if (sub.length < 10) return 0;
    const firstCode = sub.readUInt16BE(6);
    const entryCount = sub.readUInt16BE(8);
    for (let j = 0; j < entryCount; j += 1) {
      if (10 + j * 2 + 2 > sub.length) break;
      const gid = sub.readUInt16BE(10 + j * 2);
      if (gid) out.set(firstCode + j, gid);
    }
  } else if (fmt === 12) {
    if (sub.length < 16) return 0;
    const numGroups = sub.readUInt32BE(12);
    let go = 16;
    for (let g = 0; g < numGroups; g += 1) {
      if (go + 12 > sub.length) break;
      const sc = sub.readUInt32BE(go);
      const ec = sub.readUInt32BE(go + 4);
      const sg = sub.readUInt32BE(go + 8);
      go += 12;
      for (let c = sc; c <= ec; c += 1) out.set(c, sg + (c - sc));
    }
  }
  return out.size;
}



export function ttfTables(data) {
  const out = new Map();
  if (!data || data.length < 12) return out;
  const numTables = data.readUInt16BE(4);
  let off = 12;
  for (let t = 0; t < numTables; t += 1) {
    if (off + 16 > data.length) break;
    const tag = data.toString("latin1", off, off + 4);
    out.set(tag, [data.readUInt32BE(off + 8), data.readUInt32BE(off + 12)]);
    off += 16;
  }
  return out;
}

export function parseTtfCmap(data) {
  if (!data || data.length < 12) return new Map();
  const tbls = ttfTables(data);
  if (!tbls.has("cmap")) return new Map();
  const cmapOff = tbls.get("cmap")[0];
  if (cmapOff + 4 > data.length) return new Map();
  const cmap = data.subarray(cmapOff);
  const numSub = cmap.readUInt16BE(2);

  const subs = [];
  let off = 4;
  for (let s = 0; s < numSub; s += 1) {
    if (off + 8 > cmap.length) break;
    const plat = cmap.readUInt16BE(off);
    const enc = cmap.readUInt16BE(off + 2);
    const subOff = cmap.readUInt32BE(off + 4);
    off += 8;
    if (subOff + 2 > cmap.length) continue;
    subs.push({ plat, enc, subOff, rank: subtableRank(plat, enc), order: s });
  }


  subs.sort((a, b) => (b.rank - a.rank) || (a.order - b.order));

  for (const entry of subs) {
    const mappings = new Map();
    if (readSubtable(cmap.subarray(entry.subOff), mappings) > 0) return mappings;
  }
  return new Map();
}
