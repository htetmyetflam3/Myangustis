// Site entry dispatch (unshared)
// Calls streamReader (B) on the caller's side to read the file into an object,
// then passes { object, method } to BindParser ($).
// Public (no identity) and authenticated (identity = authenticatedUser) callers
// share the same dispatch path; identity only affects owner access checks.
import { streamReader } from "../shared/26-stream-reader.js";
import { BindParser } from "../shared/25-bind-parser.js";

export class SiteDispatch {
  #workers = { extract: null, ocr: null, ownerExtract: null, ownerOcr: null };
  #pending = new Map();
  #laneTails = { extract: Promise.resolve(), ocr: Promise.resolve() };
  #seq = 0;

  constructor({ outputDir, quiet } = {}) {
    this.outputDir = outputDir;
  }

  async dispatch(filePath, method = "extracting", identity = null) {
    const owner = ownerAccess(identity);
    const object = await streamReader({ path: filePath });
    return BindParser({ object, method, caller: "site", identity, owner });
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
