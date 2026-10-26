import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  abs,
  PARSED_ROOT,
  PARSER_DIR,
  PRASER_JS,
  validatePraserAssets,
} from "../backend/file/paths.js";
import {
  MAP_DIR,
  MODEL_DIR,
  OCR_MODEL_DIR,
  OUTPUT_FONT_DIR,
  findLatinFont,
  findModelPath,
  findMyanmarFont,
} from "../Parsed/parser/module/paths.mjs";
import { ruleCount } from "../Parsed/parser/module/rabbit.mjs";
import { loadSidecarMap } from "../Parsed/parser/module/pdf-extract.mjs";
import { Manager } from "../Parsed/parser/module/manager.mjs";
import { ZipStreamWriter } from "../Parsed/parser/module/zip.mjs";
import { validateDocxArchive } from "../Parsed/parser/module/docx-extract.mjs";

const isFile = (file) => fs.statSync(file).isFile();

test("relocated parser has every boot-critical sidecar", () => {
  const files = validatePraserAssets();
  assert.ok(files.length >= 10);
  assert.ok(files.every(isFile));
  assert.equal(PARSED_ROOT, "Parsed");
  assert.equal(PARSER_DIR, "Parsed/parser");
  assert.equal(PRASER_JS, "Parsed/parser/module/prase.mjs");
});

test("parser maps and models resolve outside the executable module directory", () => {
  assert.equal(path.basename(MAP_DIR), "map");
  assert.equal(path.basename(MODEL_DIR), "model");
  assert.equal(OCR_MODEL_DIR, MODEL_DIR);
  assert.equal(findModelPath(), path.join(MODEL_DIR, "zawgyiUnicodeModel.dat"));
  assert.ok(isFile(path.join(OCR_MODEL_DIR, "mya.traineddata")));
  assert.ok(ruleCount() > 100);
  assert.ok(loadSidecarMap().size > 0);
});

test("relocated output fonts resolve from Parsed/fonts/used", () => {
  assert.equal(path.relative(abs(PARSED_ROOT), OUTPUT_FONT_DIR), "fonts/used");
  assert.ok(isFile(findMyanmarFont()));
  assert.ok(isFile(findLatinFont()));
});

test("DOCX archive validation rejects extreme compression ratios", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "linga-docx-bomb-test-"));
  const file = path.join(dir, "bomb.docx");
  const writer = new ZipStreamWriter(file);
  try {
    await writer.writestr("[Content_Types].xml", "<Types/>");
    await writer.writestr("word/document.xml", "a".repeat(1024 * 1024));
    await writer.close();
    const bytes = await fsp.readFile(file);
    assert.throws(() => validateDocxArchive(bytes), /compression-ratio cap/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("manager parses the shipped 100-page PDF through a worker", async () => {
  const outputDir = await fsp.mkdtemp(path.join(os.tmpdir(), "linga-parser-test-"));
  const manager = new Manager({ outputDir });
  try {
    const result = await manager.dispatch({
      job: "extracting",
      method: "default",
      output: "txt",
      inputKind: "pdf",
      inPath: abs("frontend/frontend-bootstrap/public/samples/sample.pdf"),
      filename: "sample.pdf",
    });
    assert.equal(result.pages, 100);
    assert.ok(result.textChars > 80_000);
    assert.equal(result.counts.ZAWGYI, 100);
    assert.ok((await fsp.readFile(result.file, "utf8")).includes("Chapter"));
  } finally {
    await manager.close();
    await fsp.rm(outputDir, { recursive: true, force: true });
  }
});
