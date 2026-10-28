import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  abs,
  PARSED_ROOT,
  PARSER_DIR,
  PRASER_JS,
  validatePraserAssets,
} from "../../../F.Site/Backend/file/paths.js";
import {
  MAP_DIR,
  DEFAULT_OUTPUT_DIR,
  MODEL_DIR,
  OCR_MODEL_DIR,
  OUTPUT_FONT_DIR,
  findLatinFont,
  findModelPath,
  findMyanmarFont,
} from "../../../B.Parser/_path.js";
import { ruleCount } from "../../../B.Parser/main/parser/text/rabbit.js";
import { loadSidecarMap } from "../../../B.Parser/main/parser/read/pdf-extract.js";
import { Manager } from "../../../B.Parser/main/parser/manager.js";
import { writeDocxPlain } from "../../../B.Parser/main/parser/index.js";
import { ZipStreamWriter } from "../../../B.Parser/main/parser/core/zip.js";
import { validateDocxArchive } from "../../../B.Parser/main/parser/read/docx-extract.js";

const isFile = (file) => fs.statSync(file).isFile();
const repo = fileURLToPath(new URL("../../../", import.meta.url));

test("relocated parser has every boot-critical sidecar", () => {
  const files = validatePraserAssets();
  assert.ok(files.length >= 10);
  assert.ok(files.every(isFile));

  assert.ok(PARSED_ROOT.endsWith("B.Parser/main"), `PARSED_ROOT=${PARSED_ROOT}`);
  assert.ok(PARSER_DIR.endsWith("B.Parser/main/parser"), `PARSER_DIR=${PARSER_DIR}`);
  assert.ok(PRASER_JS.endsWith("B.Parser/main/parser/manager.js"), `PRASER_JS=${PRASER_JS}`);
});

test("scraper parser bridge resolves the current parser entry", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "parser-bridge-"));
  try {
    const result = path.join(dir, "result.json");
    const missing = path.join(dir, "missing.pdf");
    execFileSync(process.execPath, [path.join(repo, "B.Parser/extend/parse-bridge.js"), "--out", result, missing], { stdio: "pipe" });
    const verdict = JSON.parse(await fsp.readFile(result, "utf8"));
    assert.equal(verdict[0].category, "error");
    assert.match(verdict[0].reason, /ENOENT/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test("scraper OCR worker points to existing parser modules", () => {
  const worker = path.join(repo, "E.Scraper/main/deploy/continuous-ocr/worker.js");
  const code = fs.readFileSync(worker, "utf8");
  const imports = [...code.matchAll(/from '([^']*\.Parser\/[^']+)'/g)];
  assert.ok(imports.length > 0);
  for (const [, file] of imports) assert.ok(isFile(path.resolve(path.dirname(worker), file)));
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

test("relocated output fonts resolve from shared Junk/fonts/used", () => {
  assert.equal(OUTPUT_FONT_DIR, path.resolve(abs("../Junk/fonts/used")));
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


test("manager writes its default output under the parser workspace", async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "parser-default-output-"));
  const manager = new Manager();
  let output;
  try {
    const input = path.join(dir, "input.docx");
    await writeDocxPlain(input, "မြန်မာစာ စမ်းသပ်ချက်");
    const result = await manager.dispatch({
      job: "extracting", method: "default", output: "txt", inputKind: "docx",
      inPath: input, filename: "input.docx",
    });
    output = result.file;
    assert.equal(path.dirname(output), DEFAULT_OUTPUT_DIR);
    assert.match(await fsp.readFile(output, "utf8"), /မြန်မာစာ/);
  } finally {
    await manager.close();
    if (output) await fsp.unlink(output).catch(() => {});
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
