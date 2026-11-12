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
} from "../../B.Parser/public/Backend/file/paths.js";
import {
  MAP_DIR,
  DEFAULT_OUTPUT_DIR,
  MODEL_DIR,
  OCR_MODEL_DIR,
  OUTPUT_FONT_DIR,
  findLatinFont,
  findMyanmarFont,
} from "../../B.Parser/_path.js";
import { ZipStreamWriter } from "../../B.Parser/architecture/@core/docx/zip.js";
import { validateDocxArchive } from "../../B.Parser/architecture/@core/docx/docx-extract.js";
import { loadSidecarMap } from "../../B.Parser/architecture/@core/pdf/method/pdfencoding/decoding.js";
import { isZawgyiOneFont, isUnicodeFont } from "../../B.Parser/architecture/@rule/detect.js";

const isFile = (file) => fs.statSync(file).isFile();
const repo = fileURLToPath(new URL("../../", import.meta.url));
// qpdf is the preparation step for every PDF; a bundled WASM CLI is an
// available runner even though it is invoked in-process, not as a shell bin.
const hasQpdf = async () => {
  try {
    const { qpdfRunner } = await import("../../B.Parser/architecture/@init/pdf/helper/decrypt.js");
    const { bin, args } = qpdfRunner();
    if (bin === "qpdf-wasm") return true;
    execFileSync(bin, [...args, "--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

test("the flattened Parser layout has every boot-critical sidecar", () => {
  const files = validatePraserAssets();
  assert.ok(files.length >= 10);
  assert.ok(files.every(isFile));

  // PARSED_ROOT is relative to the Site root (B.Parser/host) and names the
  // component root; PARSER_DIR is its alias, PRASER_JS the chain door.
  assert.equal(abs(PARSED_ROOT), path.resolve(repo, "B.Parser"));
  assert.equal(PARSER_DIR, PARSED_ROOT);
  assert.equal(abs(PRASER_JS), path.resolve(repo, "B.Parser/index.js"));
});

test("parser maps and models resolve outside the executable module directory", () => {
  assert.equal(path.basename(MAP_DIR), "@jason-map");
  assert.equal(path.basename(MODEL_DIR), "model");
  assert.equal(OCR_MODEL_DIR, MODEL_DIR);
  assert.ok(isFile(path.join(OCR_MODEL_DIR, "mya.traineddata")));
  assert.ok(loadSidecarMap().size > 0);
  assert.equal(isZawgyiOneFont("Zawgyi-One"), true);
  assert.equal(isUnicodeFont("Myanmar3"), true);
  assert.equal(isZawgyiOneFont("Myanmar3"), false);
});

test("relocated output fonts resolve from shared Junk/fonts/used", () => {
  assert.equal(OUTPUT_FONT_DIR, path.resolve(repo, "Junk/fonts/used"));
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

test("the shipped 100-page sample parses through the Parser door", async (t) => {
  if (!(await hasQpdf())) return t.skip("no qpdf runner available");
  const { InitInput, parseDecoding } = await import("../../B.Parser/index.js");
  const sample = path.join(repo, "B.Parser/public/Frontend/frontend-bootstrap/public/samples/sample.pdf");
  const prepared = await InitInput({ path: sample }, "owner");
  const parsed = await parseDecoding({ kind: prepared.kind, source: prepared.path, filename: "sample.pdf" });
  assert.equal(parsed.pages.length, 100);
  assert.equal(parsed.counts.ZAWGYI, 100);
  // One marked-up string per page (not a record object).
  const text = parsed.pages.join("\n");
  assert.ok(text.length > 70_000, `only ${text.length} characters`);
  assert.match(text, /သတ်ဖြတ်သူ/u);
  assert.match(text, /God of Slaughter/u);
});

test("the default output directory sits under the parser workspace", () => {
  assert.ok(DEFAULT_OUTPUT_DIR.endsWith(".output"), `DEFAULT_OUTPUT_DIR=${DEFAULT_OUTPUT_DIR}`);
  assert.ok(fs.existsSync(DEFAULT_OUTPUT_DIR));
});
