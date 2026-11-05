// Local entry dispatch stream (unshared)
// Extracted from: B.Parser/main/parser/manager.js
// Contains: dispatchStream() for 'local' caller.
// Not wired into manager.js yet; file names only.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { readManagerPayload } from "../shared/65-manager-payload.js";

export class LocalDispatchStream {
  #laneTails;
  #pending;
  #seq;
  #workers;
  outputDir;

  constructor({ outputDir } = {}) {
    this.outputDir = outputDir;
  }

  #submit(lane, payload, budget, owner) {
    // placeholder — wiring deferred
  }

  #dispatch(job, caller, owner, identity = null) {
    // placeholder — wiring deferred
  }

  async dispatchStream(source, job = {}) {
    if (!source || typeof source[Symbol.asyncIterator] !== "function") {
      throw new TypeError("A readable byte stream is required");
    }
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      throw new TypeError("A local Manager job object is required");
    }
    if ("inPath" in job || "data" in job) {
      throw new TypeError("Supply the source stream, not an input path or buffer");
    }
    const name = typeof job.filename === "string" ? path.basename(job.filename) : "";
    const inputKind = job.inputKind === undefined
      ? (name.toLowerCase().endsWith(".pdf") ? "pdf" : name.toLowerCase().endsWith(".docx") ? "docx" : "")
      : String(job.inputKind).toLowerCase();
    if (inputKind !== "pdf" && inputKind !== "docx") {
      throw new Error("Local stream input must be a PDF or DOCX");
    }
    const localJob = {
      job: "extracting", method: "default", ...job,
      output: job.output ?? job.outputType ?? "txt",
      inputKind, filename: name || `input.${inputKind}`,
    };
    readManagerPayload(localJob);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "linga-parser-input-"));
    const inPath = path.join(directory, `input.${inputKind}`);
    async function* byteChunks() {
      for await (const chunk of source) {
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Local stream must yield bytes");
        yield Buffer.from(chunk);
      }
    }
    try {
      await pipeline(byteChunks(), createWriteStream(inPath, { flags: "wx", mode: 0o600 }));
      return await this.#dispatch({ ...localJob, inPath }, "local", true);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
