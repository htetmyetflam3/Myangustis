/*
(new/validator) The validating file-header functions, upfront.
validatePdf reads a PDF's header on disk (encrypted? object streams?);
validateDocx judges DOCX bytes from the zip central directory's
declared sizes - the zip-bomb defense, before anything decompresses.
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


function memberEntries(buf) {
  const entries = [];
  const maxBack = Math.min(buf.length, 66075);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return entries;
  const total = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || at === 0xffffffff) throw new Error("ZIP64 package");
  for (let n = 0; n < total; n += 1) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(at + 8);
    const compressSize = buf.readUInt32LE(at + 20);
    const file = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString("utf8");
    entries.push({ name, flags, compressSize, file });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// --- validate DOCX -------------------------------------------------------
// The header verdict (%PDF- / PK / other) plus the package check: a
// real DOCX carries [Content_Types].xml and word/document.xml, every
// member name is safe, and the declared sizes stay under the caps.
export function validateDocx(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const kind = buf.length >= 5 && buf.subarray(0, 5).toString("latin1") === "%PDF-"
    ? "pdf"
    : buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b ? "docx" : "other";
  if (kind !== "docx") return { kind, valid: false };
  let entries;
  try {
    entries = memberEntries(buf);
  } catch {
    return { kind, valid: false };
  }
  const names = new Set(entries.map((e) => e.name));
  if (!names.has("[Content_Types].xml") || !names.has("word/document.xml")) return { kind, valid: false };
  if (entries.length > MAX_DOCX_ENTRIES) return { kind, valid: false };
  const memberCap = MAX_DOCX_MEMBER_MB * 1024 * 1024;
  const totalCap = MAX_DOCX_TOTAL_MB * 1024 * 1024;
  let total = 0;
  for (const e of entries) {
    if (e.name.includes("\\") || e.name.includes("\0") || e.name.startsWith("/")
      || e.name.split("/").includes("..")) return { kind, valid: false };
    if ((e.flags & 0x1) !== 0) return { kind, valid: false };
    if (e.file === 0xffffffff || e.compressSize === 0xffffffff) return { kind, valid: false };
    if (e.file > memberCap) return { kind, valid: false };
    if (e.file / Math.max(e.compressSize, 1) > MAX_DOCX_RATIO) return { kind, valid: false };
    total += e.file;
    if (total > totalCap) return { kind, valid: false };
  }
  return { kind, valid: true };
}
