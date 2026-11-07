import { toPositions, toSyllableLine } from '../MonoSyllabism/utilities/formatter.js';

/* ── Positional syllable API ─────────────────────────────────────
   The public API does NOT hand back ready-made segmented text.
   It hands back positions; the caller writes the segmentation.

   Scope: Burmese only. Punctuation, English words, digits and
   duplicate marks are the caller's problem — we never promised to
   clean their text. We clean it for OURSELVES, because we have to in
   order to segment at all.

     our syllable output   hello  နေ  ကောင်း  လား
     response              { index: "န", syllable: ["1", "5", "2"] }

   index is the first Burmese base consonant. The caller finds that
   char in its own text and walks: take 1 after န → နေ, move to the
   next base consonant က, take 5 → ကောင်း, move to လ, take 2 → လား.

   Consuming the count BEFORE searching again is what makes this work:
   င inside ကောင်း is itself a base consonant, and gets stepped over.

   IMPORTANT — the positions are measured against our CLEAN output,
   not the caller's raw text. normalize() (map-runtime.jsc)
   NFC-folds, drops Glue and $ # ^ { }, reorders marks by Priority,
   rewrites imposter lookalikes and collapses runs of spaces. So a
   caller holding duplicate spaces, duplicate marks or imposter chars
   will NOT line up exactly. That is deliberate: this API is for
   callers who do their own work, not for consumers who want finished
   Burmese NLP output handed to them. Do not "fix" this by returning
   segmented text.
   ─────────────────────────────────────────────────────────────── */

/** The positional syllable contract is owned by the engine formatter. */

/** Return positional boundaries for one formatted syllable line, or null. */
export function syllablePosition(line) {
  return toPositions(line);
}

// Wrap the shared line formatter; only the positional view reaches this caller.
export async function* positionalSyllableLines(lines) {
  for await (const line of lines) {
    const positions = syllablePosition(toSyllableLine(line));
    if (positions !== null) yield positions;
  }
}
