/*
(Support 7) Shared support, no chain position - file reader for queued site requests.
This module turns a queued upload file into the object shape the trigger and dispatcher accept, delegating the actual read to the one stream reader (Support 20).
*/
import path from "node:path";
import { streamReader } from "../../core/api/stream-reader.js";

// File reader for queued Site requests.
//
// The queue owns the saved upload path, but it should not hand only that
// path to the trigger and make the parser read the file again later. This
// reader turns the queued file into the object shape the trigger/dispatcher
// already accepts, while delegating the actual read to the existing
// streamReader so there is still only one file-reading implementation.
export async function readFileForTrigger({
  filePath,
  filename = null,
  mimeType = null,
  inputFormat = null,
} = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("readFileForTrigger: file path is required");
  }

  const object = await streamReader({ path: filePath });
  const resolvedFilename = filename || path.basename(object.path);
  return {
    ...object,
    filename: resolvedFilename,
    mimeType: mimeType || null,
    inputFormat: inputFormat || path.extname(resolvedFilename).slice(1).toLowerCase() || null,
  };
}
