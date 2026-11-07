// Extend bind to the Engine service. This is the one place that imports
// BindEngine: callers hand it a text object ({ sourceText, flag, log }) and
// the Engine handles segmentation/POS itself, streaming results back.
// Core units never import the Engine directly — they import this bind.
import { BindEngine } from "../../Architecture/Engine/init/bridge.js";

export { MAX_LINE_BYTES } from "../../Architecture/Engine/MonoSyllabism/generators/SfomatterForP.js";

export function bindEngine(request) {
  return BindEngine(request);
}

export default bindEngine;
