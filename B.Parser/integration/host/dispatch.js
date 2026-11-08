/*
(Support 6) Shared support, no chain position - the site's dispatch door.
This module is SiteDispatch: it reads the caller's file into an object and hands { object, method } to the API dispatcher (Support 19) for routing.
*/
// Site entry dispatch — delegates routing to the API dispatcher.
// Calls BindInput (input-dispatcher) on the caller's side to read the file into an object,
// then passes { object, method } through the dispatcher which assigns the
// correct worker thread based on caller type. No temp files, no read-back.
import fs from "node:fs/promises";
import { BindInput } from "../../core/api/input-dispatcher.js";
import { dispatchSite } from "../../core/api/dispatcher.js";

export class SiteDispatch {
  constructor({ outputDir, quiet } = {}) {
    this.outputDir = outputDir;
  }

  async dispatch(filePath, method = "extracting", identity = null) {
    const owner = ownerAccess(identity);
    const object = await BindInput({ path: filePath });
    // `method` here names the job (extracting/ocr); the dispatcher takes a
    // job object plus the default mode. One shape, built here.
    const jobType = method === "ocr" ? "ocr" : "extracting";
    try {
      return await dispatchSite({
        object, method: "default", identity,
        job: { job: jobType, method: "default", owner },
      });
    } finally {
      // A collected/prepared tmp is chain-owned: the job is done with it.
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
