/*
(Input chain, new - not wired into the live chain yet) Generator A: the file-reading stream, first link.
This module reads a file from a given path and emits its bytes as a sequence of chunks (an async generator). It parses nothing and keeps nothing - each chunk is handed downstream and forgotten.
*/
import fs from "node:fs";

// Generator A: emit the file at `filePath` as chunks of bytes.
// The consumer decides what a chunk means; this module only reads.
export async function* generatorA(filePath, { chunkBytes = 1024 * 1024 } = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("generatorA: file path is required");
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`generatorA: not a file: ${filePath}`);
  }
  const stream = fs.createReadStream(filePath, { highWaterMark: chunkBytes });
  for await (const chunk of stream) {
    yield chunk;
  }
}
