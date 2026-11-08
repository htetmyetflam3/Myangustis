/*
(Input chain - the middle module) Third link, between the collector and the next chain (the outside-stream skeleton parser).
This module holds nothing. It takes the landed tmp file from the collector and passes one file downstream: either the same file untouched (clean - no /Encrypt, no /ObjStm: nothing to prepare), or a qpdf-prepared file (encrypted or object-streamed: qpdf decrypts + expands + repairs, working file to file). Detection runs on the file in bounded blocks - no qpdf call and no memory load happens before the decision. A collected tmp that goes through qpdf is deleted once prepared; the prepared file is owned by downstream from that moment.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanPdfFileMarkers } from "./decrypt.js";

// Only PDFs are qpdf's business. Anything else that flows through the
// chain (DOCX above all) passes through untouched.
function isPdfFile(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    return head.toString("latin1") === "%PDF-";
  } finally {
    fs.closeSync(fd);
  }
}
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

// Consume the collector's landed file and emit exactly one item:
//   { prepared: false, kind: "file", path, encrypted, objectStreams }
//   { prepared: true,  kind: "file", path, encrypted, objectStreams }
// Either way downstream receives a file to peek by offset; this module
// retains nothing. A `collected` input tmp is deleted once qpdf has
// produced the prepared file (or failed trying).
export async function* prepareMiddle(source, { workDir } = {}) {
  for await (const item of source) {
    const input = typeof item === "string" ? item : item?.path;
    if (!input) throw new TypeError("prepareMiddle: a landed file is required");
    if (!isPdfFile(input)) {
      yield { prepared: false, kind: "file", path: input, encrypted: false, objectStreams: false };
      return;
    }
    const { encrypted, objectStreams } = scanPdfFileMarkers(input);

    if (!encrypted && !objectStreams) {
      // Nothing to prepare: pass the very same file downstream.
      yield { prepared: false, kind: "file", path: input, encrypted, objectStreams };
      return;
    }

    const ownDir = !workDir;
    const directory = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-prepare-"));
    fs.mkdirSync(directory, { recursive: true });
    const prepared = path.join(directory, "prepared.pdf");
    try {
      await prepareTmp(input, prepared);
    } catch (error) {
      if (ownDir) fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    } finally {
      if (item?.collected) fs.rmSync(input, { force: true });
    }
    yield { prepared: true, kind: "file", path: prepared, encrypted, objectStreams };
    return;
  }
}
