/*
(Postprocess support) The engine bind for the scan stage: hands one
source line to the Architecture engine (POS tagging) and streams its
units back. Callers may inject their own bind; this is the default.
*/

import { BindEngine } from "../../../Architecture/Engine/init/bridge.js";

export const MAX_LINE_BYTES = 5 * 1024 * 1024;

export function bindEngine(request) {
  return BindEngine(request);
}
