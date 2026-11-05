// C — Dispatcher (engine bridge pattern)
// Single entry for both site and local callers.
// Caller reads the file/stream on their side (via 26-stream-reader.js) and
// passes the resulting object directly. The dispatcher does NOT read files.
// Site caller: passes object + method + caller: "site" (+ identity)
// Local caller: passes object + method + caller: "local"
// No temp files, no file paths in the API boundary, no reading back from disk.
import { BindParser } from "./25-bind-parser.js";

export async function dispatchSite({ object, method, identity }) {
  return BindParser({ object, method, caller: "site", identity });
}

export async function dispatchLocal({ object, method, identity }) {
  return BindParser({ object, method, caller: "local", identity });
}
