/*
(PDF 15) PDF branch, position 15 in the chain - helper of the extraction (PDF 13).
This module is the PDF tokenizer: it reads a prepared file and turns names, numbers, strings, arrays and dictionaries into values the object loader can resolve.
*/
import fs from "node:fs";
import { PdfFloat, PdfHexBytes, PdfKeyword, PdfName } from "./font/values.js";

const BUFFER_SIZE = 64 * 1024;
const ESCAPES = new Map([
  [0x6e, "\n"], [0x72, "\r"], [0x74, "\t"], [0x62, "\b"], [0x66, "\f"],
  [0x28, "("], [0x29, ")"], [0x5c, "\\"],
]);
const whitespace = (c) => c === 0 || (c >= 9 && c <= 13) || c === 32;
const digit = (c) => c >= 48 && c <= 57;
const alpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const keywordChar = (c) => alpha(c) || digit(c) || c === 39 || c === 34 || c === 42;
const nameEnd = (c) => c < 0 || whitespace(c) || [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(c);
const inlineEnd = (c) => c < 0 || whitespace(c) || [91, 93, 60, 62, 47, 37, 40].includes(c);

class Latin1Builder {
  constructor() {
    this.buffer = Buffer.allocUnsafe(256);
    this.length = 0;
    this.parts = [];
  }

  add(value) {
    if (this.length === this.buffer.length) {
      if (this.buffer.length < BUFFER_SIZE) {
        const larger = Buffer.allocUnsafe(Math.min(BUFFER_SIZE, this.buffer.length * 2));
        this.buffer.copy(larger, 0, 0, this.length);
        this.buffer = larger;
      } else {
        this.parts.push(this.buffer.toString("latin1"));
        this.length = 0;
      }
    }
    this.buffer[this.length++] = value;
  }

  finish() {
    const last = this.buffer.toString("latin1", 0, this.length);
    if (!this.parts.length) return last;
    this.parts.push(last);
    return this.parts.join("");
  }
}

// The page commands live in a temporary file. Only a small read window and the
// current PDF token are held here; comments and inline images are skipped.
export class PdfFileLexer {
  constructor(fd, size) {
    this.fd = fd;
    this.size = size;
    this.pos = 0;
    this.buffer = Buffer.alloc(0);
    this.start = 0;
  }

  peek(ahead = 0) {
    const at = this.pos + ahead;
    if (at >= this.size) return -1;
    if (at < this.start || at >= this.start + this.buffer.length) {
      this.start = this.pos;
      this.buffer = Buffer.allocUnsafe(Math.min(BUFFER_SIZE, this.size - this.start));
      const read = fs.readSync(this.fd, this.buffer, 0, this.buffer.length, this.start);
      this.buffer = this.buffer.subarray(0, read);
      if (at >= this.start + read) return -1;
    }
    return this.buffer[at - this.start];
  }

  take() {
    const c = this.peek();
    if (c !== -1) this.pos += 1;
    return c;
  }

  skipComment() {
    while (this.pos < this.size) {
      this.peek();
      const offset = this.pos - this.start;
      const lf = this.buffer.indexOf(0x0a, offset);
      const cr = this.buffer.indexOf(0x0d, offset);
      const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
      if (end >= 0) { this.pos = this.start + end; return; }
      this.pos = this.start + this.buffer.length;
    }
  }

  skipInlineImage() {
    while (this.pos < this.size) {
      const c = this.peek();
      if (whitespace(c) && this.peek(1) === 69 && this.peek(2) === 73 && inlineEnd(this.peek(3))) {
        this.pos += 3;
        return;
      }
      this.pos += 1;
    }
  }

  literal() {
    let depth = 1;
    const out = new Latin1Builder();
    while (this.pos < this.size) {
      const c = this.take();
      if (c === 40) { depth += 1; out.add(c); continue; }
      if (c === 41) {
        depth -= 1;
        if (!depth) return out.finish();
        out.add(c);
        continue;
      }
      if (c === 13) {
        if (this.peek() === 10) this.pos += 1;
        out.add(10);
        continue;
      }
      if (c !== 92) { out.add(c); continue; }
      const next = this.take();
      if (next < 0) break;
      if (ESCAPES.has(next)) { out.add(ESCAPES.get(next).charCodeAt(0)); continue; }
      if (next >= 48 && next <= 55) {
        let value = next - 48;
        for (let index = 0; index < 2; index += 1) {
          const extra = this.peek();
          if (extra < 48 || extra > 55) break;
          value = value * 8 + this.take() - 48;
        }
        out.add(value & 0xff);
      } else if (next === 10) {
        // Backslash-newline is a line continuation.
      } else if (next === 13) {
        if (this.peek() === 10) this.pos += 1;
      } else out.add(next);
    }
    return out.finish();
  }

  hex() {
    const result = new Latin1Builder();
    let high = -1;
    while (this.pos < this.size) {
      const c = this.take();
      if (c === 62) {
        if (high !== -1) result.add(high << 4);
        return result.finish();
      }
      const value = c >= 48 && c <= 57 ? c - 48
        : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (value < 0) continue;
      if (high < 0) high = value;
      else { result.add((high << 4) | value); high = -1; }
    }
    return null;
  }

  number() {
    const start = this.pos;
    let raw = "";
    while (this.peek() === 43 || this.peek() === 45) raw += String.fromCharCode(this.take());
    let digits = 0;
    while (digit(this.peek())) { raw += String.fromCharCode(this.take()); digits += 1; }
    if (this.peek() === 46) {
      const dot = this.pos;
      this.pos += 1;
      let fractional = "";
      while (digit(this.peek())) fractional += String.fromCharCode(this.take());
      if (digits || fractional) raw += `.${fractional}`;
      else this.pos = dot;
    }
    if (!digits && !/\d/u.test(raw)) { this.pos = start; return null; }
    raw = raw.replace(/^\+*/u, "");
    if (raw.includes(".")) {
      const value = Number.parseFloat(raw);
      return new PdfFloat(Number.isNaN(value) ? 0 : value);
    }
    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? 0 : value;
  }

  nextToken() {
    while (this.pos < this.size) {
      const c = this.peek();
      if (whitespace(c)) { this.pos += 1; continue; }
      if (c === 37) { this.pos += 1; this.skipComment(); continue; }
      if (c === 47) {
        this.pos += 1;
        let name = "";
        while (!nameEnd(this.peek())) name += String.fromCharCode(this.take());
        return ["obj", new PdfName(name.replace(/#([0-9A-Fa-f]{2})/gu,
          (_whole, hex) => String.fromCharCode(Number.parseInt(hex, 16))))];
      }
      if (c === 60) {
        this.pos += 1;
        if (this.peek() === 60) { this.pos += 1; return ["dopen", null]; }
        const start = this.pos;
        const value = this.hex();
        if (value !== null) return ["obj", new PdfHexBytes(value)];
        this.pos = start;
        return ["kw", new PdfKeyword("<")];
      }
      if (c === 62 && this.peek(1) === 62) { this.pos += 2; return ["dclose", null]; }
      if (c === 91 || c === 93) { this.pos += 1; return [c === 91 ? "aopen" : "aclose", null]; }
      if (c === 123 || c === 125) { this.pos += 1; continue; }
      if (c === 40) { this.pos += 1; return ["obj", this.literal()]; }
      if (digit(c) || c === 43 || c === 45 || c === 46) {
        const value = this.number();
        if (value !== null) return ["obj", value];
      }
      if (alpha(c) || c === 39 || c === 34 || c === 42) {
        let word = "";
        while (keywordChar(this.peek())) word += String.fromCharCode(this.take());
        if (word === "true") return ["obj", true];
        if (word === "false") return ["obj", false];
        if (word === "null") return ["obj", null];
        return ["kw", new PdfKeyword(word)];
      }
      this.pos += 1;
      return ["kw", new PdfKeyword(String.fromCharCode(c))];
    }
    return null;
  }
}
