/*
(PDF 29) PDF branch, position 29 in the chain - writing helper of the stream runner (PDF 6).
This module is the text sink: it appends finished page text to the job's output text file within the job's size limits.
*/
import fs from "node:fs";
import path from "node:path";
import { MAX_TEXT_CHARS } from "../limits/local.js";

function writeAll(fd, value) {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
}

export function copyTextFile(file, fd) {
  const source = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let length;
    while ((length = fs.readSync(source, buffer, 0, buffer.length, null)) > 0) {
      writeAll(fd, buffer.subarray(0, length));
    }
  } finally {
    fs.closeSync(source);
  }
}

function headerFor(counts, source, total) {
  return `# Source: ${source || "-"}\n# Pages: ${total}\n` +
    `# Detection: ${counts.ZAWGYI ?? 0} Zawgyi, ${counts.UNICODE ?? 0} Unicode, ${counts.UNKNOWN ?? 0} unknown\n` +
    "#".repeat(50) + "\n\n";
}

export class PdfTextSink {
  constructor(directory, { includeText = false, owner = false } = {}) {
    this.bodyPath = path.join(directory, "txt-body");
    this.joinedPath = includeText ? path.join(directory, "txt-joined") : null;
    this.body = fs.openSync(this.bodyPath, "wx", 0o600);
    try {
      this.joined = this.joinedPath ? fs.openSync(this.joinedPath, "wx", 0o600) : null;
    } catch (error) {
      fs.closeSync(this.body);
      this.body = null;
      throw error;
    }
    this.owner = owner;
    this.pages = 0;
    this.lineCount = 0;
    this.pageTextChars = 0;
    this.textChars = 0;
    this.textBytes = 0;
  }

  addPage(chunks) {
    if (this.body == null) throw new Error("TXT sink is closed");
    if (this.pages) {
      this.textChars += 2;
      this.textBytes += 2;
      if (this.joined != null) writeAll(this.joined, "\n\n");
    }
    this.pages += 1;
    writeAll(this.body, `--- Page ${this.pages} ---\n`);
    let hasText = false;
    let nonempty = false;
    let newlines = 0;
    for (const chunk of chunks) {
      if (!chunk) continue;
      nonempty = true;
      hasText ||= /\S/u.test(chunk);
      this.pageTextChars += chunk.length;
      this.textChars += chunk.length;
      if (!this.owner && this.pageTextChars > MAX_TEXT_CHARS) {
        throw new Error(`Output text exceeds the ${MAX_TEXT_CHARS} character cap`);
      }
      this.textBytes += Buffer.byteLength(chunk, "utf8");
      for (const character of chunk) if (character === "\n") newlines += 1;
      writeAll(this.body, chunk);
      if (this.joined != null) writeAll(this.joined, chunk);
    }
    if (nonempty) this.lineCount += newlines + 1;
    writeAll(this.body, "\n\n");
    return hasText;
  }

  finish(outPath, counts, source) {
    this.close();
    const out = path.extname(outPath) ? outPath : `${outPath}.txt`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const output = fs.openSync(out, "w");
    try {
      writeAll(output, headerFor(counts, source, this.pages));
      copyTextFile(this.bodyPath, output);
    } finally {
      fs.closeSync(output);
    }
    return {
      file: out,
      lineCount: this.lineCount,
      mimeType: "text/plain",
      textChars: this.textChars,
      textBytes: this.textBytes,
      ...(this.joinedPath ? { text: fs.readFileSync(this.joinedPath, "utf8") } : {}),
    };
  }

  close() {
    if (this.body != null) fs.closeSync(this.body);
    if (this.joined != null) fs.closeSync(this.joined);
    this.body = null;
    this.joined = null;
  }
}
