import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ValueError, pyInt, pyStripBytes } from "./pylib.js";

const READ_SIZE = 64 * 1024;
const STREAM_MARKER = Buffer.from("\nstream\n", "latin1");
const END_OBJECT = Buffer.from("endobj", "latin1");

function readAt(fd, offset, length) {
  const buffer = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, buffer, read, length - read, offset + read);
    if (!count) break;
    read += count;
  }
  return buffer.subarray(0, read);
}

class LineReader {
  constructor(fd, start, end) {
    this.fd = fd;
    this.position = start;
    this.end = end;
    this.pending = "";
  }

  next() {
    while (true) {
      const newline = this.pending.indexOf("\n");
      if (newline !== -1) {
        const line = this.pending.slice(0, newline).replace(/\r$/u, "");
        this.pending = this.pending.slice(newline + 1);
        return line;
      }
      if (this.position >= this.end) {
        if (!this.pending) return null;
        const line = this.pending;
        this.pending = "";
        return line;
      }
      const bytes = readAt(this.fd, this.position, Math.min(READ_SIZE, this.end - this.position));
      if (!bytes.length) throw new Error("PDF cross-reference table ended unexpectedly");
      this.position += bytes.length;
      this.pending += bytes.toString("latin1");
    }
  }
}

function startXref(fd, size) {
  const length = Math.min(size, READ_SIZE);
  const tail = readAt(fd, size - length, length).toString("latin1");
  const matches = [...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/gu)];
  const offset = matches.length ? Number(matches.at(-1)[1]) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) {
    throw new Error("PDF has no readable cross-reference table; prepare it with qpdf first");
  }
  return offset;
}

