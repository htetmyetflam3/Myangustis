/*
(Input chain, new - not wired into the live chain yet) The middle module: third link, between the collector and the next chain (the outside-stream skeleton parser).
This module holds nothing. It takes the whole bytes from upstream and passes one thing downstream: either the bytes themselves (clean file - no /Encrypt, no /ObjStm: nothing to prepare), or the path of a qpdf-prepared file (encrypted or object-streamed: bytes are written to a tmp file instantly, dropped from memory, and qpdf decrypts + expands + repairs that tmp; the prepared file is then emitted by path so downstream peeks it by offset instead of loading it). The encryption/object-stream checks run on the in-memory bytes - no qpdf call, no disk write happens before the decision.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isEncryptedPdf, hasObjectStreams } from "./decrypt.js";
import { runQpdfFile } from "./qpdf.js";
import { copyPdfPrefix, findPdfEnd } from "../pdf/pdf-tail.js";

// Same qpdf work as preparePdf in core/pdf/pdf-stream.js (the live
// chain's prepare step): decrypt with empty password, disable object
// streams, preserve content streams. Kept in step deliberately; the
// damaged-file retry (trim to the true PDF end, prepare again) too.
async function prepareTmp(input, prepared) {
  const prepare = (source) => runQpdfFile(source, prepared, [
    "--password=", "--decrypt", "--object-streams=disable", "--stream-data=preserve",
  ]);
  try {
    try {
      await prepare(input);
    } catch (cause) {
      if (!/can.t find startxref/iu.test(String(cause?.message))) throw cause;
      const end = findPdfEnd(input);
      if (!end || end >= fs.statSync(input).size) throw cause;
      const trimmed = path.join(path.dirname(input), "trimmed.pdf");
      copyPdfPrefix(input, trimmed, end);
      try {
        await prepare(trimmed);
      } finally {
        fs.rmSync(trimmed, { force: true });
      }
    }
  } catch (cause) {
    if (/invalid password|password.*incorrect|requires a password/iu.test(String(cause?.message))) {
      throw new Error("This PDF needs a password to open; supply an unprotected copy.", { cause });
    }
    throw cause;
  }
}

// Consume the collected whole bytes and emit exactly one item:
//   { prepared: false, kind: "bytes", bytes, encrypted, objectStreams }
//   { prepared: true,  kind: "file",  path,  encrypted, objectStreams }
// The "file" path is owned by downstream from that moment (it peeks it
// by offset and cleans it up); this module retains no reference to the
// bytes in either branch.
export async function* prepareMiddle(source, { workDir } = {}) {
  for await (const item of source) {
    let bytes = Buffer.isBuffer(item) ? item : Buffer.from(item);
    const encrypted = isEncryptedPdf(bytes);
    const objectStreams = hasObjectStreams(bytes);

    if (!encrypted && !objectStreams) {
      // Nothing to prepare: pass the very same bytes downstream.
      yield { prepared: false, kind: "bytes", bytes, encrypted, objectStreams };
      return;
    }

    // Encrypted or object-streamed: write to tmp instantly, drop the
    // in-memory copy, and let qpdf work on the file.
    const directory = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-prepare-"));
    fs.mkdirSync(directory, { recursive: true });
    const input = path.join(directory, "input.pdf");
    const prepared = path.join(directory, "prepared.pdf");
    fs.writeFileSync(input, bytes, { mode: 0o600 });
    bytes = null; // flush: the bytes now live only in the tmp file
    try {
      await prepareTmp(input, prepared);
    } finally {
      fs.rmSync(input, { force: true });
    }
    yield { prepared: true, kind: "file", path: prepared, encrypted, objectStreams };
    return;
  }
}
