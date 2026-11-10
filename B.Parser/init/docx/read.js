/*
(new/docx) The DOCX lane - one function, two composed steps:
  1) collect.js  - write tmp (streamed, chunk by chunk, cap while
                   writing; nothing is held in memory)
  2) validator   - judge the landed file from its central directory
                   by offset; an invalid package's tmp is destroyed
DOCX has no decryption. Judging the landed file instead of held
bytes is what lets this lane stream end to end; the bomb defense is
unchanged - declared sizes are judged before anything downstream
decompresses a single member. init.js imports only this function.
*/
import fs from "node:fs";
import { collectA } from "../init/helper/collect.js";
import { validateDocxFile } from "../init/helper/validator.js";

export async function prepareDocx(metadata, object) {
  // 1) collect.js = write tmp
  let landed = null;
  for await (const item of collectA(object)) landed = item;
  if (!landed) throw new TypeError("prepareDocx: empty input");
  // 2) validator - judge the package on disk, destroy it if it fails
  if (!validateDocxFile(landed.path).valid) {
    fs.rmSync(landed.path, { force: true });
    throw new TypeError("prepareDocx: PK header but not a valid DOCX package");
  }
  return { kind: "docx", path: landed.path, size: landed.size, collected: true, metadata };
}
