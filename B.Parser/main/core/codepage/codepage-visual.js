import { createHash } from "node:crypto";
import evidence from "../../../_path.js" with { type: "json" };
import { ttfTables } from "./ttf-cmap.js";

const PREFIX_MARKS = new Set(["ေ", "ြ"]);
const MARK_TEXT = { e: "ေ", ra: "ြ", raWa: "ြွ", ya: "ျ", wa: "ွ", kinzi: "င်္" };
const isConsonant = (cp) => cp >= 0x1000 && cp <= 0x1021;
const isBase = (cp) => isConsonant(cp) || (cp >= 0x1023 && cp <= 0x1027)
  || cp === 0x1029 || cp === 0x102a || cp === 0x103f || cp === 0x104e;

// These conflicts are independent of the witness outlines: a direct cmap
// says a glyph is a consonant, but this PDF maps its code to a prefix mark,
// or its ToUnicode is already known to contain many contradictory spaces.
export function hasVisualUnicodeConflicts(decoder) {
  if (!decoder?.isCid || !decoder.toUnicode || !decoder.ownGids?.direct?.size) return false;
  const contradictions = new Set();
  const groups = decoder.toUnicode.byWidth || new Map([[2, decoder.toUnicode]]);
  for (const [width, entries] of groups) {
    for (const [code, text] of entries) {
      if (!PREFIX_MARKS.has(text) && !(decoder._conflictingSpaceMap && text === " ")) continue;
      const cid = decoder.cmap.cidFor(code, width);
      const gid = decoder.gidFor(cid);
      const cp = decoder.ownGids.direct.get(gid);
      if (isConsonant(cp)) contradictions.add(gid);
    }
  }
  return contradictions.size >= 2;
}

function simpleGlyphDigests(data) {
  if (!Buffer.isBuffer(data)) return null;
  const tables = ttfTables(data);
  const table = (name, min) => {
    const entry = tables.get(name);
    if (!entry || entry[1] < min || entry[0] > data.length || entry[1] > data.length - entry[0]) return null;
    return entry;
  };
  const head = table("head", 54);
  const maxp = table("maxp", 6);
  const loca = table("loca", 4);
  const glyf = table("glyf", 0);
  if (!head || !maxp || !loca || !glyf) return null;
  const format = data.readInt16BE(head[0] + 50);
  const count = data.readUInt16BE(maxp[0] + 4);
  if (![0, 1].includes(format) || loca[1] < (count + 1) * (format ? 4 : 2)) return null;
  const memo = new Map();
  const offset = (i) => format
    ? data.readUInt32BE(loca[0] + i * 4) : data.readUInt16BE(loca[0] + i * 2) * 2;
  return (gid) => {
    if (!Number.isInteger(gid) || gid < 0 || gid >= count) return null;
    if (memo.has(gid)) return memo.get(gid);
    const start = offset(gid);
    const end = offset(gid + 1);
    let hash = null;
    if (start <= end && end <= glyf[1] && end - start >= 10) {
      const bytes = data.subarray(glyf[0] + start, glyf[0] + end);
      // Empty and composite glyphs cannot be compared this way.
      if (bytes.readInt16BE(0) > 0) hash = createHash("sha256").update(bytes).digest("hex");
    }
    memo.set(gid, hash);
    return hash;
  };
}

// The full layout fonts are witnesses for glyph roles, not keyboard profiles.
// Require several matching direct-cmap consonants AND independent /ToUnicode
// contradictions. Names, subset hashes and PDF-local GIDs do not select a lane.
export function matchVisualUnicodeGlyphs(decoder, fontProgram) {
  if (!hasVisualUnicodeConflicts(decoder)) return null;
  const digest = simpleGlyphDigests(fontProgram);
  if (!digest) return null;
  const gidByCodepoint = new Map();
  for (const [gid, cp] of decoder.ownGids.direct) gidByCodepoint.set(cp, gid);
  const matching = [];
  for (const witness of evidence.witnesses) {
    let compared = 0;
    let agreed = 0;
    for (const [hex, expected] of Object.entries(witness.anchors)) {
      const gid = gidByCodepoint.get(Number(hex));
      const actual = digest(gid);
      if (!actual) continue;
      compared += 1;
      if (actual === expected) agreed += 1;
    }
    if (compared >= 8 && agreed === compared) matching.push(witness);
  }
  if (matching.length !== 1) return null;
  const roles = new Map();
  roles.baseConflicts = matching[0].baseConflicts || {};
  const groups = decoder.toUnicode.byWidth || new Map([[2, decoder.toUnicode]]);
  for (const [width, entries] of groups) {
    for (const [code] of entries) {
      const gid = decoder.gidFor(decoder.cmap.cidFor(code, width));
      const glyphDigest = digest(gid);
      const role = matching[0].marks[glyphDigest];
      const suffix = matching[0].clusterSuffixes?.[glyphDigest];
      if (role || suffix) roles.set(gid, {
        role, suffix,
        yaPlusEConflict: matching[0].yaPlusEConflict === true,
        spaceMappedMark: matching[0].spaceMarkRoles?.includes(role) === true,
      });
    }
  }
  return roles.size ? roles : null;
}

