/*
(Input chain, new - the collector as an incremental tmp writer) Second link: consumes Generator A (or any chunk stream) and lands it in a tmp file.
For PDF, holding the whole input in memory bought nothing - every downstream stage peeks files by offset anyway - so PDF collection is a landing, not a holding: each chunk is written to a tmp file as it arrives, the byte cap is enforced while writing (a partial file is destroyed on overflow), and exactly one item is emitted: { path, size, collected: true }. Memory stays flat no matter how large the input; the emitted tmp is owned by the chain's consumer, marked by `collected`. DOCX is the one exception (collectBytes below): its runner reads the whole archive in memory regardless, so it is passed the object directly.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../../core/limits/local.js";

let sequence = 0;

// The whole bytes in memory. This is DOCX's landing: its runner reads
// the whole archive anyway (the zip directory sits at the end), so a
// tmp file would only add a write+read round trip. PDF never lands
// here - it goes to the tmp writer above. Cap enforced identically.
export async function collectBytes(source, { maxBytes = MAX_INPUT_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

// Consume every chunk from `source`, writing each to a fresh tmp file
// as it arrives, then yield the landed file once: { path, size }.
// Nothing of the input is retained in memory beyond one chunk.
export async function* collectA(source, { maxBytes = MAX_INPUT_BYTES, nameHint = null } = {}) {
  // The tmp keeps the trigger filename's extension when one is known:
  // downstream kind detection reads names before it reads bytes.
  const hinted = String(nameHint ?? "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  const file = path.join(
    os.tmpdir(),
    `myangustis-input-${process.pid}-${++sequence}.${hinted ?? "tmp"}`,
  );
  const out = fs.createWriteStream(file, { mode: 0o600 });
  let total = 0;
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
      }
      if (!out.write(buf)) {
        await new Promise((resolve, reject) => {
          out.once("drain", resolve);
          out.once("error", reject);
        });
      }
    }
    await new Promise((resolve, reject) => {
      out.end((error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    out.destroy();
    fs.rmSync(file, { force: true });
    throw error;
  }
  yield { path: file, size: total, collected: true };
}
