/*
(new/pdf) The PDF side of the input stage, up to decryption.
Two functions: validatePdf reads the file header on disk and answers
what state the file is in; decryptPdf writes the decrypted tmp file
with qpdf when - and only when - the file needs it.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runQpdfFile } from "../../init/pdf/qpdf.js";

const ENCRYPT_MARK = Buffer.from("/Encrypt");
const OBJSTM_MARK = Buffer.from("/ObjStm");

// --- function 1: validate ------------------------------------------------
// Marker-byte scan in bounded blocks: is the header even a PDF, is it
// encrypted (/Encrypt), does it hide objects in streams (/ObjStm)?
// No parser load, no qpdf call happens before this answer.
export function validatePdf(file) {
  const fd = fs.openSync(file, "r");
  const block = Buffer.allocUnsafe(64 * 1024);
  let tail = Buffer.alloc(0);
  let header = null;
  let encrypted = false;
  let objectStreams = false;
  let position = 0;
  try {
    while (true) {
      const count = fs.readSync(fd, block, 0, block.length, position);
      if (!count) break;
      position += count;
      const bytes = tail.length ? Buffer.concat([tail, block.subarray(0, count)]) : block.subarray(0, count);
      if (header === null) header = bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-";
      encrypted ||= bytes.includes(ENCRYPT_MARK);
      objectStreams ||= bytes.includes(OBJSTM_MARK);
      if (header !== null && encrypted && objectStreams) break;
      tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - Math.max(ENCRYPT_MARK.length, OBJSTM_MARK.length) + 1)));
    }
  } finally {
    fs.closeSync(fd);
  }
  return { header: header === true, encrypted, objectStreams };
}

// --- function 2: decrypt -------------------------------------------------
// qpdf over the landed tmp file; qpdf's decrypted output is a tmp file
// too, handed downstream to seek in. A clean file passes untouched -
// no qpdf run, no copy.
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
