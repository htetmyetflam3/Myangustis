/*
(new/pdf) The PDF lane - one function, four composed steps:
  1) validator   - the header state (on the disk file upfront, when
                   the call carried one)
  2) collect.js  - write tmp (streamed; nothing held in memory)
  3) decrypt     - qpdf writes the decrypted, QDF-expanded tmp;
                   clean files pass through untouched
  4) split       - container.txt + content.txt written apart, the
                   @stream table in the container is the new xref.
                   An OCR job skips the split: everything around
                   the images is stripped, only image bytes remain.
init.js imports only this function from here; the steps live inside.
*/
import { validatePdf } from "../../../../init/helper/validator.js";
import { collectA } from "../../../../init/helper/collect.js";
import { decryptPdf } from "./helper/decrypt.js";
import { splitPdf, stripPdfImages } from "./helper/split.js";

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
  const base = {
    path: out.path,
    prepared: out.prepared,
    size: out.prepared ? out.size : landed.size,
    collected: true,
    metadata,
  };
  // 4) OCR job: strip the shit around, keep only the image bytes
  if (metadata?.job === "ocr") {
    const images = await stripPdfImages(out.path, out.path + ".images");
    return {
      ...base,
      kind: "ocr",
      sourceKind: "pdf",
      images,
      path: images[0]?.path ?? null,
    };
  }
  // 4) split container from content
  const split = await splitPdf(out.path);
  return {
    kind: "pdf",
    container: split.containerPath,
    content: split.contentPath,
    ...base,
  };
}
