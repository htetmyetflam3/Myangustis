/*
(new/docx) The DOCX side of the input stage, up to decryption.
DOCX has no decryption stage - it is a zip, read whole by its runner -
passDocx hands the DOCX on as the object. Validation lives upfront
in validator.js (validateDocx); this file only passes.
*/
// --- function 2: pass ------------------------------------------------------
// Hand the DOCX on as the object itself: { bytes, size }, plus the
// trigger's filename when it named one. No tmp file - its runner reads
// the whole archive in memory anyway.
export function passDocx(bytes, filename = null) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { bytes: buf, size: buf.length, ...(filename ? { filename } : {}) };
}
