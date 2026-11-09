/*
(new/validator) The validating file-header functions, upfront.
validatePdf reads a PDF's header on disk (encrypted? object
streams?); validateDocx judges DOCX bytes and validateDocxFile
judges a landed DOCX file - both from the zip central directory's
declared sizes, read by offset in bounded blocks, never by loading
or decompressing the package. That judgement is the zip-bomb
defense: it lands before anything downstream touches the archive.
*/
import fs from "node:fs";
import {
  MAX_DOCX_ENTRIES, MAX_DOCX_MEMBER_MB, MAX_DOCX_TOTAL_MB, MAX_DOCX_RATIO,
} from "./limit.js";

const ENCRYPT_MARK = Buffer.from("/Encrypt");
const OBJSTM_MARK = Buffer.from("/ObjStm");

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

// --- the zip package judgement, shared by bytes and file -------------
function judgeEntries(entries) {
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) return false;
  if (entries.length > MAX_DOCX_ENTRIES) return false;
  const memberCap = MAX_DOCX_MEMBER_MB * 1024 * 1024;
  const totalCap = MAX_DOCX_TOTAL_MB * 1024 * 1024;
  let total = 0;
  for (const e of entries) {
    if (e.name.includes("\\") || e.name.includes("\0") || e.name.startsWith("/")
      || e.name.split("/").includes("..")) return false;
    if ((e.flags & 0x1) !== 0) return false;
    if (e.file === 0xffffffff || e.compressSize === 0xffffffff) return false;
    if (e.file > memberCap) return false;
    if (e.file / Math.max(e.compressSize, 1) > MAX_DOCX_RATIO) return false;
    total += e.file;
    if (total > totalCap) return false;
  }
  return true;
}

function parseEntries(cd, total) {
  const entries = [];
  let at = 0;
  for (let n = 0; n < total; n += 1) {
    if (at + 46 > cd.length || cd.readUInt32LE(at) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(at + 8);
    const compressSize = cd.readUInt32LE(at + 20);
    const file = cd.readUInt32LE(at + 24);
    const nameLen = cd.readUInt16LE(at + 28);
    const extraLen = cd.readUInt16LE(at + 30);
    const commentLen = cd.readUInt16LE(at + 32);
    const name = cd.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    entries.push({ name, flags, compressSize, file });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// The header verdict (%PDF- / PK / other) from the first bytes.
export function headKind(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return "docx";
  return "other";
}

// Judge DOCX bytes held by the caller (the door's head peek is the
// only such caller left, and it reads kind, not validity).
export function validateDocx(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const kind = headKind(buf);
  if (kind !== "docx") return { kind, valid: false };
  const maxBack = Math.min(buf.length, 66075);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return { kind, valid: false };
  const total = buf.readUInt16LE(eocd + 10);
  const at = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || at === 0xffffffff) return { kind, valid: false };
  return { kind, valid: judgeEntries(parseEntries(buf.subarray(at), total)) };
}

// Judge a landed DOCX file without loading it: head by offset, the
// end-of-central-directory in the tail block, the central directory
// itself in one bounded read. Same verdict as validateDocx.
export function validateDocxFile(file) {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, Math.min(5, size), 0);
    const kind = headKind(head);
    if (kind !== "docx") return { kind, valid: false };
    const tailLen = Math.min(size, 66075);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i -= 1) {
      if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) return { kind, valid: false };
    const total = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdAt = tail.readUInt32LE(eocd + 16);
    if (total === 0xffff || cdAt === 0xffffffff || cdSize === 0xffffffff) return { kind, valid: false };
    if (total > MAX_DOCX_ENTRIES) return { kind, valid: false };
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdAt);
    return { kind, valid: judgeEntries(parseEntries(cd, total)) };
  } finally {
    fs.closeSync(fd);
  }
}
