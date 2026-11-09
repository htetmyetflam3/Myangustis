/*
(new/docx) The DOCX side of the input stage, up to decryption.
DOCX has no decryption stage - it is a zip, read whole by its runner -
so the two functions are: validateDocx answers whether the bytes are
really a DOCX package; passDocx hands the DOCX on as the object.
*/
// Minimal member check, local to this file: walk the zip central
// directory (end-of-central-directory record, then each entry header)
// and collect member names. Falls back to a raw name search when the
// directory is ZIP64.
function memberNames(buf) {
  const names = new Set();
  const maxBack = Math.min(buf.length, 66075);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return names;
  const total = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || at === 0xffffffff) {
    const hay = buf.toString("latin1");
    for (const name of ["[Content_Types].xml", "word/document.xml"]) {
      if (hay.includes(name)) names.add(name);
    }
    return names;
  }
  for (let n = 0; n < total; n += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break;
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    names.add(buf.subarray(at + 46, at + 46 + nameLen).toString("utf8"));
    at += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}



// --- function 2: pass ------------------------------------------------------
// Hand the DOCX on as the object itself: { bytes, size }, plus the
// trigger's filename when it named one. No tmp file - its runner reads
// the whole archive in memory anyway.
export function passDocx(bytes, filename = null) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { bytes: buf, size: buf.length, ...(filename ? { filename } : {}) };
}
