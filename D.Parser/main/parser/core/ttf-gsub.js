import { ttfTables } from "./ttf-cmap.mjs";

/**
 * FILE: Parsed/parser/core/ttf-gsub.mjs
 *
 * Reverse GSUB: shaped glyph id -> the glyph ids it was substituted for.
 *
 * Foundation, next to core/ttf-cmap.mjs, because it answers the same
 * question from the other end. The cmap says which code point a glyph was
 * BUILT for; GSUB says which glyph the shaper actually PUT in its place.
 *
 * Why the parser needs this at all
 * --------------------------------
 * A Myanmar PDF drawn with /Encoding /Identity-H carries glyph ids, not
 * characters. For consonants the cmap is enough: gid 0x6D is U+1004 (င) and
 * that is the end of it. The vowel signs, medials and tone marks are a
 * different story. OpenType shaping swaps them for positional variants -- the
 * tall form of ာ after အ, the dropped form of ု under ဂ, the stacked form of
 * ှ -- and each variant is a real glyph that the shaper reaches through GSUB.
 * Those variant gids are intentionally absent from the cmap: there is no code
 * point for "ာ as it looks next to အ".
 *
 * So a parser that only reads the cmap finds nothing for them, falls back to
 * reading the gid as a code point, and publishes gid 0x00E0 as U+00E0 (à),
 * gid 0x0103 as U+0103 (ă). The Myanmar comes out peppered with Latin-1 and
 * Latin Extended-B -- `စပàဘငé` -- which is the single most common complaint
 * about extracting this script, and it is not a Zawgyi problem at all.
 *
 * This module walks the substitution lookups backwards, so a shaped gid can be
 * traced to the gid it replaced, and that one is in the cmap. It is a reader,
 * not a shaper: nothing here decides what a sequence should look like, it
 * only reports what the font's own tables say was substituted.
 */

const u16 = (d, o) => (o + 2 <= d.length ? d.readUInt16BE(o) : 0);
const i16 = (d, o) => (o + 2 <= d.length ? d.readInt16BE(o) : 0);
const u32 = (d, o) => (o + 4 <= d.length ? d.readUInt32BE(o) : 0);

/** Coverage table -> the glyph ids it covers, in index order. */
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

/**
 * @param {Buffer} data raw font bytes (or the bare GSUB table)
 * @returns {Map<number, number[]>} output gid -> the gid sequence it replaced
 */
/* A whole-document extraction reads this once per embedded font, so a single
   malformed table must not be able to stall it. Two million steps covers any
   real Indic GSUB by two orders of magnitude. */
const MAX_STEPS = 2_000_000;

export function parseTtfGsubReverse(data) {
  const out = new Map();
  let budget = MAX_STEPS;
  const spend = (n) => { budget -= n; return budget > 0; };
  if (!data || data.length < 12) return out;

  const tables = ttfTables(data);
  /* Font bytes only. A font without a GSUB table used to be read AS a GSUB
     table, because a TrueType's sfnt version is 0x00010000 and so is GSUB's
     -- the "no directory, so this must be a bare table" test could not tell
     them apart. That read the whole font as lookup offsets and spent 27
     seconds per font walking 1,203 substitutions that were never there,
     turning a 10-second extraction into a 14-minute one. Require the
     directory entry, then check the table's own version. */
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
      // Type 7 is a wrapper: the real type and subtable live behind it.
      if (lookupType === 7) {
        if (so + 8 > d.length) continue;
        type = u16(d, so + 2);
        so += u32(d, so + 4);
      }
      if (so + 6 > d.length) continue;

      if (type === 1) {
        /* Single substitution: in -> out. The reverse of the common case,
           and the one that recovers every vowel sign and tone mark. */
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
        /* Ligature: [first, second, ...] -> one gid. Only filled for gids a
           single substitution cannot explain, and any entry naming gid 0 or
           naming itself is dropped: both are what a misread offset looks
           like, and either would make the decoder recite the glyph back. */
        const cov = coverage(d, so + u16(d, so + 2));
        const setCount = u16(d, so + 4);
        /* The spec says the coverage lists exactly one entry per ligature
           set. Fonts in the wild disagree -- a coverage format 2 whose
           ranges cover more glyphs than there are sets is common -- and
           bailing on the mismatch is how ပြီး kept its ligature glyph to
           itself and came out as `ðပီး`. Walk the overlap instead. */
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
      /* Type 2 (multiple) and type 6 (chaining contextual) are not inverted
         here. Type 2 runs forward -- one gid becomes several -- so its output
         gids are what the content stream shows, and there is nothing to walk
         back. Type 6 only selects which other lookup to apply. */
    }
  }

  for (const [outG, inG] of singles) if (!out.has(outG)) out.set(outG, [inG]);
  return out;
}

/**
 * Groups of glyph ids that sit in the same slot of parallel decompositions.
 *
 * Multiple substitution (type 2) is how a shaper reorders a syllable: it takes
 * one glyph apart and puts the pieces back in drawing order. Run for every
 * consonant in a Myanmar3 subset, the decompositions come out as families
 * that differ in exactly one position --
 *
 *     ပ -> [ 238, ပ, ZWJ ]
 *     ပ -> [ 240, ပ, ZWJ ]
 *     ပ -> [ 242, ပ, ZWJ ]
 *     ပ -> [ 246, ပ, ZWJ ]
 *
 * -- and the gids turning up in that one slot are the positional forms of a
 * single character. Here 238 is the medial ra (U+103C), 246 is the ြွ ligature,
 * and 240 and 242 are the ra's other forms. None of the four is reachable from
 * the cmap or from a substitution, which is why ပြီး kept arriving as `ðပီး`:
 * the ra was unnameable, so the decoder printed its glyph id.
 *
 * Grouping by "same length, same base position, identical everywhere but one
 * slot" recovers that set from the font's own tables, with no script knowledge
 * and nothing specific to Myanmar. The caller -- which knows each glyph's
 * Unicode -- decides which member of a group names the others.
 *
 * @param {Buffer} data raw font bytes
 * @returns {number[][]} groups of two or more interchangeable gids
 */
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
      if (u16(d, so) !== 1) continue; // only sequence format 1 is walked
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

  /* Two gids that turn up in the SAME decomposition are two different things:
     [ZWJ, 228, 240, ပ, 252, 0] draws the spacing piece and the ra form side by
     side. Without this check the slot above the base collects {228, 240} --
     the ra form from the sequence that has one, and the spacing piece from the
     one that has none -- and the ra is then named after a piece of whitespace.
     Interchangeable forms never meet. */
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

  /* One group per masked slot: the sequence with that single position blanked
     is the key, and every gid seen in the blank is a member. */
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
