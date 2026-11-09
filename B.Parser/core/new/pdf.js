/*
(new/pdf) The PDF lane - one function, three composed steps:
  1) validator   - the header state (on the disk file upfront, when
                   the call carried one)
  2) collect.js  - write tmp
  3) decrypt     - qpdf writes the decrypted tmp; clean files pass
                   through untouched, no qpdf run, no copy
init.js imports only this function from here; the steps live inside.
*/
import fs from "node:fs";
import { validatePdf } from "./validator.js";
import { collectA } from "./collect.js";
import { decryptPdf } from "./decrypt.js";

export async function preparePdf(metadata, object) {
  // 1) validator
  if (metadata?.sourcePath) {
    const head = validatePdf(metadata.sourcePath);
    if (!head.header) throw new TypeError("preparePdf: not a PDF file");
  }
  // 2) collect.js = write tmp
  let landed = null;
  for await (const item of collectA(object)) landed = item;
  if (!landed) throw new TypeError("preparePdf: empty input");
  // 3) qpdf decrypt = write tmp
  const out = await decryptPdf(landed.path);
  return {
    kind: "pdf",
    path: out.path,
    prepared: out.prepared,
    size: out.size ?? fs.statSync(out.path).size,
    collected: true,
    metadata,
  };
}
