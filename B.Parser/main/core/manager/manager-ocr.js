import fs from "node:fs/promises";
import path from "node:path";
import { writeOutput } from "../io/emit.js";
import { ocrTimeoutMs, MAX_INPUT_BYTES, MAX_INPUT_MB } from "../limits/local.js";

export class ManagerOcrHelpers {
  #laneTails;
  #pending;
  #seq;
  #workers;

  constructor(laneTails, pending, seq, workers) {
    this.#laneTails = laneTails;
    this.#pending = pending;
    this.#seq = seq;
    this.#workers = workers;
  }

  #submit(lane, payload, budget, owner) {
    // wiring deferred — placeholder
  }

  async #dispatchOcr(payload, count, owner) {
    const lane = "ocr";
    const previous = this.#laneTails[lane];
    let releaseLane;
    const laneDone = new Promise((resolve) => { releaseLane = resolve; });
    this.#laneTails[lane] = previous.catch(() => {}).then(() => laneDone);
    await previous.catch(() => {});
    try {
      const reply = await this.#submit(lane, payload, ocrTimeoutMs(count), owner);
      return reply.result;
    } finally {
      releaseLane();
    }
  }

  async dispatchImages(files, identity = null) {
    if (!Array.isArray(files) || files.length === 0) return [];
    return (await this.#dispatchOcr({ op: "ocr-images", files }, files.length, ownerAccess(identity))) ?? [];
  }

  async startOcr(identity = null) {
    return this.#dispatchOcr({ type: "init" }, 1, ownerAccess(identity));
  }

  async dispatchOcrImageDetailed(data, identity = null) {
    const owner = ownerAccess(identity);
    if (!(data instanceof Uint8Array) || (!owner && data.byteLength > MAX_INPUT_BYTES)) {
      throw new Error(`OCR image must be bytes within the ${MAX_INPUT_MB} MB cap`);
    }
    return this.#dispatchOcr({ type: "ocrImageDetailed", data }, 1, owner);
  }

  async renderPlainText({ inPath, outPath }, identity = null) {
    const owner = ownerAccess(identity);
    if (!inPath || !outPath || path.extname(outPath).toLowerCase() !== ".docx") {
      throw new Error("Plain text rendering requires an input file and a .docx output path");
    }
    const info = await fs.stat(inPath);
    if (!owner && info.size > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const bytes = await fs.readFile(inPath);
    if (!owner && bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return writeOutput(outPath, [{ text }], { source: path.basename(inPath), owner });
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

export { ownerAccess };