function tokensFor(decoder, parts) {
  const tokens = [];
  for (const data of parts) {
    for (const [code, cid, width, invalid] of decoder.cmap.iterCodes(data)) {
      const old = invalid ? null : decoder.decodeCode(code, cid, width);
      const original = old ?? `[${code.toString(16).toUpperCase().padStart(width * 2, "0")}]`;
      if (invalid) { tokens.push({ original }); continue; }
      const gid = decoder.gidFor(cid);
      const witness = decoder.visualUnicodeGlyphs.get(gid);
      const role = witness?.role;
      const scalar = [...original].length === 1 && /[\u1000-\u109f]/u.test(original);
      // Some witnessed resources map the ya glyph to ya+e. Preserve that
      // multi-output unless this cluster also draws a separate e glyph.
      const yaPlusE = role === "ya" && witness.yaPlusEConflict && original === "ျေ";
      // When this resource's space-dominated map has already been rejected,
      // the existing cmap fallback can return an empty string for a visible
      // mark. Retain that glyph only if its full-font outline was witnessed.
      const missingMark = role && decoder._conflictingSpaceMap && original === ""
        && decoder._toUnicodeForCode(decoder.toUnicode, code, width) === " ";
      // Witnessed ra and ra+wa glyphs can also be mapped to a space. Treat
      // them as marks only when the following glyph completes a visual cluster.
      const spaceMappedMark = ["ra", "raWa"].includes(role) && witness.spaceMappedMark && original === " ";
      if (role && (scalar || yaPlusE || missingMark || spaceMappedMark)) {
        tokens.push({ role, original, text: MARK_TEXT[role], missingMark, yaPlusE });
        continue;
      }
      const cp = decoder.ownGids.direct?.get(gid);
      if (isBase(cp)) {
        const direct = String.fromCodePoint(cp);
        const witnessedConflict = decoder.visualUnicodeGlyphs.baseConflicts?.[direct]?.includes(original);
        if (original === direct || (isConsonant(cp) && (PREFIX_MARKS.has(original) || witnessedConflict))) {
          tokens.push({ role: "base", original, text: direct,
            multiConflict: witnessedConflict && [...original].length > 1 });
          continue;
        }
      }
      // A suffix can prove the end of a specific source-witnessed cluster,
      // but it must already decode to the exact text the full font shaped.
      tokens.push({ original, suffix: witness?.suffix === original ? original : null,
        realSpace: [0x20, 0xa0].includes(cp) && /^\s$/u.test(original) });
    }
  }
  return tokens;
}

// A matching suffix is only evidence for the specific shaped clusters below;
// it is not a new mapping for the suffix glyph itself.
const suffixAt = (tokens, index, text) => tokens[index]?.suffix === text;
function hasClearLeftEdge(tokens, baseIndex, startsAtBoundary) {
  if (baseIndex === 0) return startsAtBoundary;
  const previous = tokens[baseIndex - 1];
  return ["base", "ya", "wa"].includes(previous.role) || Boolean(previous.suffix) || previous.realSpace === true;
}

function completedBareBase(tokens, index, startsAtBoundary) {
  if (!hasClearLeftEdge(tokens, index, startsAtBoundary)) return false;
  // Rendered part 2 page 1315: ရက်, ကို and စကား. The suffixes are
  // respectively asat, i+u, or aa+tone; no e or ra is drawn in those clusters.
  return suffixAt(tokens, index + 1, "်")
    || (suffixAt(tokens, index + 1, "ိ") && suffixAt(tokens, index + 2, "ု"))
    || (suffixAt(tokens, index + 1, "ာ") && suffixAt(tokens, index + 2, "း"));
}

