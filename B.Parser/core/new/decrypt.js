/*
(new/decrypt) The decryption step of the input stage.
qpdf over the landed tmp file; qpdf's decrypted output is a tmp file
too, handed downstream to seek in. A clean file passes untouched.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runQpdfFile } from "../../init/pdf/qpdf.js";
import { validatePdf } from "./validator.js";

export async function decryptPdf(file, workDir = null) {
  const state = validatePdf(file);
  if (!state.encrypted && !state.objectStreams) {
    return { path: file, prepared: false, ...state };
  }
  const dir = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-decrypt-"));
  fs.mkdirSync(dir, { recursive: true });
  const prepared = path.join(dir, "decrypted.pdf");
  await runQpdfFile(file, prepared, ["--decrypt", "--object-streams=disable"]);
  return { path: prepared, prepared: true, ...state, size: fs.statSync(prepared).size };
}