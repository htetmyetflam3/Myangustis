/*
(new/init) The door of the input stage, up to decryption - one function.
Identical flow on both sides:
  from disk     -> file-reader reads it -> [metadata, object]
  from external -> the object itself    -> [metadata, object]
then the metadata names the lane:
  pdf   -> preparePdf   (validator -> collect tmp -> qpdf decrypt tmp)
  docx  -> prepareDocx  (validator -> collect tmp)
  image -> prepareOcr   (collect tmp, for the OCR worker)
  other -> collect tmp, passed on as a plain file
Nothing past decryption lives here.
*/
import { generatorA } from "./file-reader.js";
import { collectA } from "./collect.js";
import { packInput } from "./metadata.js";
import { preparePdf } from "./pdf.js";
import { prepareDocx } from "./docx.js";
import { prepareOcr } from "./ocr.js";

async function* byteChunks(object) {
  if (object instanceof Uint8Array) {
    yield Buffer.from(object.buffer, object.byteOffset, object.byteLength);
    return;
  }
  if (object && typeof object[Symbol.asyncIterator] === "function") {
    for await (const chunk of object) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    return;
  }
  throw new TypeError("InitInput: object must be bytes or a readable byte stream");
}

export async function InitInput(trigger = {}) {
  const { path: filePath = null, object = null, filename = null } = trigger ?? {};
  if ((filePath === null) === (object === null)) {
    throw new TypeError("InitInput: give exactly one of { path } or { object }");
  }

  const { metadata, object: packed } = filePath
    ? await packInput(generatorA(filePath), { filename: filename ?? filePath, origin: "disk" })
    : await packInput(byteChunks(object), { filename, origin: "external" });

  if (metadata.kind === "pdf") return preparePdf(metadata, packed);
  if (metadata.kind === "docx") return prepareDocx(metadata, packed);
  if (metadata.kind === "ocr") return prepareOcr(metadata, packed);

  let landed = null;
  for await (const item of collectA(packed)) landed = item;
  if (!landed) throw new TypeError("InitInput: empty input");
  return { kind: "other", path: landed.path, size: landed.size, collected: true, metadata };
}
