// Manager OCR helpers (shared)
// Extracted from: B.Parser/main/parser/manager.js
// Contains: #dispatchOcr, dispatchImages, startOcr, dispatchOcrImageDetailed,
// renderPlainText.
// Not wired into manager.js yet; file names only.

import { writeOutput } from "./write/emit.js";
import { ocrTimeoutMs, MAX_INPUT_BYTES, MAX_INPUT_MB } from "./core/limits.js";

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
    // placeholder — wiring deferred
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
    if (!(data instanceof Uint8Array) || (!ownerAccess(identity) && data.byteLength > MAX_INPUT_BYTES)) {
      throw new Error(`OCR image must be bytes within the ${MAX_INPUT_MB} MB cap`);
    }
    return this.#dispatchOcr({ type: "ocrImageDetailed", data }, 1, ownerAccess(identity));
  }

  async renderPlainText({ inPath, outPath }, identity = null) {
    if (!inPath || !outPath || path.extname(outPath).toLowerCase() !== ".docx") {
      throw new Error("Plain text rendering requires an input file and a .docx output path");
    }
    const info = await fs.stat(inPath);
    if (!ownerAccess(identity) && info.size > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const bytes = await fs.readFile(inPath);
    if (!ownerAccess(identity) && bytes.byteLength > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return writeOutput(outPath, [{ text }], { source: path.basename(inPath), owner: ownerAccess(identity) });
  }
}
