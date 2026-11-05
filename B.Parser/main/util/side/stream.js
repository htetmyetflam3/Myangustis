// Local entry dispatch stream (unshared)
// Caller passes a readable byte stream or object directly; dispatcher receives
// { object, method } and passes to BindParser ($). No temp file, no read-back.
import { streamReaderStream } from "../api/stream-reader.js";
import { BindParser } from "../api/bind-parser.js";

export class LocalDispatchStream {
  #workers = { extract: null, ocr: null, ownerExtract: null, ownerOcr: null };
  #pending = new Map();
  #laneTails = { extract: Promise.resolve(), ocr: Promise.resolve() };
  #seq = 0;

  constructor({ outputDir } = {}) {
    this.outputDir = outputDir;
  }

  async dispatchStream(source, method = "extracting", identity = null) {
    const owner = ownerAccess(identity);
    const object = await streamReaderStream(source);
    return BindParser({ object, method, caller: "local", identity, owner });
  }

  async close() {
    for (const entry of this.#pending.values()) {
      entry.reject(new Error("Parser manager is shutting down"));
    }
    this.#pending.clear();
  }
}

function ownerAccess(identity) {
  if (identity === undefined || identity === null) return false;
  if (typeof identity !== "object" || Array.isArray(identity) ||
      typeof identity.userId !== "string" || !identity.userId.trim()) {
    throw new Error("A trusted user ID is required");
  }
  return true;
}
