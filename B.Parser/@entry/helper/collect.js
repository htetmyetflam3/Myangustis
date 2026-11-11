/*
(new/collect) The tmp writer - one generator, nothing held.
Consumes Generator A (or any chunk stream) and lands it in a tmp
file, chunk by chunk as chunks arrive: each chunk is written and
forgotten, the byte cap is enforced while writing (a partial file
is destroyed on overflow), and exactly one item is emitted at the
end: { path, size, collected: true }. Memory stays flat no matter
how large the input. There is deliberately no whole-bytes variant
here - no stage in this tree holds an entire input in memory; the
lanes validate and decrypt from the landed file, by offset.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "./limit.js";

let sequence = 0;

// Consume every chunk from `source`, writing each to a fresh tmp file
// as it arrives, then yield the landed file once: { path, size }.
// Nothing of the input is retained beyond the chunk in flight.
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
