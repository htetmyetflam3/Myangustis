import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { textLines } from "../decoding/finalized-cmap.js";

function writeAll(fd, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("Could not write the page spool");
    offset += count;
  }
}

export function* textChunks(file, start = 0, length = fs.statSync(file).size) {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new StringDecoder("utf8");
  let offset = 0;
  try {
    while (offset < length) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - offset), start + offset);
      if (!count) throw new Error("Unexpected end of the page spool");
      offset += count;
      const text = decoder.write(buffer.subarray(0, count));
      if (text) yield text;
    }
    const tail = decoder.end();
    if (tail) yield tail;
  } finally {
    fs.closeSync(fd);
  }
}

export async function* pageRecords(file) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

export function* layoutLines(store, page) {
  if (!store.layoutPath || !page.layoutLength) return;
  for (const line of textLines(textChunks(store.layoutPath, page.layoutStart, page.layoutLength))) {
    if (line) yield JSON.parse(line);
  }
}

export class PageStoreWriter {
  constructor(directory, prefix = "page") {
    this.store = {
      indexPath: path.join(directory, `${prefix}-index.jsonl`),
      textPath: path.join(directory, `${prefix}-text.bin`),
      layoutPath: path.join(directory, `${prefix}-layout.jsonl`),
    };
    this.indexFd = null;
    this.textFd = null;
    this.layoutFd = null;
    try {
      this.indexFd = fs.openSync(this.store.indexPath, "wx", 0o600);
      this.textFd = fs.openSync(this.store.textPath, "wx", 0o600);
      this.layoutFd = fs.openSync(this.store.layoutPath, "wx", 0o600);
    } catch (error) {
      this.close();
      throw error;
    }
    this.textOffset = 0;
    this.layoutOffset = 0;
    this.pages = 0;
  }

  addPage({ text, lines = [], wh, images = [], hasImg = false }) {
    if (this.indexFd == null) throw new Error("Page spool is closed");
    const start = this.textOffset;
    let hasText = false;
    for (const chunk of text) {
      if (!chunk) continue;
      hasText ||= /\S/u.test(chunk);
      const bytes = Buffer.from(chunk, "utf8");
      writeAll(this.textFd, bytes);
      this.textOffset += bytes.length;
    }
    const layoutStart = this.layoutOffset;
    let lineCount = 0;
    for (const line of lines) {
      const bytes = Buffer.from(`${JSON.stringify(line)}\n`, "utf8");
      writeAll(this.layoutFd, bytes);
      this.layoutOffset += bytes.length;
      lineCount += 1;
    }
    const record = {
      index: this.pages, start, length: this.textOffset - start, hasText,
      layoutStart, layoutLength: this.layoutOffset - layoutStart, lineCount,
      ...(wh ? { wh } : {}), images, hasImg: hasImg === true,
    };
    writeAll(this.indexFd, `${JSON.stringify(record)}\n`);
    this.pages += 1;
    return record;
  }

  close() {
    for (const key of ["indexFd", "textFd", "layoutFd"]) {
      if (this[key] != null) fs.closeSync(this[key]);
      this[key] = null;
    }
  }
}
