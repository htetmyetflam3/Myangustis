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
} from "../../../F.Site/Backend/file/paths.js";
import {
  MAP_DIR,
  MODEL_DIR,
  OCR_MODEL_DIR,
  OUTPUT_FONT_DIR,
  findLatinFont,
  findModelPath,
  findMyanmarFont,
} from "../../../D.Parser/main/parser/core/paths.js";
import { ruleCount } from "../../../D.Parser/main/parser/text/rabbit.js";
import { loadSidecarMap } from "../../../D.Parser/main/parser/read/pdf-extract.js";
import { Manager } from "../../../D.Parser/main/parser/manager.js";
import { ZipStreamWriter } from "../../../D.Parser/main/parser/core/zip.js";
import { validateDocxArchive } from "../../../D.Parser/main/parser/read/docx-extract.js";

const isFile = (file) => fs.statSync(file).isFile();

test("relocated parser has every boot-critical sidecar", () => {
  const files = validatePraserAssets();
  assert.ok(files.length >= 10);
  assert.ok(files.every(isFile));
  // Constant paths point into the D.Parser tree (restructured layout).
  assert.ok(PARSED_ROOT.endsWith("D.Parser/main"), `PARSED_ROOT=${PARSED_ROOT}`);
  assert.ok(PARSER_DIR.endsWith("D.Parser/main/parser"), `PARSER_DIR=${PARSER_DIR}`);
  assert.ok(PRASER_JS.endsWith("D.Parser/main/parser/manager.js"), `PRASER_JS=${PRASER_JS}`);
});

test("parser maps and models resolve outside the executable module directory", () => {
  assert.equal(path.basename(MAP_DIR), "jason-map");
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
      inPath: abs("Frontend/frontend-bootstrap/public/samples/sample.pdf"),
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
