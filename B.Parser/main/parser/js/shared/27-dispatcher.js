// C — Dispatcher
// Single entry for both site and local callers.
// Site: calls streamReader (B) to read the file into an object, then passes
//       { object, method } to singleApi ($).
// Local: caller already has the object/stream; passes { object, method }
//        directly to singleApi ($).
// No temp files, no file paths in the API boundary, no reading back from disk.
import { singleApi } from "./25-single-api.js";
import { streamReader } from "./26-stream-reader.js";

// Site caller: file already on disk at filePath; read it into an object via B,
// then dispatch object + method to $.
export async function dispatchSite({ filePath, method, identity }) {
  const object = await streamReader({ path: filePath });
  return singleApi({ object, method });
}

// Local caller: caller already provides the object/stream; pass directly to $.
export async function dispatchLocal({ object, method, identity }) {
  return singleApi({ object, method });
}
