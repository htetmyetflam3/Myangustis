/*
(new/docx) The DOCX side of the input stage, up to decryption.
DOCX has no decryption stage - it is a zip, read whole by its runner -
so the two functions are: validateDocx answers whether the bytes are
really a DOCX package; passDocx hands the DOCX on as the object.
*/
import {
  MAX_DOCX_ENTRIES, MAX_DOCX_MEMBER_MB, MAX_DOCX_TOTAL_MB, MAX_DOCX_RATIO,
} from "./limit.js";

// Central-directory metadata, local to this file: member names AND the
// sizes the directory declares. This is the zip-bomb defense, and it
// runs before anything is decompressed - no extractor (mammoth
// included) is ever exposed to an unchecked package.
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

// --- function 1: validate ------------------------------------------------
// The header verdict (%PDF- / PK / other) plus the package check: a
// real DOCX carries [Content_Types].xml and word/document.xml in its
// central directory. Anything else wearing PK is not a DOCX.
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

// --- function 2: pass ------------------------------------------------------
// Hand the DOCX on as the object itself: { bytes, size }, plus the
// trigger's filename when it named one. No tmp file - its runner reads
// the whole archive in memory anyway.
export function passDocx(bytes, filename = null) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { bytes: buf, size: buf.length, ...(filename ? { filename } : {}) };
}
