/*
(Input chain, new - not wired into the live chain yet) The collector: second link, consumes Generator A.
This module consumes a chunk stream (Generator A) and emits exactly one item: the whole input as a single Buffer (the "A" the prepare step reads from). PDF and DOCX both need the whole byte set before parsing can start, so this is where arrival becomes possession. Emits once, then holds nothing.
*/
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../limits/local.js";

// Consume every chunk from `source`, then yield the whole bytes once.
// The input cap is enforced while collecting, so a hostile or broken
// source can never grow memory past the limit.
export async function* collectA(source, { maxBytes = MAX_INPUT_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    }
    chunks.push(buf);
  }
  yield Buffer.concat(chunks, total);
}
