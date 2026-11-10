/*
(PDF 23) PDF branch, position 23 in the chain - text helper of the finishing step (PDF 19).
This module provides the Rabbit Zawgyi-to-Unicode conversion exports the pipeline imports.
*/
// Mirror of the Python converter (B.Parser/Python/modules/rabbit.py):
// the COMPLETE official Rabbit zg2uni table (118 rules, order is
// significant), loaded from zg2uni-rules.json in @jason-map - the same
// table the Python _RULES hold (verified rule-for-rule identical). The
// JSON stores Python-style \N backrefs in "to"; they are converted to
// JS $N once at load. zg2uni applies the rules in order, per call;
// createRabbitStream runs the same rules chunk-wise through the
// streaming replacement pipeline (@helper/stream-replace.js), so a
// page converts line by line as it is written, not after the parse.
import { loadMapJson } from "../@core/runtime/json-map.js";
import { createReplacementPipeline } from "../@helper/stream-replace.js";

const RULES = loadMapJson("zg2uni-rules.json").map(({ from, to }) => [
  new RegExp(from, "gu"),
  String(to).replace(/\\(\d{1,2})/gu, "$$$1"),
]);

export const Rabbit = {
  zg2uni(text) {
    let out = String(text ?? "");
    for (const [pattern, template] of RULES) out = out.replace(pattern, template);
    return out;
  },
};

export function createRabbitStream(output, { preserveSpaces = false } = {}) {
  return createReplacementPipeline(RULES, output);
}
