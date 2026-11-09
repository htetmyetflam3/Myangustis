/*
(PDF 23) PDF branch, position 23 in the chain - text helper of the finishing step (PDF 19).
This module provides the Rabbit Zawgyi-to-Unicode conversion exports the pipeline imports.
*/
// Minimal rabbit stub.
// Original rabbit.js was never in the JS repo; this provides the
// createRabbitStream and Rabbit exports so pipeline.js and
// finalized-cmap.js can import them.
export function createRabbitStream(output, { preserveSpaces = false } = {}) {
  return {
    push(chunk, final = false) {
      if (final) return;
      if (typeof output === "function") output(chunk);
    },
  };
}

export const Rabbit = {
  zg2uni(text) {
    return text;
  },
};
