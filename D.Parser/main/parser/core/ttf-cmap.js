import { ValueError } from "./pylib.mjs";

/**
 * FILE: Parsed/parser/core/ttf-cmap.mjs
 *
 * TrueType `cmap` table reader: font bytes -> Map<codepoint, glyphId>.
 *
 * Foundation, not a stage. Both sides of the parser need it -- `read/`
 * decodes an embedded font program, `write/` subsets an output font -- so it
 * lives below both. It previously sat in read/pdf-extract.mjs, which made the
 * writer import the extractor: the only backwards edge in the whole graph.
 * Logic is unchanged; only its address moved.
 */

/* Reads two bytes the way Python's struct.unpack does on a slice: a short
   buffer is an error, not a silent zero. Moved here with parseTtfCmap, its
   only caller -- it was left behind in read/pdf-extract.mjs when the function
   moved, which broke every PDF write with "readU16PythonSlice is not
   defined". */
function readU16PythonSlice(buf, a) {
  let start = a < 0 ? buf.length + a : a;
  let stop = a + 2;
  if (stop < 0) stop = buf.length + stop;
  start = Math.min(Math.max(start, 0), buf.length);
  stop = Math.min(Math.max(stop, 0), buf.length);
  if (stop - start !== 2) throw new ValueError("unpack requires a buffer of 2 bytes");
  return buf.readUInt16BE(start);
}

/**
 * Which cmap subtable speaks Unicode.
 *
 * A font carries several -- a Windows BMP table, a Unicode full-repertoire
 * table, and very often a Macintosh table -- and they are NOT different views
 * of the same codes. Platform 1 encoding 0 is Mac Roman, where 0x8E is an
 * e-acute, not U+008E. Every subtable used to be read into one Map, so the
 * Mac table overwrote the Unicode one for each code it also defined, and the
 * result was a single table in which the ASCII range came from one encoding
 * and the rest from another.
 *
 * That is not a rounding error for Myanmar: the whole script lives above
 * U+1000, i.e. entirely inside the range the Mac table clobbers. On an
 * Identity-H Myanmar3 subset the gid for U+1004 (င) and the gid for
 * Mac-Roman 0x1004 (which does not exist) are different questions, and the
 * blended table answered the wrong one -- half the glyph ids resolved to
 * nothing, fell through to the identity fallback, and came out of the
 * extractor as Latin-1 (`စပàဘငé`).
 *
 * So: rank the subtables, read the best one, and never blend. A lower-ranked
 * subtable is read only when every better one yields nothing, which is the
 * one case the old code got right by accident -- a Type 42 legacy subset
 * whose only subtable is Mac format 0.
 */
const SUBTABLE_RANK = [
  [3, 10, 100], // Windows, UCS-4
  [0, 4, 95],   // Unicode, full repertoire
  [0, 6, 90],   // Unicode, full repertoire (BMP + planes)
  [3, 1, 85],   // Windows, BMP
  [0, 3, 80],   // Unicode, BMP (deprecated but common)
  [0, 0, 70],   // Unicode, version 1.0 semantics
  [0, 1, 70],
  [0, 2, 70],
  [3, 0, 60],   // Windows Symbol: codes are 0xF000-0xF0FF, not Unicode
  [1, 0, 30],   // Macintosh Roman
];

function subtableRank(plat, enc) {
  for (const [p, e, rank] of SUBTABLE_RANK) {
    if (p === plat && e === enc) return rank;
  }
  return 10;
}

/** Reads one subtable into `out`. Returns the number of entries added. */
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
          /* The spec's index into glyphIdArray, in uint16 units:
             idRangeOffset[j]/2 + (c - startCode[j]) + j.

             The `+ j` is the segment's own position in idRangeOffset -- the
             offset is measured from that element, not from the start of the
             array. This read `+ j - segCount` for a long time, which silently
             shifted every lookup in an idRangeOffset segment by one whole
             segment table. Delta-only segments (idRangeOffset 0) never touch
             this branch, so most fonts were unaffected; the ones that use
             glyphIdArray resolved to the wrong gid, and a gid of 0 is
             dropped below, so the segment simply lost its entries.

             On this book's MyanmarText subsets that hid U+103A, U+103B,
             U+103C, U+103D, U+1040-U+1049 and more: 82 real entries read as
             62. Every one of those gids then fell through to the identity
             fallback and printed as its own number -- ် came out ၏, ၁ came
             out Ɣ -- which is the mojibake on 829 of the 4,414 pages. */
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
    /* Format 0 -- the byte encoding table: 256 one-byte glyph ids, no code
       points above 0xFF. This is the ONLY subtable a Type 42 legacy Myanmar
       subset carries, so before this branch every lookup on such a font came
       back empty and the whole outline layer was blind to a real PDF's
       embedded glyphs. */
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

/** The sfnt table directory: tag -> [offset, length]. Shared with the GSUB
 *  reader next door, which needs the same walk. */
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
  // Rank descending; the table's own order breaks ties, so the choice is
  // the same on every run regardless of how the font lists its subtables.
  subs.sort((a, b) => (b.rank - a.rank) || (a.order - b.order));

  for (const entry of subs) {
    const mappings = new Map();
    if (readSubtable(cmap.subarray(entry.subOff), mappings) > 0) return mappings;
  }
  return new Map();
}