// This reader expects the ordinary xref table produced by qpdf with object
// streams disabled. It keeps object offsets, not the PDF's object bodies.
export class PdfFileObjects {
  constructor(source, { maxObjects = Infinity } = {}) {
    this.fd = fs.openSync(source, "r");
    this.entries = new Map();
    this.rootKey = null;
    this.trailer = "";
    try {
      const size = fs.fstatSync(this.fd).size;
      const xref = startXref(this.fd, size);
      const reader = new LineReader(this.fd, xref, size);
      if (reader.next()?.trim() !== "xref") {
        throw new Error("PDF uses an xref stream; prepare it with qpdf first");
      }
      let line;
      while ((line = reader.next()) !== null) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith("trailer")) {
          this.trailer = line;
          while (!this.trailer.includes(">>")) {
            const next = reader.next();
            if (next === null) throw new Error("PDF trailer is incomplete");
            this.trailer += `\n${next}`;
          }
          break;
        }
        const section = /^(\d+)\s+(\d+)$/u.exec(line);
        if (!section) throw new Error("Invalid PDF cross-reference subsection");
        const first = Number(section[1]);
        const count = Number(section[2]);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count > maxObjects + 1) {
          throw new Error(`PDF exceeds the ${maxObjects} object cap`);
        }
        for (let index = 0; index < count; index += 1) {
          const entry = /^(\d+)\s+(\d+)\s+([nf])\b/u.exec(reader.next()?.trim() ?? "");
          if (!entry) throw new Error("Invalid PDF cross-reference entry");
          if (entry[3] !== "n") continue;
          const offset = Number(entry[1]);
          const generation = Number(entry[2]);
          if (!Number.isSafeInteger(offset) || offset < 0 || offset >= xref) {
            throw new Error("Invalid PDF object offset");
          }
          this.entries.set(`${first + index},${generation}`, { offset, end: xref });
          if (this.entries.size > maxObjects) throw new Error(`PDF exceeds the ${maxObjects} object cap`);
        }
      }
      if (!this.trailer || /\/Prev\b/u.test(this.trailer)) {
        throw new Error("PDF has incremental cross-references; prepare it with qpdf first");
      }
      const root = /\/Root\s+(\d+)\s+(\d+)\s+R/u.exec(this.trailer);
      if (root) this.rootKey = `${Number(root[1])},${Number(root[2])}`;
      const ordered = [...this.entries.values()].sort((a, b) => a.offset - b.offset);
      for (let index = 0; index + 1 < ordered.length; index += 1) ordered[index].end = ordered[index + 1].offset;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get size() { return this.entries.size; }
  has(key) { return this.entries.has(key); }

  // Only the object dictionary is needed to inspect streams. Do not read the
  // compressed image or page stream merely to resolve its dictionary.
  dictionary(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    let position = entry.offset;
    const chunks = [];
    let length = 0;
    while (position < entry.end) {
      const bytes = readAt(this.fd, position, Math.min(READ_SIZE, entry.end - position));
      if (!bytes.length) throw new Error(`PDF object ${key} ended unexpectedly`);
      chunks.push(bytes);
      length += bytes.length;
      position += bytes.length;
      const current = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
      const marker = current.indexOf(STREAM_MARKER);
      const header = /^\s*\d+\s+\d+\s+obj\b/u.exec(current.toString("latin1", 0, Math.min(current.length, 128)));
      if (!header) throw new Error(`Invalid PDF object header for ${key}`);
      if (marker !== -1) {
        entry.streamStart = entry.offset + marker + STREAM_MARKER.length;
        return pyStripBytes(current.subarray(header[0].length, marker));
      }
      if (position >= entry.end) {
        const end = current.lastIndexOf(END_OBJECT);
        if (end < header[0].length) throw new Error(`PDF object ${key} has no endobj`);
        return pyStripBytes(current.subarray(header[0].length, end));
      }
      // Avoid repeated concatenation if a non-stream object spans many blocks.
      if (chunks.length > 1) { chunks.length = 0; chunks.push(current); }
    }
    return undefined;
  }

  streamRange(key, length) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.dictionary(key);
    if (entry.streamStart === undefined || !Number.isSafeInteger(length) || length < 0
        || entry.streamStart + length > entry.end) {
      throw new Error(`Invalid PDF stream length for ${key}`);
    }
    return { fd: this.fd, start: entry.streamStart, length };
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const raw = readAt(this.fd, entry.offset, entry.end - entry.offset);
    const header = /^\s*\d+\s+\d+\s+obj\b/u.exec(raw.toString("latin1", 0, Math.min(raw.length, 128)));
    const end = raw.lastIndexOf(END_OBJECT);
    if (!header || end < header[0].length) throw new Error(`Invalid PDF object ${key}`);
    return pyStripBytes(raw.subarray(header[0].length, end));
  }

  *[Symbol.iterator]() {
    for (const key of this.entries.keys()) yield [key, this.dictionary(key)];
  }

  *values() {
    for (const [, value] of this) yield value;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

class FileView {
  constructor(fd) {
    this.fd = fd;
    this.length = fs.fstatSync(fd).size;
    this.offset = 0;
    this.buffer = Buffer.allocUnsafe(READ_SIZE);
    this.count = 0;
    this.searchBuffer = Buffer.allocUnsafe(READ_SIZE + END_OBJECT.length - 1);
  }

  byteAt(position) {
    if (position < this.offset || position >= this.offset + this.count) {
      this.offset = Math.floor(position / READ_SIZE) * READ_SIZE;
      this.count = fs.readSync(this.fd, this.buffer, 0, Math.min(READ_SIZE, this.length - this.offset), this.offset);
      if (!this.count) throw new Error("PDF ended while scanning its objects");
    }
    return this.buffer[position - this.offset];
  }

  text(start, end) {
    if (start >= this.offset && end <= this.offset + this.count) {
      return this.buffer.toString("latin1", start - this.offset, end - this.offset);
    }
    return readAt(this.fd, start, end - start).toString("latin1");
  }

  indexOf(needle, start) {
    let offset = start;
    let carry = 0;
    while (offset < this.length) {
      const count = fs.readSync(this.fd, this.searchBuffer, carry, Math.min(READ_SIZE, this.length - offset), offset);
      if (!count) break;
      const length = carry + count;
      const index = this.searchBuffer.subarray(0, length).indexOf(needle);
      if (index !== -1) return offset - carry + index;
      carry = Math.min(length, needle.length - 1);
      this.searchBuffer.copyWithin(0, length - carry, length);
      offset += count;
    }
    return -1;
  }
}

// Scan the original file without expanding object streams or decrypting it:
// Scraper classification must make its decision from the original source.
function scanPdfObjectOffsets(fd, maxObjects = Infinity) {
  const view = new FileView(fd);
  const entries = new Map();
  const isDigit = (byte) => byte >= 0x30 && byte <= 0x39;
  const isSpace = (byte) => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
  let i = 0;
  let end = -1;
  let noMoreEnds = false;
  while (i < view.length) {
    if (!isDigit(view.byteAt(i))) { i += 1; continue; }
    let j = i;
    while (j < view.length && isDigit(view.byteAt(j))) j += 1;
    let k = j;
    while (k < view.length && isSpace(view.byteAt(k))) k += 1;
    if (k === j || k >= view.length || !isDigit(view.byteAt(k))) { i = j; continue; }
    let m = k;
    while (m < view.length && isDigit(view.byteAt(m))) m += 1;
    let p = m;
    while (p < view.length && isSpace(view.byteAt(p))) p += 1;
    if (p === m) { i = j; continue; }
    if (p + 3 <= view.length && view.text(p, p + 3) === "obj") {
      const start = p + 3;
      if (end < start && !noMoreEnds) {
        end = view.indexOf(END_OBJECT, start);
        noMoreEnds = end === -1;
      }
      if (end !== -1 && end >= start) {
        const key = `${pyInt(view.text(i, j))},${pyInt(view.text(k, m))}`;
        entries.set(key, { start, end });
        if (entries.size > maxObjects) throw new ValueError(`PDF exceeds the ${maxObjects} object cap`);
      }
      i = start;
    } else {
      i = j;
    }
  }
  return entries;
}

// File-backed view of the objects visible in the original PDF. Unlike the
// qpdf-prepared reader above, it deliberately does not expose compressed
// object-stream members to the Scraper's legacy classifier.
export class PdfScannedObjects {
  constructor(source, { maxObjects = Infinity } = {}) {
    this.fd = fs.openSync(source, "r");
    try {
      this.entries = scanPdfObjectOffsets(this.fd, maxObjects);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get size() { return this.entries.size; }
  has(key) { return this.entries.has(key); }

  get(key) {
    const entry = this.entries.get(key);
    return entry ? pyStripBytes(readAt(this.fd, entry.start, entry.end - entry.start)) : undefined;
  }

  dictionary(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    let position = entry.start;
    let previous = Buffer.alloc(0);
    const chunks = [];
    let total = 0;
    while (position < entry.end) {
      const next = readAt(this.fd, position, Math.min(READ_SIZE, entry.end - position));
      if (!next.length) throw new Error(`PDF object ${key} ended unexpectedly`);
      const blockStart = position - previous.length;
      position += next.length;
      const block = previous.length ? Buffer.concat([previous, next]) : next;
      let marker = -1;
      let search = 0;
      while ((marker = block.indexOf("stream", search, "latin1")) !== -1) {
        const absolute = blockStart + marker;
        const before = marker ? block[marker - 1] : absolute === entry.start ? 0x20 : readAt(this.fd, absolute - 1, 1)[0];
        const after = block[marker + 6];
        if (after === undefined && position < entry.end) break;
        if ((before === 0x3e || before <= 0x20) && (after === 0x0a || after === 0x0d)) {
          const prefixLength = absolute - (position - next.length);
          if (prefixLength > 0) { chunks.push(next.subarray(0, prefixLength)); total += prefixLength; }
          // If the marker crosses a read boundary, remove its already-saved prefix.
          if (prefixLength < 0) total += prefixLength;
          let streamStart = absolute + 6;
          if (after === 0x0d) streamStart += 1;
          if (streamStart < entry.end && readAt(this.fd, streamStart, 1)[0] === 0x0a) streamStart += 1;
          entry.streamStart = streamStart;
          return pyStripBytes(Buffer.concat(chunks, total));
        }
        search = marker + 6;
      }
      chunks.push(next);
      total += next.length;
      previous = block.subarray(Math.max(0, block.length - 7));
    }
    return pyStripBytes(Buffer.concat(chunks, total));
  }

  streamRange(key, length) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.streamStart === undefined) this.dictionary(key);
    if (entry.streamStart === undefined || !Number.isSafeInteger(length) || length < 0
        || entry.streamStart + length > entry.end) throw new Error(`Invalid PDF stream length for ${key}`);
    return { fd: this.fd, start: entry.streamStart, length };
  }

  *[Symbol.iterator]() {
    for (const key of this.entries.keys()) yield [key, this.dictionary(key)];
  }

  *values() {
    for (const [, value] of this) yield value;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

// Buffer callers already own the bytes; put them on disk so they use the same
// file-backed object and page-content readers as path callers.
export function openPdfScannedObjects(source, options = {}) {
  let directory = null;
  let objects = null;
  try {
    let file = source;
    if (source instanceof Uint8Array) {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "linga-pdf-source-"));
      file = path.join(directory, "source.pdf");
      fs.writeFileSync(file, source, { mode: 0o600 });
    }
    objects = new PdfScannedObjects(file, options);
    return {
      objects,
      close() {
        objects.close();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    objects?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
