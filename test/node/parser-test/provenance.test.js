












import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractMetadata } from "../../../B.Parser/prised/@core/pdf/method/pdfencoding/decoding.js";
import { startRecord, note, appendRecord, registerPath } from "../../../B.Parser/prised/@helper/provenance.js";

test("a PDF with no /Info yields {} rather than throwing", () => {
  assert.deepEqual(extractMetadata(new Map(), Buffer.from("trailer<</Size 1>>")), {});
});



const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "linga-register-"));

test("one document appends one greppable, parseable entry", () => {
  const dir = tmpdir();
  const file = path.join(dir, "register.log");

  const record = startRecord("/somewhere/bg-mlc-1-1.pdf");
  note(record, { pages: 12, metadata: { Producer: "LibreOffice 3.6" } });
  note(record, { codepage: { chosen: "vector:WinInnwa", score: 0.986, accepted: true } });
  assert.equal(appendRecord(record, { file }), file);

  const text = fs.readFileSync(file, "utf8");

  assert.match(text, /^bg-mlc-1-1\.pdf$/mu);

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
  assert.equal(record.pages, null);
  assert.equal(record.metadata, null);
  assert.equal(note(null, { pages: 1 }), null);
});
