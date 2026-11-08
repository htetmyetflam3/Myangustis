/*
(Support 13) Shared support, no chain position - the local dispatch entry (stream variant).
This module is LocalDispatchStream: the caller passes a readable byte stream or object directly, and the API dispatcher (Support 19) assigns the worker. No temp file, no read-back.
*/
// Local entry dispatch stream — delegates routing to the API dispatcher.
// Caller passes a readable byte stream or object directly; the dispatcher
// assigns the correct worker thread based on caller type. No temp file, no read-back.
import fs from "node:fs/promises";
import { BindInput } from "../../../core/api/input-dispatcher.js";
import { dispatchLocal } from "../../../core/api/dispatcher.js";

export class LocalDispatchStream {
  constructor({ outputDir } = {}) {
    this.outputDir = outputDir;
  }

  async dispatchStream(source, method = "extracting", identity = null) {
    const owner = ownerAccess(identity);
    const object = await BindInput({ object: source });
    try {
      // `method` here names the job (extracting/ocr); the dispatcher takes a
      // job object plus the default mode. One shape, built here.
      const jobType = method === "ocr" ? "ocr" : "extracting";
      return await dispatchLocal({
        object, method: "default", identity,
        job: { job: jobType, method: "default", owner },
      });
    } finally {
      // A collected tmp is chain-owned: the job is done with it.
      if (object?.collected) await fs.rm(object.path, { force: true }).catch(() => {});
    }
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
