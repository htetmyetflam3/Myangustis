/*
(PDF 7) PDF branch, position 7 in the chain - the first check on the raw input bytes, before preparation.
This module only looks for marker bytes in the PDF: it reports whether the file is encrypted (/Encrypt) or uses object streams (/ObjStm), without loading the file into the parser.
*/
import fs from "node:fs";

const ENCRYPT_MARK = Buffer.from("/Encrypt");

export function isEncryptedPdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(ENCRYPT_MARK);
}

const OBJSTM_MARK = Buffer.from("/ObjStm");

// Match the byte-based checks without loading a path-backed PDF into memory.
export function scanPdfFileMarkers(source) {
  const fd = fs.openSync(source, "r");
  const block = Buffer.allocUnsafe(64 * 1024);
  let tail = Buffer.alloc(0);
  let encrypted = false;
  let objectStreams = false;
  let position = 0;
  try {
    while (true) {
      const count = fs.readSync(fd, block, 0, block.length, position);
      if (!count) break;
      position += count;
      const bytes = tail.length ? Buffer.concat([tail, block.subarray(0, count)]) : block.subarray(0, count);
      encrypted ||= bytes.includes(ENCRYPT_MARK);
      objectStreams ||= bytes.includes(OBJSTM_MARK);
      if (encrypted && objectStreams) break;
      tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - Math.max(ENCRYPT_MARK.length, OBJSTM_MARK.length) + 1)));
    }
    return { encrypted, objectStreams };
  } finally {
    fs.closeSync(fd);
  }
}











export function hasObjectStreams(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(OBJSTM_MARK);
}
