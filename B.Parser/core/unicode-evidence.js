/*
(PDF 26) PDF branch, position 26 in the chain - text helper of the finishing step (PDF 19).
This module protects valid regional Unicode Myanmar runs (Mon and extension signs) so Burmese-only cleanup and ordering never rewrite them.
*/
// These are valid Unicode Myanmar extensions, including Mon vowel signs.
// Several occupy the same code points that Zawgyi fonts used for other glyphs.
const REGIONAL = /[\u1033-\u1035\u1050-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/u;
const MYANMAR_RUN = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F\u200B-\u200D]+/gu;

// Do not apply Burmese-only cleanup or ordering inside a regional run. Leave
// the entire run intact, including contextual marks and joiners; unrelated
// spans can still use the caller's normal processing.
export function preserveRegionalRuns(text, transform) {
  if (typeof text !== "string" || !REGIONAL.test(text)) return transform(text);
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(MYANMAR_RUN)) {
    if (!REGIONAL.test(match[0])) continue;
    if (match.index > cursor) result += transform(text.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  return cursor < text.length ? result + transform(text.slice(cursor)) : result;
}
