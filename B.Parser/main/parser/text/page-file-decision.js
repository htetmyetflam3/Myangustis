import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { containsMyanmar } from "./detector.js";
import { arrangeZawCodeOrder } from "./zawcode-order.js";
import { correctWorldWord, markOrderAligned } from "./page-decision.js";
import { preserveCharacters, protectedCharacters } from "./preserved-transform.js";
import { createRabbitStream } from "./rabbit.js";
import { StreamingReplace } from "./stream-replace.js";

const READ_SIZE = 64 * 1024;

function writeAll(fd, text) {
  if (!text) return;
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("Could not write the PDF text spool");
    offset += count;
  }
}

function identicalFiles(left, right) {
  if (fs.statSync(left).size !== fs.statSync(right).size) return false;
  const a = fs.openSync(left, "r");
  const b = fs.openSync(right, "r");
  const x = Buffer.allocUnsafe(READ_SIZE);
  const y = Buffer.allocUnsafe(READ_SIZE);
  try {
    while (true) {
      const nx = fs.readSync(a, x, 0, x.length, null);
      const ny = fs.readSync(b, y, 0, y.length, null);
      if (nx !== ny || !x.subarray(0, nx).equals(y.subarray(0, ny))) return false;
      if (!nx) return true;
    }
  } finally { fs.closeSync(a); fs.closeSync(b); }
}

// Split exactly like String#split("\n"), without holding an entire page.
export function* textLines(chunks) {
  let pending = "";
  for (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== "\n") continue;
      yield pending + chunk.slice(start, i);
      pending = "";
      start = i + 1;
    }
    pending += chunk.slice(start);
  }
  yield pending;
}

function equalChunks(left, right) {
  const a = left[Symbol.iterator]();
  const b = right[Symbol.iterator]();
  let x = "";
  let y = "";
  let doneA = false;
  let doneB = false;
  try {
    while (true) {
      while (!x && !doneA) {
        const part = a.next();
        doneA = part.done;
        if (!doneA) x = part.value;
      }
      while (!y && !doneB) {
        const part = b.next();
        doneB = part.done;
        if (!doneB) y = part.value;
      }
      if (!x || !y) return !x && !y && doneA && doneB;
      const n = Math.min(x.length, y.length);
      if (x.slice(0, n) !== y.slice(0, n)) return false;
      x = x.slice(n);
      y = y.slice(n);
    }
  } finally {
    a.return?.();
    b.return?.();
  }
}

// Preserve the buffered layout rule: reuse coordinates if the page is
// unchanged or if its converted text still has the same number of lines.
export function* pageLayoutLines(store, text, sourceLineCount) {
  let convertedLineCount = 1;
  for (const chunk of text.chunks()) {
    for (const char of chunk) if (char === "\n") convertedLineCount += 1;
  }
  if (convertedLineCount === sourceLineCount) {
    const converted = textLines(text.chunks());
    try {
      for (const [x, y, size] of store.lines()) {
        yield [x, y, size, converted.next().value];
      }
    } finally { converted.return?.(); }
    return;
  }
  function* original() {
    let first = true;
    for (const [, , , line] of store.lines()) {
      if (!first) yield "\n";
      first = false;
      yield line;
    }
  }
  if (equalChunks(original(), text.chunks())) yield* store.lines();
}

export class PageTextFile {
  constructor(file, chars, bytes) {
    this.path = file;
    this.chars = chars;
    this.bytes = bytes;
  }

  *chunks() {
    const fd = fs.openSync(this.path, "r");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(READ_SIZE);
    try {
      while (true) {
        const count = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!count) break;
        const text = decoder.write(buffer.subarray(0, count));
        if (text) yield text;
      }
      const text = decoder.end();
      if (text) yield text;
    } finally { fs.closeSync(fd); }
  }

  close() { fs.rmSync(this.path, { force: true }); }
}

// Normalize only the final page text, after parsing and any OCR merge. The
// resulting spool is shared by the POS scanner and the output writer.
export function normalizePageToFile(chunks, { directory, normalize } = {}) {
  if (typeof normalize !== "function") throw new TypeError("Expected Engine normalize function");
  const file = path.join(directory, `normalized-page-${randomUUID()}.txt`);
  let fd = null;
  let chars = 0;
  let bytes = 0;
  const write = (text) => {
    writeAll(fd, text);
    chars += text.length;
    bytes += Buffer.byteLength(text, "utf8");
  };
  try {
    fd = fs.openSync(file, "wx", 0o600);
    let first = true;
    for (const line of textLines(chunks)) {
      if (!first) write("\n");
      first = false;
      write(preserveCharacters(line, normalize));
    }
    fs.closeSync(fd);
    fd = null;
    return new PageTextFile(file, chars, bytes);
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw error;
  }
}

