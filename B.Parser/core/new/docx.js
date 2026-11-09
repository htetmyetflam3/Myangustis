/*
(new/docx) The DOCX lane: validator -> collect -> write tmp.
Same shape as the PDF lane, minus decryption (a DOCX has none): the
bytes are collected whole (the package check needs the central
directory at the end anyway), validated, then written to a tmp file.
*/
import { collectA, collectBytes } from "./collect.js";
import { validateDocx } from "./validator.js";

export async function prepareDocx(metadata, object) {
  const bytes = await collectBytes(object);
  if (!validateDocx(bytes).valid) {
    throw new TypeError("prepareDocx: PK header but not a valid DOCX package");
  }
  let landed = null;
  async function* once() { yield bytes; }
  for await (const item of collectA(once())) landed = item;
  return { kind: "docx", path: landed.path, size: landed.size, collected: true, metadata };
}
