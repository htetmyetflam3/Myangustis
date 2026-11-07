// Local entry dispatch stream — delegates routing to the API dispatcher.
// Caller passes a readable byte stream or object directly; the dispatcher
// assigns the correct worker thread based on caller type. No temp file, no read-back.
import { streamReaderStream } from "../../../core/api/stream-reader.js";
import { dispatchLocal } from "../../../core/api/dispatcher.js";

export class LocalDispatchStream {
  constructor({ outputDir } = {}) {
    this.outputDir = outputDir;
  }

  async dispatchStream(source, method = "extracting", identity = null) {
    const owner = ownerAccess(identity);
    const object = await streamReaderStream(source);
    // `method` here names the job (extracting/ocr); the dispatcher takes a
    // job object plus the default mode. One shape, built here.
    const jobType = method === "ocr" ? "ocr" : "extracting";
    return dispatchLocal({
      object, method: "default", identity,
      job: { job: jobType, method: "default", owner },
    });
  }

  async close() {
    // No local workers to terminate; pool.close() is handled by the Manager.
  }
}

function ownerAccess(identity) {
  if (identity === undefined || identity === null) return false;
  if (typeof identity !== "object" || Array.isArray(identity) || typeof identity.userId !== "string" || !identity.userId.trim()) {
    throw new Error("A trusted user ID is required");
  }
  return true;
}
