// C — Dispatcher (engine bridge pattern)
// Single entry for both site and local callers.
// Site: calls streamReader (B) to read the file into an object, then passes
//       { object, method } to BindParser ($).
// Local: caller already provides the object/stream; passes directly to BindParser.
// No temp files, no file paths in the API boundary, no reading back from disk.
import { BindParser } from "./25-bind-parser.js";
import { streamReader } from "./26-stream-reader.js";

// Site caller: file already on disk at filePath; read it into an object via B,
// then dispatch object + method to BindParser ($).
export async function dispatchSite({ filePath, method, identity }) {
  const object = await streamReader({ path: filePath });
  return BindParser({ object, method, caller: "site", identity });
}

// Local caller: caller already provides the object/stream; pass directly to BindParser.
export async function dispatchLocal({ object, method, identity }) {
  return BindParser({ object, method, caller: "local", identity });
}
