/*
(new/docx) The DOCX lane - one function, two composed steps:
Same shape as the PDF lane, minus decryption (a DOCX has none): the
bytes are collected whole (the package check needs the central
directory at the end anyway), validated, then written to a tmp file.
*/
import { collectA, collectBytes } from "./collect.js";
import { validateDocx } from "./validator.js";

export async function prepareDocx(metadata, object) {
  // 1) validator - collect whole first (the package check needs the
  //    central directory at the end), judge before anything is landed
  const bytes = await collectBytes(object);
  if (!validateDocx(bytes).valid) {
    throw new TypeError("prepareDocx: PK header but not a valid DOCX package");
  }
  // 2) collect.js = write tmp
  let landed = null;
  async function* once() { yield bytes; }
  for await (const item of collectA(once())) landed = item;
  return { kind: "docx", path: landed.path, size: landed.size, collected: true, metadata };
}
