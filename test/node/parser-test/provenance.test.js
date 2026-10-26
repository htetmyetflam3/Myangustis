/**
 * FILE: Parsed/parser/test/provenance.test.mjs
 *
 * Covers the authoring register (core/provenance.mjs) and the /Info reader it
 * depends on (read/pdf-extract.mjs extractMetadata).
 *
 * The metadata tests use the real fixtures on purpose. extractMetadata looked
 * correct for a long time while returning {} for every PDF in existence,
 * because it searched the Catalog for a key that lives in the trailer. A unit
 * test with a hand-made dictionary would have passed. Only real files catch
 * this, so these assert actual values from actual documents.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractMetadata, parsePdfObjects } from "../../../Parser/main/parser/read/pdf-extract.mjs";
import { startRecord, note, appendRecord, registerPath } from "../../../Parser/main/parser/core/provenance.mjs";

const REPO = path.dirname(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))));
// working-branch mapping: the fixtures this suite wants live in the upload
// books here, not under Parsed/fixtures (which exists on no branch).
const fixture = (name) => path.join(REPO, "Parser/main/File/upload/pdf", name);
const readInfo = (file) => {
  const bytes = fs.readFileSync(file);
  return extractMetadata(parsePdfObjects(bytes), bytes);
};

/* ── the /Info reader ───────────────────────────────────────────────── */

test("reads /Info from the trailer, not the catalog", () => {
  const info = readInfo(fixture("bg-mlc-1-1.pdf"));
  // Every value here is a hex UTF-16BE string; the old reader saw none of them.
  assert.equal(info.Author, "Tyler Davis");
  assert.equal(info.Creator, "Writer");
  assert.equal(info.Producer, "LibreOffice 3.6");
  assert.match(info.CreationDate, /^D:2013/);
});

test("decodes a second real document with different producers", (t) => {
  const file = fixture("\u1018\u101d\u1011\u102d\u102f\u1011\u102d\u102f-part_1.pdf");
  if (!fs.existsSync(file)) return t.skip("fixture exists on no branch of this repo");
  const info = readInfo(file);
  assert.equal(info.Producer, "IntSig");
  assert.equal(info.Author, "CamScanner");  // i.e. this one is a scan -> OCR path
});

test("a PDF with no /Info yields {} rather than throwing", () => {
  const objects = parsePdfObjects(Buffer.from("%PDF-1.4\ntrailer<</Size 1>>\n%%EOF\n", "latin1"));
  assert.deepEqual(extractMetadata(objects, Buffer.from("trailer<</Size 1>>")), {});
});

/* ── the register ───────────────────────────────────────────────────── */

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "linga-register-"));

test("one document appends one greppable, parseable entry", () => {
  const dir = tmpdir();
  const file = path.join(dir, "register.log");

  const record = startRecord("/somewhere/bg-mlc-1-1.pdf");
  note(record, { pages: 12, metadata: { Producer: "LibreOffice 3.6" } });
  note(record, { codepage: { chosen: "vector:WinInnwa", score: 0.986, accepted: true } });
  assert.equal(appendRecord(record, { file }), file);

  const text = fs.readFileSync(file, "utf8");
  // greppable: the bare filename on its own line
  assert.match(text, /^bg-mlc-1-1\.pdf$/mu);
  // and the path is kept so the source can be found again
  const body = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  assert.equal(body.sourcePath, "/somewhere/bg-mlc-1-1.pdf");
  assert.equal(body.pages, 12);
  assert.equal(body.metadata.Producer, "LibreOffice 3.6");
  assert.equal(body.codepage.chosen, "vector:WinInnwa");
});

test("entries accumulate, newest last", () => {
  const file = path.join(tmpdir(), "register.log");
  appendRecord(note(startRecord("first.pdf"), { pages: 1 }), { file });
  appendRecord(note(startRecord("second.pdf"), { pages: 2 }), { file });

  const names = [...fs.readFileSync(file, "utf8").matchAll(/^(\w+\.pdf)$/gmu)].map((m) => m[1]);
  assert.deepEqual(names, ["first.pdf", "second.pdf"]);
});

test("PRASER_REGISTER=0 writes nothing at all", () => {
  const file = path.join(tmpdir(), "register.log");
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = "0";
  try {
    assert.equal(appendRecord(startRecord("ignored.pdf"), { file }), null);
    assert.equal(fs.existsSync(file), false);
  } finally {
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
  }
});

test("PRASER_REGISTER=<path> overrides the default location", () => {
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = "/tmp/elsewhere.log";
  try {
    assert.equal(registerPath("/default.log"), "/tmp/elsewhere.log");
  } finally {
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
  }
  assert.equal(registerPath("/default.log"), "/default.log");
});

test("a register that cannot be written never fails the conversion", () => {
  const lines = [];
  /* A FILE standing where a directory is needed: mkdirSync fails with
     ENOTDIR immediately. Do NOT reach for a /proc path here -- recursive
     mkdir under /proc does not fail, it HANGS, and that hung this whole
     file for long enough that it got parked instead of diagnosed. */
  const blocker = path.join(tmpdir(), "not-a-directory");
  fs.writeFileSync(blocker, "x");
  const unwritable = path.join(blocker, "register.log");
  assert.equal(appendRecord(startRecord("x.pdf"), { file: unwritable, log: (m) => lines.push(m) }), null);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /Register not written/u);
});

test("note() ignores undefined so call sites stay one-liners", () => {
  const record = startRecord("x.pdf");
  note(record, { pages: undefined, metadata: null });
  assert.equal(record.pages, null);     // untouched default
  assert.equal(record.metadata, null);  // explicit null is recorded
  assert.equal(note(null, { pages: 1 }), null);
});
