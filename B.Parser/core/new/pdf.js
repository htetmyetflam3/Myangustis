/*
(new/pdf) The PDF lane: validator -> collect -> decrypt.
collect writes the tmp file; decrypt validates the landed header and,
only when the file is encrypted or object-streamed, qpdf writes the
decrypted tmp. Clean files come out of collect untouched by qpdf.
*/
import fs from "node:fs";
import { collectA } from "./collect.js";
import { decryptPdf } from "./decrypt.js";

export async function preparePdf(metadata, object) {
  let landed = null;
  for await (const item of collectA(object)) landed = item;
  if (!landed) throw new TypeError("preparePdf: empty input");
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
