import fs from "node:fs";

const BLOCK_SIZE = 64 * 1024;

// Some PDFs have very long comments after the last EOF. Find the last complete
// startxref/EOF pair in bounded reverse reads rather than loading the PDF.
export function findPdfEnd(source) {
  const fd = fs.openSync(source, "r");
  try {
    const size = fs.fstatSync(fd).size;
    let end = size;
    let following = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - BLOCK_SIZE);
      const block = Buffer.allocUnsafe(end - start);
      const count = fs.readSync(fd, block, 0, block.length, start);
      if (count !== block.length) throw new Error("PDF tail ended unexpectedly");
      const bytes = following.length ? Buffer.concat([block, following]) : block;
      const text = bytes.toString("latin1");
      const matches = [...text.matchAll(/startxref\s+(\d+)\s+%%EOF/gu)];
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        const xref = Number(match[1]);
        const absolute = start + match.index;
        if (Number.isSafeInteger(xref) && xref >= 0 && xref < absolute) {
          return absolute + match[0].length;
        }
      }
      following = Buffer.from(bytes.subarray(0, Math.min(bytes.length, BLOCK_SIZE)));
      end = start;
    }
    return null;
  } finally { fs.closeSync(fd); }
}

export function copyPdfPrefix(source, target, length) {
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError("Invalid PDF length");
  const input = fs.openSync(source, "r");
  let output = null;
  try {
    output = fs.openSync(target, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
    let position = 0;
    while (position < length) {
      const count = fs.readSync(input, buffer, 0, Math.min(buffer.length, length - position), position);
      if (!count) throw new Error("PDF ended while copying its valid prefix");
      let written = 0;
      while (written < count) {
        const n = fs.writeSync(output, buffer, written, count - written);
        if (!n) throw new Error("Could not write the PDF temporary file");
        written += n;
      }
      position += count;
    }
  } finally {
    fs.closeSync(input);
    if (output !== null) fs.closeSync(output);
  }
}
