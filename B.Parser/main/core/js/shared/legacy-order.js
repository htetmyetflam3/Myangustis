import inventory from "../jason-map/burmese-inventory.json" with { type: "json" };

const LEGACY_BASES = new Set([...inventory.consonants, "၎"]);

// Reorder only the leading visual-order slots; the remaining slots retain
// their original order, including compound glyph slots and later syllables.
export function reorderLegacySlots(input, { layout = "wininnwa" } = {}) {
  if (!Array.isArray(input) || input.some((s) => typeof s !== "string" || !s.length)) {
    throw new TypeError("Expected non-empty Unicode slots");
  }
  const slots = [...input];
  const isBase = (s) => LEGACY_BASES.has(s);
  const zawcode = layout.toLowerCase() === "zawcode";
  const isRa = (slot) => slot === "\u103C" || (zawcode && /^\u103C[\u103D\u103E]+$/u.test(slot));
  const isYa = (slot) => slot === "\u103B" || (zawcode && /^\u103B[\u103D\u103E]+$/u.test(slot));
  const markSummary = (start) => {
    let ra = false;
    let ya = false;
    for (let i = start; i < Math.min(8, slots.length); i += 1) {
      const chars = [...slots[i]];
      if (chars.some((c) => c === "\u1039" || c < "\u102B" || c > "\u103E")) break;
      ra ||= chars.includes("\u103C");
      ya ||= chars.includes("\u103B");
    }
    return { ra, ya };
  };
  if (slots[0] === "\u1031" && isRa(slots[1]) && isBase(slots[2])) {
    if (zawcode && markSummary(3).ya) return slots;
    return [slots[2], slots[1], slots[0], ...slots.slice(3)];
  }
  if (isRa(slots[0]) && isBase(slots[1])) {
    if (zawcode && markSummary(2).ya) return slots;
    return [slots[1], slots[0], ...slots.slice(2)];
  }
  if (slots[0] !== "\u1031" || !isBase(slots[1])) return slots;
  const marks = zawcode ? markSummary(2) : null;
  if (marks?.ra && marks.ya) return slots;
  let ya = isYa(slots[2]) ? 2 : -1;
  if (ya < 0 && zawcode) {
    // Stop at a base, stack, ra, non-mark, or the eight-slot window.
    // A combined ra+ya cluster has no confirmed rewrite yet.
    for (let i = 2; i < Math.min(8, slots.length); i += 1) {
      const slot = slots[i];
      if (isYa(slot)) { ya = i; break; }
      if ([...slot].some((c) => c === "\u1039" || c === "\u103C" || c < "\u102B" || c > "\u103E")) break;
    }
  }
  if (ya >= 0) {
    // A compound ya+wa/ha glyph stays together before e; all other slots
    // keep their relative order. The source includes e+ma+ya-ha in မျှော်.
    return [slots[1], slots[ya], slots[0], ...slots.slice(2, ya), ...slots.slice(ya + 1)];
  }
  if (zawcode) {
    let end = 2;
    while (end < slots.length && /^[\u103D\u103E]+$/u.test(slots[end])) end += 1;
    if (end > 2) return [slots[1], ...slots.slice(2, end), slots[0], ...slots.slice(end)];
  }
  return [slots[1], slots[0], ...slots.slice(2)];
}

// Apply the confirmed leading-slot rules across one decoded text stream.
// Do not normalize, drop marks, or cross a base/stack to find ya.
export function reorderZawCodeText(text) {
  if (typeof text !== "string") throw new TypeError("Expected text");
  const chars = Array.from(text);
  const out = [];
  const isWaHa = (ch) => ch === "ွ" || ch === "ှ";
  const markSpan = (start, limit) => {
    let end = start;
    let ra = false;
    let ya = false;
    while (end < Math.min(limit, chars.length)) {
      const ch = chars[end];
      if (ch === "္" || ch < "\u102B" || ch > "\u103E") break;
      ra ||= ch === "ြ";
      ya ||= ch === "ျ";
      end += 1;
    }
    return { end, ra, ya };
  };
  for (let i = 0; i < chars.length;) {
    const hasE = chars[i] === "ေ";
    const ra = hasE ? i + 1 : i;
    if (chars[ra] === "ြ") {
      let base = ra + 1;
      while (isWaHa(chars[base])) base += 1;
      if (LEGACY_BASES.has(chars[base])) {
        const tail = markSpan(base + 1, i + 8);
        if (tail.ya) {
          out.push(...chars.slice(i, tail.end));
          i = tail.end;
          continue;
        }
        const medial = chars.slice(ra, base).join("");
        const slots = hasE ? ["ေ", medial, chars[base]] : [medial, chars[base]];
        out.push(...reorderLegacySlots(slots, { layout: "zawcode" }));
        i = base + 1;
        continue;
      }
    }
    if (hasE && LEGACY_BASES.has(chars[i + 1])) {
      const following = markSpan(i + 2, i + 8);
      if (following.ra && following.ya) {
        out.push(...chars.slice(i, following.end));
        i = following.end;
        continue;
      }
      let ya = -1;
      for (let j = i + 2; j < Math.min(i + 8, chars.length); j += 1) {
        const ch = chars[j];
        if (ch === "ျ") { ya = j; break; }
        if (ch === "္" || ch === "ြ" || ch < "\u102B" || ch > "\u103E") break;
      }
      let end = i + 2;
      let slots;
      if (ya >= 0) {
        end = ya + 1;
        while (isWaHa(chars[end])) end += 1;
        slots = [chars[i], chars[i + 1], ...chars.slice(i + 2, ya), chars.slice(ya, end).join("")];
      } else {
        while (isWaHa(chars[end])) end += 1;
        slots = chars.slice(i, end);
      }
      out.push(...reorderLegacySlots(slots, { layout: "zawcode" }));
      i = end;
      continue;
    }
    out.push(chars[i]);
    i += 1;
  }
  return out.join("");
}

// This visual-order pattern is unambiguous enough to select the provisional
// profile only in combination with its exact embedded-font fingerprint.
export function countZawCodeEvidence(text) {
  const chars = Array.from(text);
  let count = 0;
  for (let i = 0; i + 2 < chars.length; i += 1) {
    if (chars[i] === "ေ" && chars[i + 1] === "ြ" && LEGACY_BASES.has(chars[i + 2])) count += 1;
  }
  return count;
}
