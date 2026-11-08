/*
(PDF 14) PDF branch, position 14 in the chain - helper of the extraction (PDF 13).
This module decodes a page's content streams exactly once and spools the bytes to a scratch file, so parsing never decompresses the same stream twice.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Unzlib } from "fflate";
import { PdfName, PdfRef } from "./pdf-fonts.js";

export const PAGE_CONTENT_PREFIX_BYTES = 2048;

function streamReferences(loader, value, depth = 0) {
  if (depth > 32) throw new Error("PDF contents reference nesting is too deep");
  if (value instanceof PdfRef) {
    const object = loader.objectValue(value);
    return Array.isArray(object) ? streamReferences(loader, object, depth + 1) : [value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => streamReferences(loader, item, depth + 1));
  return [];
}

// A small compressed input block also bounds the output produced by a single
// deflate push, even for highly compressible page commands.
const ENCODED_CHUNK = 1024;
const PLAIN_CHUNK = 64 * 1024;

function writeAll(fd, data, offset) {
  let written = 0;
  while (written < data.length) {
    const count = fs.writeSync(fd, data, written, data.length - written, offset + written);
    if (!count) throw new Error("Could not write the PDF content spool");
    written += count;
  }
}

function readRange(fd, position, length) {
  const data = Buffer.allocUnsafe(length);
  const read = fs.readSync(fd, data, 0, length, position);
  if (!read && length) throw new Error("PDF content stream ended early");
  return data.subarray(0, read);
}

function needsPreparedDecode(message) {
  const error = new Error(message);
  error.code = "PDF_CONTENT_DECODE_REQUIRED";
  return error;
}

function contentFilter(loader, dictionary, ref) {
  let filter = loader.resolve(dictionary.get("Filter"));
  if (Array.isArray(filter)) filter = filter.map((entry) => loader.resolve(entry));
  const list = filter == null ? [] : Array.isArray(filter) ? filter : [filter];
  const names = list.map((entry) => entry instanceof PdfName ? String(entry) : "");
  if (names.length > 1 || (names.length === 1 && !["FlateDecode", "Fl"].includes(names[0]))) {
    throw needsPreparedDecode(`PDF content stream ${ref} uses an unsupported filter; prepare it with qpdf first`);
  }
  const rawParms = loader.resolve(dictionary.get("DecodeParms"));
  const params = Array.isArray(rawParms) ? rawParms : [rawParms];
  for (const value of params) {
    const entry = loader.resolve(value);
    const predictor = entry instanceof Map ? loader.resolve(entry.get("Predictor")) : null;
    if (predictor != null && Number(predictor) !== 1) {
      throw needsPreparedDecode(`PDF content stream ${ref} uses an unsupported predictor`);
    }
  }
  return names.length > 0;
}

function* decodedChunks(loader, ref, maxBytes) {
  const dictionary = loader.objectValue(ref);
  if (!(dictionary instanceof Map)) throw new Error(`Missing PDF content stream ${ref}`);
  const length = loader.resolve(dictionary.get("Length"));
  const range = loader.objects.streamRange(ref.key(), length);
  if (!range) throw new Error(`Missing PDF content stream ${ref}`);
  const compressed = contentFilter(loader, dictionary, ref);
  let total = 0;
  let position = 0;
  if (!compressed) {
    while (position < range.length) {
      const bytes = readRange(range.fd, range.start + position, Math.min(PLAIN_CHUNK, range.length - position));
      position += bytes.length;
      total += bytes.length;
      if (total > maxBytes) throw new Error(`PDF content stream exceeds the ${maxBytes} byte cap`);
      yield bytes;
    }
    return;
  }

  const pending = [];
  const decoder = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`PDF content stream exceeds the ${maxBytes} byte cap`);
    if (chunk.length) pending.push(Buffer.from(chunk));
  });
  if (!range.length) throw new Error(`Invalid compressed PDF content stream ${ref}`);
  while (position < range.length) {
    const bytes = readRange(range.fd, range.start + position, Math.min(ENCODED_CHUNK, range.length - position));
    position += bytes.length;
    decoder.push(bytes, position === range.length);
    while (pending.length) yield pending.shift();
  }
}

// Spool each decoded stream once. The checkpoint contains exactly the first
// 2,048 decoded bytes across /Contents, and the same decoded bytes are then
// read from the spool for parsing without repeating the decompression.
export function spoolPageContent(loader, pageNum, pageGen, {
  maxBytes, inspect = () => {}, scratchDir = null,
} = {}) {
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
    throw new RangeError("A content stream limit is required");
  }
  const page = loader.resolve(new PdfRef(pageNum, pageGen));
  const references = page instanceof Map ? streamReferences(loader, page.get("Contents")) : [];
  const dir = scratchDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-page-"));
  const file = path.join(dir, `commands-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
  let fd = null;
  try {
    fd = fs.openSync(file, "wx+", 0o600);
    const entries = [];
    const prefix = [];
    let prefixSize = 0;
    let inspected = false;
    let position = 0;
    const inspectOnce = () => {
      if (inspected) return;
      inspected = true;
      inspect(Buffer.concat(prefix, prefixSize), references);
    };
    for (const ref of references) {
      const start = position;
      for (const chunk of decodedChunks(loader, ref, maxBytes)) {
        if (prefixSize < PAGE_CONTENT_PREFIX_BYTES) {
          const size = Math.min(chunk.length, PAGE_CONTENT_PREFIX_BYTES - prefixSize);
          prefix.push(Buffer.from(chunk.subarray(0, size)));
          prefixSize += size;
          if (prefixSize === PAGE_CONTENT_PREFIX_BYTES) inspectOnce();
        }
        writeAll(fd, chunk, position);
        position += chunk.length;
      }
      entries.push({ start, length: position - start });
    }
    inspectOnce();
    return {
      fd, file, size: position, references, streams: entries,
      close() {
        if (fd !== null) { fs.closeSync(fd); fd = null; }
        fs.rmSync(file, { force: true });
        if (scratchDir === null) fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    if (scratchDir === null) fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