function completedBareYa(tokens, index, startsAtBoundary) {
  const baseIndex = index - 1;
  if (tokens[baseIndex]?.role !== "base" || !hasClearLeftEdge(tokens, baseIndex, startsAtBoundary)) return false;
  // Rendered part 2 pages 252/341/1315: များ, မျိုး, ချက် and ချုပ်.
  // A witnessed final base+asat or a vowel/tone pair closes the cluster.
  return (suffixAt(tokens, index + 1, "ာ") && suffixAt(tokens, index + 2, "း"))
    || (suffixAt(tokens, index + 1, "ိ") && suffixAt(tokens, index + 2, "ု")
      && suffixAt(tokens, index + 3, "း"))
    || (tokens[index + 1]?.role === "base" && suffixAt(tokens, index + 2, "်"))
    || (suffixAt(tokens, index + 1, "ု") && tokens[index + 2]?.role === "base"
      && suffixAt(tokens, index + 3, "်"));
}

// Reconstruct only marks whose own glyphs and cluster boundaries were
// witnessed. Untagged Unicode text is never rearranged.
export function decodeVisualUnicodeRun(decoder, parts, { onUnresolved = null, startsAtBoundary = false } = {}) {
  const tokens = tokensFor(decoder, parts);
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i].role === "kinzi" && tokens[i - 1].role === "base" && !tokens[i - 1].multiConflict) {
      [tokens[i - 1], tokens[i]] = [tokens[i], tokens[i - 1]];
      tokens[i - 1].confirmed = true;
    }
  }
  let output = "";
  for (let i = 0; i < tokens.length;) {
    let j = i;
    const e = tokens[j]?.role === "e";
    if (e) j += 1;
    const raRole = ["ra", "raWa"].includes(tokens[j]?.role) ? tokens[j++].role : "";
    const ra = MARK_TEXT[raRole] || "";
    const kinzi = tokens[j]?.role === "kinzi" && tokens[j].confirmed ? tokens[j++].text : "";
    if ((e || ra) && tokens[j]?.role === "base") {
      const base = tokens[j++];
      let tail = "";
      let yaPlusE = 0;
      while (j < tokens.length && (["ya", "wa"].includes(tokens[j].role)
          || (!tokens[j].role && /^(?:ွ|ှ|ျှ|ွှ)$/u.test(tokens[j].original)))) {
        tail += tokens[j].text ?? tokens[j].original;
        if (tokens[j].yaPlusE) yaPlusE += 1;
        j += 1;
      }
      // Part 2 page 1315 also witnesses ကျော်, ကြီး, ကော် and ကောက်.
      // Their extra prefix marks are absent, not taken from conflicting mappings.
      const witnessedYaBase = base.original === "ြွေ" && e && !ra && yaPlusE === 1
        && tail === "ျ" && suffixAt(tokens, j, "ာ") && suffixAt(tokens, j + 1, "်");
      const witnessedRaBase = base.original === "ြွေ" && !e && raRole === "ra" && !tail
        && suffixAt(tokens, j, "ီ") && suffixAt(tokens, j + 1, "း");
      const witnessedEBase = base.original === "ြွေ" && e && !ra && !tail
        && suffixAt(tokens, j, "ာ") && (suffixAt(tokens, j + 1, "်")
          || (tokens[j + 1]?.role === "base" && suffixAt(tokens, j + 2, "်")));
      const baseComplete = !base.multiConflict || (base.original === "ြွေ" && e && raRole === "raWa")
        || witnessedYaBase || witnessedRaBase || witnessedEBase;
      const yaComplete = !yaPlusE || (yaPlusE === 1 && e && (!base.multiConflict || witnessedYaBase));
      if (baseComplete && yaComplete && !(ra && tail.includes("ျ"))) {
        output += kinzi + base.text + ra + tail + (e ? "ေ" : "");
        i = j;
        continue;
      }
    }
    const token = tokens[i];
    const followsBase = tokens[i - 1]?.role === "base" || (token.role === "wa"
      && tokens[i - 1]?.role === "ya" && tokens[i - 2]?.role === "base");
    const bareBase = token.multiConflict && token.original === "ြွေ"
      && completedBareBase(tokens, i, startsAtBoundary);
    const bareYa = token.yaPlusE && completedBareYa(tokens, i, startsAtBoundary);
    if ((token.multiConflict && !bareBase) || (token.yaPlusE && !bareYa)) onUnresolved?.();
    if ((token.role === "base" && (!token.multiConflict || bareBase)) || (token.role === "kinzi" && token.confirmed)
        || (["ya", "wa"].includes(token.role) && followsBase && (!token.yaPlusE || bareYa))
        || token.missingMark) output += token.text;
    else output += token.original;
    i += 1;
  }
  return output;
}
