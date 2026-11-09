/*

*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "./limit.js";
import { decryptPdf } from "./decrypt.js";
import { validateDocx } from "./validator.js";
import { passDocx } from "./docx.js";
import { validateImage, passOcr } from "./ocr.js";

async function* byteSource(trigger) {
  if (trigger.path) {
    yield* fs.createReadStream(trigger.path);
    return;
  }
  const object = trigger.object;
  if (object instanceof Uint8Array) {
    yield Buffer.from(object.buffer, object.byteOffset, object.byteLength);
    return;
  }
  if (object && typeof object[Symbol.asyncIterator] === "function") {
    for await (const chunk of object) yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    return;
  }
  throw new TypeError("InitInput: object must be bytes or a readable byte stream");
}

// Land a source in a tmp file, incrementally, capped. Never a whole
// file held in memory.
async function landTmp(source, ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-input-"));
  const file = path.join(dir, "input" + ext);
  const out = fs.createWriteStream(file, { mode: 0o600 });
  let size = 0;
  try {
    for await (const chunk of source) {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) throw new Error("Parser input exceeds the " + MAX_INPUT_MB + " MB cap");
      if (!out.write(chunk)) await new Promise((resolve) => out.once("drain", resolve));
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  } catch (err) {
    out.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return { path: file, size };
}

async function collectBytes(source) {
  const parts = [];
  let size = 0;
  for await (const chunk of source) {
    size += chunk.length;
    if (size > MAX_INPUT_BYTES) throw new Error("Parser input exceeds the " + MAX_INPUT_MB + " MB cap");
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export async function InitInput(trigger = {}) {
  const { path: filePath = null, object = null, filename = null } = trigger ?? {};
  if ((filePath === null) === (object === null)) {
    throw new TypeError("InitInput: give exactly one of { path } or { object }");
  }

  // Peek at the head (12 bytes covers every magic incl. WebP) without
  // losing it: peeked chunks are re-fed into whichever branch is chosen.
  const iterator = byteSource(trigger)[Symbol.asyncIterator]();
  const head = [];
  let headBytes = 0;
  while (headBytes < 12) {
    const { done, value } = await iterator.next();
    if (done) break;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    head.push(chunk);
    headBytes += chunk.length;
  }
  async function* rest() {
    for (const chunk of head) yield chunk;
    let step;
    while (!(step = await iterator.next()).done) yield step.value;
  }
  const headBuf = Buffer.concat(head);

  // ---- the branch ---------------------------------------------------------
  const verdict = validateDocx(headBuf);
  if (verdict.kind === "pdf") {
    if (filePath) {
      const out = await decryptPdf(filePath);
      return { kind: "pdf", path: out.path, prepared: out.prepared, size: fs.statSync(out.path).size };
    }
    const landed = await landTmp(rest(), ".pdf");
    const out = await decryptPdf(landed.path);
    return { kind: "pdf", path: out.path, prepared: out.prepared, size: out.size ?? landed.size, collected: true };
  }
  if (verdict.kind === "docx") {
    const bytes = filePath ? await fs.promises.readFile(filePath) : await collectBytes(rest());
    if (!validateDocx(bytes).valid) throw new TypeError("InitInput: PK header but not a valid DOCX package");
    return { kind: "docx", ...passDocx(bytes, filename) };
  }
  const imageKind = validateImage(headBuf);
  const landed = await landTmp(rest(), imageKind ? "." + imageKind.replace("jpeg", "jpg") : ".bin");
  if (imageKind) return { ...passOcr(landed.path, imageKind, landed.size), collected: true };
  return { kind: "other", path: landed.path, size: landed.size, collected: true };
}