// Decide once for the entire page, but make the decision in passes over the
// disk-backed lines. No Rabbit rule is applied to a partially repaired page.
export function finishPageToFile(store, {
  directory, parsingPath, sourceEncoding = "auto", fontKinds = new Set(),
} = {}) {
  let originalHasText = false;
  let hasMyanmar = false;
  let aligned = true;
  let candidateChanged = false;
  let candidateAligned = true;
  let count = 0;
  for (const [, , , text] of store.lines()) {
    count += 1;
    originalHasText ||= Boolean(text.trim());
    hasMyanmar ||= containsMyanmar(text);
    aligned &&= markOrderAligned(text);
    const candidate = arrangeZawCodeOrder(text);
    candidateChanged ||= candidate !== text;
    candidateAligned &&= markOrderAligned(candidate);
  }
  const unicodeEvidence = fontKinds.has("UNICODE");
  const zawgyiEvidence = fontKinds.size > 0 && [...fontKinds].every((kind) => kind === "ZAWGYI");
  const worldEvidence = sourceEncoding !== "unicode"
    && (fontKinds.has("ZAWGYI") || sourceEncoding === "zawgyi-one");
  let decision;
  if (parsingPath === "legacy") decision = "legacy";
  else if (!hasMyanmar || aligned) decision = "aligned";
  else if (candidateChanged && candidateAligned) decision = "zawcode";
  else if (unicodeEvidence || sourceEncoding === "unicode") decision = "unaligned-unicode";
  else if (!zawgyiEvidence && sourceEncoding !== "zawgyi-one") decision = "unaligned-unknown";
  else decision = "rabbit";

  const id = randomUUID();
  const file = path.join(directory, `page-text-${id}.txt`);
  const beforeFile = path.join(directory, `protected-before-${id}.txt`);
  const afterFile = path.join(directory, `protected-after-${id}.txt`);
  let fd = null;
  let chars = 0;
  let bytes = 0;
  let outputHasMyanmar = false;
  try {
    fd = fs.openSync(file, "wx", 0o600);
    const write = (text) => {
      writeAll(fd, text);
      chars += text.length;
      bytes += Buffer.byteLength(text, "utf8");
      outputHasMyanmar ||= containsMyanmar(text);
    };
    const writeOriginal = ({ transform = (text) => text } = {}) => {
      let first = true;
      for (const [, , , text] of store.lines()) {
        if (!first) write("\n");
        first = false;
        write(correctWorldWord(transform(text), worldEvidence));
      }
    };

    if (decision === "rabbit") {
      const before = fs.openSync(beforeFile, "wx", 0o600);
      const after = fs.openSync(afterFile, "wx", 0o600);
      try {
        const world = worldEvidence ? new StreamingReplace(/က(?:မၻာ|မ်ဘာ)/u, "ကမ္ဘာ") : null;
        const output = (text) => {
          writeAll(after, protectedCharacters(text));
          const transformed = world ? world.push(text) : text;
          write(transformed);
        };
        const rabbit = createRabbitStream(output, { preserveZeroWidth: true });
        let first = true;
        for (const [, , , text] of store.lines()) {
          const chunk = first ? text : `\n${text}`;
          first = false;
          writeAll(before, protectedCharacters(chunk));
          rabbit.push(chunk);
        }
        rabbit.push("", true);
        if (world) write(world.push("", true));
      } finally { fs.closeSync(before); fs.closeSync(after); }
      if (!identicalFiles(beforeFile, afterFile)) {
        decision = "unaligned-zawgyi";
        fs.closeSync(fd);
        fd = fs.openSync(file, "w", 0o600);
        chars = 0;
        bytes = 0;
        outputHasMyanmar = false;
        writeOriginal();
      }
    } else if (decision === "zawcode") {
      writeOriginal({ transform: arrangeZawCodeOrder });
    } else {
      writeOriginal();
    }
    fs.closeSync(fd);
    fd = null;
    const category = !outputHasMyanmar || decision === "unaligned-unknown" ? "UNKNOWN"
      : decision === "rabbit" || decision === "unaligned-zawgyi" ? "ZAWGYI" : "UNICODE";
    return { text: new PageTextFile(file, chars, bytes), decision, category, originalHasText, lineCount: count };
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw error;
  } finally {
    fs.rmSync(beforeFile, { force: true });
    fs.rmSync(afterFile, { force: true });
  }
}
