/*
(new/init) The door of the input stage, up to decryption - one function.
It imports only the lane functions (pdf/docx/ocr) at top level; all
wiring lives inside them. InitInput intercepts the call by caller:
  site    -> limit, then file reader (site calls carry a file on disk)
  owner   -> limit, then file reader for a path, direct object either way
  service -> limit, no file reader (service calls carry the object)
Either side is packed into [metadata, object] (metadata.js); the
metadata names the file, and the matching lane function takes both.
Nothing past decryption lives here.
*/
import fs from "node:fs";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "./helper/limit.js";
import { generatorA } from "./helper/file-reader.js";
import { packInput } from "./helper/metadata.js";
import { preparePdf } from "../pdf/pdf.js";
import { prepareDocx } from "../docx/read.js";
import { prepareOcr } from "../ocr/read.js";

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

export async function InitInput(trigger = {}, caller = "owner") {
  const who = String(caller ?? "owner").toLowerCase();
  if (!["site", "owner", "service"].includes(who)) {
    throw new TypeError("InitInput: caller must be site, owner or service");
  }
  const { path: filePath = null, object = null, filename = null, job = null } = trigger ?? {};
  if ((filePath === null) === (object === null)) {
    throw new TypeError("InitInput: give exactly one of { path } or { object }");
  }

  // limit first - before any reading happens on either side
  if (filePath !== null) {
    if (who === "service") throw new TypeError("InitInput: service calls carry the object, not a file path");
    const { size } = fs.statSync(filePath);
    if (size > MAX_INPUT_BYTES) throw new Error("Parser input exceeds the " + MAX_INPUT_MB + " MB cap");
  } else {
    if (who === "site") throw new TypeError("InitInput: site calls carry a file on disk, not an object");
    if (object instanceof Uint8Array && object.byteLength > MAX_INPUT_BYTES) {
      throw new Error("Parser input exceeds the " + MAX_INPUT_MB + " MB cap");
    }
  }

  // file reader for the disk side; no file reader for service objects
  const { metadata, object: packed } = filePath !== null
    ? await packInput(generatorA(filePath), { filename: filename ?? filePath, origin: "disk", caller: who, job })
    : await packInput(byteChunks(object), { filename, origin: "external", caller: who, job });

  if (metadata.kind === "pdf") return preparePdf(metadata, packed);
  if (metadata.kind === "docx") return prepareDocx(metadata, packed);
  if (metadata.kind === "ocr") return prepareOcr(metadata, packed);
  return { kind: "other", metadata, object: packed };
}
