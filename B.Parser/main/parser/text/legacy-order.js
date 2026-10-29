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
  if (slots[0] === "\u1031" && slots[1] === "\u103C" && isBase(slots[2])) {
    return [slots[2], slots[1], slots[0], ...slots.slice(3)];
  }
  if (slots[0] === "\u103C" && isBase(slots[1])) {
    return [slots[1], slots[0], ...slots.slice(2)];
  }
  if (slots[0] !== "\u1031" || !isBase(slots[1])) return slots;

  const zawcode = layout.toLowerCase() === "zawcode";
  const isYa = (slot) => slot === "\u103B" || (zawcode && /^\u103B[\u103D\u103E]+$/u.test(slot));
  let ya = isYa(slots[2]) ? 2 : -1;
  if (ya < 0 && zawcode) {
    // Stop at a base, stack, non-mark, or the eight-slot window.
    for (let i = 2; i < Math.min(8, slots.length); i += 1) {
      const slot = slots[i];
      if (isYa(slot)) { ya = i; break; }
      if ([...slot].some((c) => c === "\u1039" || c < "\u102B" || c > "\u103E")) break;
    }
  }
  if (ya >= 0) {
    // ZawCode keyboard slots may contain ya together with wa/ha. Put only
    // ya before e; keep the rest of that slot and the suffix in their order.
    const tail = slots[ya].slice(1);
    return [slots[1], "\u103B", slots[0], ...slots.slice(2, ya), ...(tail ? [tail] : []), ...slots.slice(ya + 1)];
  }
  return [slots[1], slots[0], ...slots.slice(2)];
}
