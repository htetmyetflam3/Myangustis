// (OCR 2 support) Worker entry for tesseract.js pinned away from the
// relaxed-SIMD core: wasm-feature-detect (used by the stock worker to
// pick a core) does not parse on every Node build, and the relaxed-SIMD
// core is the one that needs it. Answering "no relaxed SIMD" up front
// makes the stock worker load the plain LSTM core instead.
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (request === "wasm-feature-detect") {
    return {
      simd: async () => true,
      relaxedSimd: async () => false,
    };
  }
  return originalLoad.call(this, request, ...rest);
};

require("tesseract.js/src/worker-script/node/index.js");
