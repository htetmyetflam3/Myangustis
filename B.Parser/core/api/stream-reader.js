/*
(Support 20) Shared support, no chain position - the caller-side file reader.
This module reads a file or stream on the caller's side into the object the parser API accepts. The dispatcher never calls it; callers do.
*/
// B — Stream reader (caller-side utility)
// Caller reads the file/stream on their side and passes the resulting object
// into BindParser. This module is NOT called by the dispatcher.
// Usage:
//   const { streamReader } = require('./26-stream-reader.js');
//   const object = await streamReader({ path: '/path/to/file.pdf' });
//   BindParser({ object, method: 'extracting', caller: 'site' });
import fs from "node:fs/promises";
import path from "node:path";

export async function streamReader({ path: filePath }) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("streamReader: file path is required");
  }
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`streamReader: not a file: ${filePath}`);
  }
  const bytes = await fs.readFile(filePath);
  return { path: filePath, size: stat.size, bytes };
}

export async function streamReaderStream(source) {
  if (!source || typeof source[Symbol.asyncIterator] !== "function") {
    throw new TypeError("streamReaderStream: a readable stream is required");
  }
  const chunks = [];
  for await (const chunk of source) {
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  return { bytes, size: bytes.length };
}
