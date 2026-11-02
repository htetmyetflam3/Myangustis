import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import * as fontkit from "fontkit";
import { Document, ImageRun, Packer, Paragraph } from "docx";
import {
  PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream,
} from "pdf-lib";

import { streamPdfPages, processPageRecord, collectPdfResult, buildFinalPages, loadDetector } from "../../../B.Parser/extend/pipeline.js";
import { runQpdfFile } from "../../../B.Parser/main/parser/core/qpdf.js";
import { findPdfEnd, copyPdfPrefix } from "../../../B.Parser/main/parser/read/pdf-tail.js";
import { PdfScannedObjects } from "../../../B.Parser/main/parser/read/pdf-object-file.js";
import { runPdfStream } from "../../../B.Parser/main/parser/worker/pdf-stream.js";
import { finishManualPdf } from "../../../B.Parser/main/parser/worker/manual-pdf.js";
import { finishManualDocx } from "../../../B.Parser/main/parser/worker/manual-docx.js";
import { PdfTextSink } from "../../../B.Parser/main/parser/write/pdf-text-sink.js";
import { PageStoreWriter } from "../../../B.Parser/main/parser/read/page-store.js";
import { writeOutput } from "../../../B.Parser/main/parser/write/emit.js";
import { openZipBuffer, readEntry } from "../../../B.Parser/main/parser/core/zip.js";
import { pageLayoutLines, textLines } from "../../../B.Parser/main/parser/text/page-file-decision.js";
import { extractDocxParagraphs } from "../../../B.Parser/main/parser/read/docx-extract.js";
import { Rabbit, createRabbitStream } from "../../../B.Parser/main/parser/text/rabbit.js";
import { Manager } from "../../../B.Parser/main/parser/manager.js";
import { createSourceRunner } from "../../../B.Parser/main/parser/worker/runtime.js";
import { getEngineNormalize } from "../../../B.Parser/_path.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "parser-file-test-"));

function docxDocument(file) {
  const data = fs.readFileSync(file);
  return readEntry(data, openZipBuffer(data).get("word/document.xml")).toString("utf8");
}

async function canonicalPdf(file, directory, name) {
  const target = path.join(directory, `${name}.qdf.pdf`);
  await runQpdfFile(file, target, ["--qdf", "--object-streams=disable", "--deterministic-id"]);
  return fs.readFileSync(target, "latin1")
    .replace(/\/ID\s*\[.*?\]/gsu, "/ID []")
    .replace(/startxref\s+\d+/gu, "startxref N");
}

async function makePdf() {
  let document = await PDFDocument.create();
  const page1 = document.addPage([400, 500]);
  page1.drawText("English text across streams", { x: 30, y: 440 });
  const page2 = document.addPage([400, 500]);
  page2.drawText("Late checkpoint text", { x: 30, y: 440 });
  const image = await document.embedPng(png);
  const page3 = document.addPage([400, 500]);
  page3.drawImage(image, { x: 5, y: 5, width: 390, height: 490 });
  page3.drawText("Footer", { x: 10, y: 2, size: 8 });
  document.addPage([400, 500]);
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));

  for (const index of [0, 1]) {
    const page = document.getPage(index);
    const list = document.context.lookup(page.node.get(PDFName.of("Contents")));
    assert.ok(list instanceof PDFArray);
    const stream = document.context.lookup(list.asArray()[0]);
    assert.ok(stream instanceof PDFRawStream);
    let decoded = Buffer.from(decodePDFRawStream(stream).decode());
    if (index === 1) decoded = Buffer.concat([Buffer.from(`%${"x".repeat(2050)}\n`), decoded]);
    const split = index === 0 ? Math.floor(decoded.length / 2) : decoded.length;
    const refs = [decoded.subarray(0, split), decoded.subarray(split)]
      .filter((part) => part.length)
      .map((part) => document.context.register(document.context.stream(part)));
    page.node.set(PDFName.of("Contents"), document.context.obj(refs));
  }
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

test("streamed PDF output writes actual POS unknown contexts with source page numbers", async () => {
  const dir = scratch();
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = path.join(dir, "register.log");
  const manager = new Manager({ outputDir: dir });
  try {
    const document = await PDFDocument.create();
    document.registerFontkit(fontkit);
    const fontPath = new URL("../../../Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF", import.meta.url);
    const font = await document.embedFont(fs.readFileSync(fontPath), { subset: false });
    const lines = ["ကောင်းကင် စမ်းသပ် ကိ မြန်မာ စာ။", "ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ။"];
    for (const line of lines) document.addPage([500, 500]).drawText(line, { font, x: 30, y: 440, size: 16 });
    const input = path.join(dir, "source.pdf");
    fs.writeFileSync(input, await document.save({ useObjectStreams: false }));
    const result = await manager.dispatchStream(fs.createReadStream(input, { highWaterMark: 71 }), {
      filename: "source.pdf", output: "pdf", outPath: path.join(dir, "converted.pdf"), sourceEncoding: "unicode",
    });
    assert.equal(result.pages, 2);
    assert.equal(result.posScan.unknownCount, 3);
    assert.equal(result.posScan.contextCount, 2);
    assert.match(fs.readFileSync(result.file).subarray(0, 5).toString("ascii"), /%PDF-/u);
    const report = fs.readFileSync(result.posScan.file, "utf8");
    assert.match(report, /Page 1, line 1\nOriginal: ကောင်းကင် စမ်းသပ် ကိ မြန်မာ စာ။\nContext: ကောင်းကင်\{n\}  စမ်းသပ်\{v\}  ကိ\{\?\}  မြန်မာ\{n\}/u);
    assert.match(report, /Page 2, line 1[\s\S]*ဤ\{pn\}  စာ\{n,p\}  ကိ\{\?\}  ဃု\{\?\}  ကောင်းကင်\{n\}  မြန်မာ\{n\}/u);
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("PDF output uses Engine normalize after parsing across jobs, methods and formats", async () => {
  const dir = scratch();
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = path.join(dir, "register.log");
  const manager = new Manager({ outputDir: dir });
  try {
    const source = "စဥ် ကိ";
    const normalize = await getEngineNormalize();
    const expected = normalize(source);
    assert.equal(expected, "စဉ် ကိ");
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const fontPath = new URL("../../../Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF", import.meta.url);
    const font = await pdf.embedFont(fs.readFileSync(fontPath), { subset: false });
    pdf.addPage([400, 400]).drawText(source, { font, x: 20, y: 300 });
    const bytes = await pdf.save({ useObjectStreams: false });
    const [, , parsed] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
    assert.equal(parsed.next().value.text, source);
    const input = path.join(dir, "input.pdf");
    fs.writeFileSync(input, bytes);
    for (const [job, method] of [["extracting", "default"], ["extracting", "manual"], ["null", "default"], ["null", "manual"]]) {
      for (const extension of ["txt", "docx", "pdf"]) {
        const result = await manager.dispatch({
          job, method, output: extension, inputKind: "pdf", filename: "input.pdf",
          inPath: input, outPath: path.join(dir, `${job}-${method}.${extension}`),
          includeText: true, sourceEncoding: "unicode",
        });
        assert.equal(result.text, expected, `${job}/${method}/${extension}`);
        const report = fs.readFileSync(result.posScan.file, "utf8");
        assert.ok(report.includes(`Original: ${expected}`), `${job}/${method}/${extension} POS source`);
        if (extension === "docx") assert.ok(docxDocument(result.file).includes(expected));
      }
    }
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DOCX scanning uses explicit source markers rather than paragraph-chunk page numbers", async () => {
  const dir = scratch();
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = path.join(dir, "register.log");
  const manager = new Manager({ outputDir: dir });
  try {
    const doc = new Document({ sections: [{ children: [
      new Paragraph("Page-12"),
      new Paragraph("ကောင်းကင် စမ်းသပ် ကိ မြန်မာ စာ။"),
      new Paragraph("Page-13"),
      new Paragraph("ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ။"),
    ] }] });
    const input = path.join(dir, "source.docx");
    fs.writeFileSync(input, await Packer.toBuffer(doc));
    const result = await manager.dispatchStream(fs.createReadStream(input, { highWaterMark: 73 }), {
      filename: "source.docx", output: "txt", outPath: path.join(dir, "converted.txt"), sourceEncoding: "unicode",
    });
    assert.equal(result.posScan.unknownCount, 3);
    const report = fs.readFileSync(result.posScan.file, "utf8");
    assert.match(report, /Page 12, line 1\nOriginal: ကောင်းကင် စမ်းသပ် ကိ မြန်မာ စာ။/u);
    assert.match(report, /Page 13, line 1\nOriginal: ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ။/u);
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DOCX output normalizes after parsing across jobs, methods and formats", async () => {
  const dir = scratch();
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = path.join(dir, "register.log");
  const manager = new Manager({ outputDir: dir });
  try {
    const source = "စဥ် ကိ";
    const doc = new Document({ sections: [{ children: [new Paragraph(source)] }] });
    const input = path.join(dir, "input.docx");
    fs.writeFileSync(input, await Packer.toBuffer(doc));
    const run = createSourceRunner({ kind: "docx", method: "manual" });
    const parsed = await run({ filename: "input.docx", inPath: input, sourceEncoding: "unicode" });
    const raw = parsed.result.reports[0].base;
    assert.ok(raw.startsWith(source));
    const normalize = await getEngineNormalize();
    const expected = raw.split("\n").map(normalize).join("\n");
    assert.ok(expected.startsWith("စဉ် ကိ"));
    for (const [job, method] of [
      ["extracting", "default"], ["extracting", "manual"], ["extracting", "null"], ["null", "default"], ["null", "null"],
    ]) {
      for (const extension of ["txt", "docx", "pdf"]) {
        const result = await manager.dispatch({
          job, method, output: extension, inputKind: "docx", filename: "input.docx", inPath: input,
          outPath: path.join(dir, `${job}-${method}.${extension}`), sourceEncoding: "unicode",
          applyCleanup: false, includeText: true,
        });
        assert.equal(result.text, expected, `${job}/${method}/${extension}`);
        assert.ok(fs.readFileSync(result.posScan.file, "utf8").includes("Original: စဉ် ကိ"));
      }
    }
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DOCX final normalization uses the Engine result", async () => {
  const dir = scratch();
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = path.join(dir, "register.log");
  const manager = new Manager({ outputDir: dir });
  try {
    const source = "\u200b\u200c\u200d\u034fစဥ်";
    const normalize = await getEngineNormalize();
    const doc = new Document({ sections: [{ children: [new Paragraph(source)] }] });
    const input = path.join(dir, "input.docx");
    fs.writeFileSync(input, await Packer.toBuffer(doc));
    for (const applyCleanup of [false, true]) {
      const result = await manager.dispatch({
        job: "extracting", method: "manual", output: "txt", inputKind: "docx", filename: "input.docx",
        inPath: input, outPath: path.join(dir, `output-${applyCleanup}.txt`), sourceEncoding: "unicode",
        applyCleanup, includeText: true,
      });
      assert.equal(result.text.replace(/\n+$/u, ""), normalize(source));
    }
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function makeAsciiHexPdf() {
  let document = await PDFDocument.create();
  document.addPage([200, 200]).drawText("ASCII filter fallback", { x: 20, y: 150 });
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const page = document.getPage(0);
  const list = document.context.lookup(page.node.get(PDFName.of("Contents")));
  const stream = document.context.lookup(list.asArray()[0]);
  const decoded = Buffer.from(decodePDFRawStream(stream).decode());
  const hex = Buffer.from(`${decoded.toString("hex")}>`, "ascii");
  const ref = document.context.register(document.context.stream(hex, { Filter: PDFName.of("ASCIIHexDecode") }));
  page.node.set(PDFName.of("Contents"), ref);
  return Buffer.from(await document.save({ useObjectStreams: false }));
}

function textOf(filePage) { return [...filePage.text.chunks()].join(""); }

function referenceReports(bytes, sourceEncoding = "auto") {
  const detector = loadDetector();
  const [, count, pages] = streamPdfPages(bytes, detector, () => {}, { sourceEncoding });
  function* reports() {
    for (const page of pages) yield processPageRecord(page, detector, false, () => {}, true, sourceEncoding);
  }
  return [count, reports()];
}

async function* indexRecords(file) {
  for (const line of fs.readFileSync(file, "utf8").trimEnd().split("\n")) if (line) yield JSON.parse(line);
}

test("file pages preserve checkpoint, commands, image geometry and page decisions", async () => {
  const dir = scratch();
  try {
    const original = await makePdf();
    const input = path.join(dir, "original.pdf");
    const prepared = path.join(dir, "prepared.pdf");
    fs.writeFileSync(input, original);
    await runQpdfFile(input, prepared, ["--object-streams=disable", "--stream-data=preserve"]);
    const checkpoints = [[], []];
    const [oldMeta, oldCount, oldPages] = streamPdfPages(original, null, () => {}, {
      onPagePrefix: (...args) => checkpoints[0].push(args),
    });
    const [newMeta, newCount, newPages] = streamPdfPages(prepared, null, () => {}, {
      diskPages: true, onPagePrefix: (...args) => checkpoints[1].push(args),
    });
    assert.deepEqual(newMeta, oldMeta);
    assert.equal(newCount, oldCount);
    let lateWarning = false;
    let imageSeen = false;
    try {
      for (let index = 0; index < oldCount; index += 1) {
        const oldPage = oldPages.next().value;
        const newPage = newPages.next().value;
        assert.equal(textOf(newPage), oldPage.text, `page ${index + 1} text`);
        const { text: oldText, lines: oldLines, ...oldOther } = oldPage;
        const { text: newText, lines: newLines, ...newOther } = newPage;
        assert.deepEqual(newOther, oldOther, `page ${index + 1} metadata`);
        lateWarning ||= oldPage.warnings?.some((warning) => warning.code === "text-after-checkpoint") ?? false;
        imageSeen ||= oldPage.images.some((entry) => entry.pageSized);
      }
      assert.deepEqual(checkpoints[1], checkpoints[0]);
      assert.ok(checkpoints[1].every((entry) => entry[1].length <= 2048));
      assert.equal(lateWarning, true);
      assert.equal(imageSeen, true);
    } finally {
      oldPages.return();
      newPages.return();
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a page-number checkpoint retains later Zawgyi text on the shared route", async () => {
  let document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fontPath = new URL("../../../Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF", import.meta.url);
  const font = await document.embedFont(fs.readFileSync(fontPath), { subset: false });
  const page = document.addPage([400, 500]);
  page.drawText("2", { x: 30, y: 460 });
  page.drawText("နဂါးခေါင္းဗ်ပ္ေစာင္း", { font, x: 30, y: 420 });
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  for (const [, ref] of fonts.entries()) {
    const resource = document.context.lookup(ref);
    if (String(resource.get(PDFName.of("BaseFont"))).includes("Zawgyi-One")) {
      resource.set(PDFName.of("BaseFont"), PDFName.of("Zawgyi-One"));
    }
  }
  const list = document.context.lookup(savedPage.node.get(PDFName.of("Contents")));
  const stream = document.context.lookup(list.asArray()[0]);
  const content = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  const boundary = content.indexOf("ET\n") + 3;
  assert.ok(boundary >= 3 && boundary < 2048);
  const delayed = `${content.slice(0, boundary)}%${"x".repeat(2050)}\n${content.slice(boundary)}`;
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(delayed)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const checkpoints = [];
  const [, count, pages] = streamPdfPages(bytes, null, () => {}, {
    onPagePrefix: (...args) => checkpoints.push(args),
  });
  try {
    const parsed = pages.next().value;
    assert.equal(count, 1);
    assert.equal(checkpoints[0][1].length, 2048);
    assert.equal(checkpoints[0][2], "zawgyi-one");
    assert.equal(checkpoints[0][3].reason, "page-number-only");
    assert.equal(parsed.parsingPath, "zawgyi-one");
    assert.ok(parsed.text.includes("နဂါးခေါင်းဗျပ်စောင်း"), `${parsed.decision}: ${[...parsed.fontKinds]}: ${[...parsed.fontNames]}: ${parsed.text}`);
  } finally { pages.return?.(); }
});

test("a later Zawgyi resource on a legacy page is retained and reported", async () => {
  let document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const fontPath = new URL("../../../Junk/fonts/zawgyi one/ZAWGYI-ONE_V3.1.TTF", import.meta.url);
  const font = await document.embedFont(fs.readFileSync(fontPath), { subset: false });
  const page = document.addPage([400, 500]);
  page.drawText("B", { x: 30, y: 460 });
  page.drawText("နဂါးခေါင္းဗ်ပ္ေစာင္း", { font, x: 30, y: 420 });
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  for (const [, ref] of fonts.entries()) {
    const resource = document.context.lookup(ref);
    if (String(resource.get(PDFName.of("BaseFont"))).includes("Zawgyi-One")) {
      resource.set(PDFName.of("BaseFont"), PDFName.of("Zawgyi-One"));
    }
  }
  const list = document.context.lookup(savedPage.node.get(PDFName.of("Contents")));
  const stream = document.context.lookup(list.asArray()[0]);
  const content = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
  const boundary = content.indexOf("ET\n") + 3;
  assert.ok(boundary >= 3 && boundary < 2048);
  const delayed = `${content.slice(0, boundary)}%${"x".repeat(2050)}\n${content.slice(boundary)}`;
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(delayed)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {});
  try {
    const parsed = pages.next().value;
    assert.equal(parsed.parsingPath, "legacy");
    assert.equal(parsed.category, "UNKNOWN");
    assert.ok(parsed.text.includes("နဂါးခေါင္းဗ်ပ္ေစာင္း"), parsed.text);
    assert.ok(parsed.warnings.some((warning) => warning.code === "zawgyi-font-on-legacy-page"));
  } finally { pages.return?.(); }
});

test("simple-font ToUnicode entries padded to two bytes decode on the shared page route", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const mapping = "1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n"
    + "2 beginbfchar\n<0001> <1000>\n<0002> <1001>\nendbfchar\n";
  const simpleFont = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("Helvetica"),
    ToUnicode: document.context.register(document.context.stream(mapping)),
  });
  fonts.set(PDFName.of("Padded"), document.context.register(simpleFont));
  const commands = "BT /Padded 12 Tf 1 0 0 1 20 420 Tm <0102> Tj ET";
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try {
    const parsed = pages.next().value;
    assert.equal(parsed.parsingPath, "zawgyi-one");
    assert.equal(parsed.text, "ကခ");
  } finally { pages.return?.(); }
});

test("selected keyboard slots are read through Differences without converting another font's URL", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const englishFont = String(fonts.keys()[0]);
  const names = ["t", "c", "s", "d", "e", "f", "u", "k", "space", "K", "semicolon", "ampersand",
    "S", "p", "D", "r", "H", "y", "n", "two", "six", "o", "G", "comma", "M", "i"];
  const keyboardFont = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("Helvetica"),
    Encoding: { Type: PDFName.of("Encoding"), BaseEncoding: PDFName.of("WinAnsiEncoding"),
      Differences: [1, ...names.map((name) => PDFName.of(name))] },
  });
  fonts.set(PDFName.of("Keyboard"), document.context.register(keyboardFont));
  const namedEnglishFont = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("WinYadanapon"),
    Encoding: PDFName.of("WinAnsiEncoding"),
  });
  fonts.set(PDFName.of("NamedEnglish"), document.context.register(namedEnglishFont));
  const namedWordFont = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("WinYadanapon"),
    Encoding: PDFName.of("WinAnsiEncoding"),
  });
  fonts.set(PDFName.of("NamedWord"), document.context.register(namedWordFont));
  const raw = "010203040506070408090107030a040b0c0d040c0d04090e0f10110108120602030a12060513060b0914141509161718060919071306101a060b09";
  const commands = `BT ${englishFont} 12 Tf 1 0 0 1 20 460 Tm (example.com) Tj ET\n`
    + "BT /NamedEnglish 12 Tf 1 0 0 1 20 440 Tm (example.org) Tj ET\n"
    + "BT /NamedWord 12 Tf 1 0 0 1 20 430 Tm (bookkeeper) Tj ET\n"
    + `BT /Keyboard 12 Tf 1 0 0 1 20 420 Tm <${raw}> Tj ET`;
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {});
  try {
    const parsed = pages.next().value;
    assert.equal(parsed.parsingPath, "legacy");
    assert.ok(parsed.text.includes("example.com"), parsed.text);
    assert.ok(parsed.text.includes("example.org"), parsed.text);
    assert.ok(parsed.text.includes("bookkeeper"), parsed.text);
    assert.ok(parsed.text.includes("အချိန်ကို"), parsed.text);
    assert.ok(parsed.text.includes("စီမံအုပ်ချုပ်နည်း"), parsed.text);
  } finally { pages.return?.(); }
});

test("legacy keyboard evidence on an unrelated face preserves English headings", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const englishFont = String(fonts.keys()[0]);
  const keyboardFont = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("Pinny9"),
    Encoding: PDFName.of("WinAnsiEncoding"),
  });
  fonts.set(PDFName.of("Keyboard"), document.context.register(keyboardFont));
  const raw = "b0rSmtcuftcJqHk;tcdkuftwefhrsm;rS q&matmifudkOD;ESifhawGYqHkjcif;";
  const commands = `BT ${englishFont} 12 Tf 1 0 0 1 20 460 Tm (INTERVIEW) Tj ET\n`
    + `BT /Keyboard 12 Tf 1 0 0 1 20 420 Tm (${raw}) Tj ET`;
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {});
  try {
    const parsed = pages.next().value;
    assert.equal(parsed.parsingPath, "legacy");
    assert.ok(parsed.text.includes("INTERVIEW"), parsed.text);
    assert.ok(parsed.text.includes("ဘဝမှာအခက်အခဲ"), parsed.text);
    assert.ok(parsed.text.includes("ဆရာအောင်ကိုဦး"), parsed.text);
  } finally { pages.return?.(); }
});

test("an overprinted legacy title does not hide the later body from its keyboard layout", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const legacyFont = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("WinInnwa"),
    Encoding: PDFName.of("WinAnsiEncoding"),
  });
  fonts.set(PDFName.of("Legacy"), document.context.register(legacyFont));
  const commands = "BT /Legacy 12 Tf 1 0 0 1 20 460 Tm (ooopppfffwwwpppfffyyyiiifffaaauuum) Tj ET\n"
    + `%${"x".repeat(2050)}\n`
    + "BT /Legacy 12 Tf 1 0 0 1 20 420 Tm (vdyfusqdkwm jyifOD;vGifem;u) Tj ET";
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {});
  try {
    const parsed = pages.next().value;
    assert.equal(parsed.parsingPath, "legacy");
    assert.ok(parsed.text.includes("လိပ်ကျဆိုတာ"), parsed.text);
    assert.ok(parsed.text.includes("ပြင်ဦးလွင်နားက"), parsed.text);
  } finally { pages.return?.(); }
});

test("a centered alphabetic footer alone is not legacy body evidence", async () => {
  const input = async (x, y, label = "B") => {
    let document = await PDFDocument.create();
    const page = document.addPage([400, 500]);
    page.drawText("seed");
    document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
    const savedPage = document.getPage(0);
    const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
    const font = String(fonts.keys()[0]);
    const commands = [
      `BT ${font} 12 Tf 1 0 0 1 ${x} ${y} Tm (${label}) Tj ET`,
      `%${"x".repeat(2050)}`,
      `BT ${font} 12 Tf 1 0 0 1 30 420 Tm (later text) Tj ET`,
    ].join("\n");
    savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
    return Buffer.from(await document.save({ useObjectStreams: false }));
  };
  for (const [x, y, label, expected] of [
    [200, 20, "B", "page-letter-only"],
    [200, 250, "B", "not-english"],
    [20, 20, "B", "not-english"],
    [200, 20, "BB", "not-english"],
    [200, 20, "b", "not-english"],
  ]) {
    const [, , pages] = streamPdfPages(await input(x, y, label), null, () => {});
    try {
      const parsed = pages.next().value;
      assert.equal(parsed.checkpoint.reason, expected, `${label} at ${x},${y}`);
      assert.ok(parsed.text.includes("later text"), "text after the checkpoint is retained");
    } finally { pages.return?.(); }
  }
});

test("saved graphics state restores the font, size and leading for later text", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const font = String(fonts.keys()[0]);
  const variant = document.context.obj({
    Type: PDFName.of("Font"), Subtype: PDFName.of("Type1"), BaseFont: PDFName.of("Helvetica"),
    Encoding: { Type: PDFName.of("Encoding"), BaseEncoding: PDFName.of("WinAnsiEncoding"),
      Differences: [65, PDFName.of("B")] },
  });
  fonts.set(PDFName.of("Variant"), document.context.register(variant));
  const commands = [
    `BT ${font} 12 Tf 20 TL 1 0 0 1 30 470 Tm (A) Tj ET`,
    "q BT /Variant 18 Tf 30 TL 1 0 0 1 30 440 Tm (A) Tj ET Q",
    "BT 1 0 0 1 30 410 Tm (A) Tj T* (A) Tj ET",
  ].join("\n");
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try {
    const parsed = pages.next().value;
    assert.deepEqual(parsed.text.split("\n"), ["A", "B", "A", "A"]);
    assert.deepEqual(parsed.lines.map(([x, y, size]) => [x, y, size]), [
      [30, 470, 12], [30, 440, 18], [30, 410, 12], [30, 390, 12],
    ]);
  } finally { pages.return?.(); }
});

test("one PDF text object preserves separate baselines and text-matrix scaling", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([400, 500]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const font = String(fonts.keys()[0]);
  const commands = [
    "q 1 0 0 1 40 70 cm BT", `${font} 1 Tf 2 TL`,
    "12 0 0 12 10 10 Tm (one) Tj",
    "0 -1 Td (two) Tj 2 0 Td ( and) Tj",
    "0 -1 TD (three) Tj (four) ' 0 0 (five) \"",
    "ET Q",
  ].join("\n");
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands)));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try {
    const parsed = pages.next().value;
    assert.deepEqual(parsed.text.split("\n"), ["one", "two and", "three", "four", "five"]);
    assert.deepEqual(parsed.lines.map(([x, y, size]) => [x, y, size]), [
      [50, 80, 12], [50, 68, 12], [74, 56, 12], [74, 44, 12], [74, 32, 12],
    ]);
  } finally { pages.return?.(); }
});

test("a text-rich landscape spread reads the left page before the right", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([1000, 600]);
  const left = [];
  const right = [];
  for (let index = 0; index < 6; index += 1) {
    left.push(`Left page line number ${index + 1}`);
    right.push(`Right page line number ${index + 1}`);
    page.drawText(left[index], { x: 30, y: 550 - index * 30, size: 10 });
    page.drawText(right[index], { x: 530, y: 550 - index * 30, size: 10 });
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try { assert.deepEqual(pages.next().value.text.split("\n"), [...left, ...right]); }
  finally { pages.return?.(); }
});

test("a single text object can move between two spread halves on one baseline", async () => {
  let document = await PDFDocument.create();
  const page = document.addPage([1000, 600]);
  page.drawText("seed");
  document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
  const savedPage = document.getPage(0);
  const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
  const font = String(fonts.keys()[0]);
  const left = [];
  const right = [];
  const commands = [`BT ${font} 10 Tf`];
  for (let index = 0; index < 6; index += 1) {
    left.push(`Left page line number ${index + 1}`);
    right.push(`Right page line number ${index + 1}`);
    commands.push(`1 0 0 1 30 ${550 - index * 30} Tm (Left page ) Tj`);
    commands.push(`1 0 0 1 90 ${550 - index * 30} Tm (line number ${index + 1}) Tj`);
    commands.push(`1 0 0 1 530 ${550 - index * 30} Tm (Right page ) Tj`);
    commands.push(`1 0 0 1 590 ${550 - index * 30} Tm (line number ${index + 1}) Tj`);
  }
  commands.push("ET");
  savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands.join("\n"))));
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try { assert.deepEqual(pages.next().value.text.split("\n"), [...left, ...right]); }
  finally { pages.return?.(); }
});

test("spread and table detection respect a nonzero MediaBox origin", async () => {
  for (const ruled of [false, true]) {
    let document = await PDFDocument.create();
    const page = document.addPage([1000, 600]);
    page.setMediaBox(-100, -50, 1000, 600);
    page.drawText("seed");
    document = await PDFDocument.load(await document.save({ useObjectStreams: false }));
    const savedPage = document.getPage(0);
    const fonts = savedPage.node.Resources().lookup(PDFName.of("Font"));
    const font = String(fonts.keys()[0]);
    const commands = [];
    if (ruled) {
      for (const x of [-90, 80, 280, 480, 680, 880]) commands.push(`${x} 50 m ${x} 530 l S`);
    }
    const left = [];
    const right = [];
    commands.push(`BT ${font} 10 Tf`);
    for (let index = 0; index < 6; index += 1) {
      left.push(`Left page line number ${index + 1}`);
      right.push(`Right page line number ${index + 1}`);
      commands.push(`1 0 0 1 -70 ${500 - index * 30} Tm (${left[index]}) Tj`);
      commands.push(`1 0 0 1 430 ${500 - index * 30} Tm (${right[index]}) Tj`);
    }
    commands.push("ET");
    savedPage.node.set(PDFName.of("Contents"), document.context.register(document.context.stream(commands.join("\n"))));
    const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
    const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
    try {
      const text = pages.next().value.text;
      if (ruled) {
        assert.ok(text.indexOf(right[0]) < text.indexOf(left[1]), text);
      } else {
        assert.deepEqual(text.split("\n"), [...left, ...right]);
      }
    } finally { pages.return?.(); }
  }
});

test("a landscape page without two substantial halves keeps row order", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([1000, 600]);
  for (let index = 0; index < 6; index += 1) {
    page.drawText(`Left page line number ${index + 1}`, { x: 30, y: 550 - index * 30, size: 10 });
    if (index < 2) page.drawText(`Right short ${index + 1}`, { x: 530, y: 550 - index * 30, size: 10 });
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try {
    const text = pages.next().value.text;
    assert.ok(text.indexOf("Left page line number 1") < text.indexOf("Right short 1"), text);
    assert.ok(text.indexOf("Right short 1") < text.indexOf("Left page line number 2"), text);
    assert.ok(text.indexOf("Right short 2") < text.indexOf("Left page line number 3"), text);
  } finally { pages.return?.(); }
});

test("a ruled landscape table is not reordered as facing pages", async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([1000, 600]);
  for (const x of [20, 200, 400, 600, 800, 980]) {
    page.drawLine({ start: { x, y: 100 }, end: { x, y: 580 }, thickness: 1 });
  }
  for (let index = 0; index < 6; index += 1) {
    page.drawText(`Left table row number ${index + 1}`, { x: 30, y: 550 - index * 60, size: 10 });
    page.drawText(`Right table row number ${index + 1}`, { x: 630, y: 550 - index * 60, size: 10 });
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  const [, , pages] = streamPdfPages(bytes, null, () => {}, { sourceEncoding: "unicode" });
  try {
    const text = pages.next().value.text;
    assert.ok(text.indexOf("Left table row number 1") < text.indexOf("Right table row number 1"), text);
    assert.ok(text.indexOf("Right table row number 1") < text.indexOf("Left table row number 2"), text);
    assert.ok(text.indexOf("Right table row number 2") < text.indexOf("Left table row number 3"), text);
  } finally { pages.return?.(); }
});

test("file object scans preserve original boundaries across blocks and updates", () => {
  const dir = scratch();
  try {
    const header = "%PDF-1.4\n2 0 obj\nold\nendobj\n1 0 obj\n<< /Length 3 /Note (";
    const suffix = ") >>\n";
    const padding = "x".repeat(65536 - Buffer.byteLength(header + suffix) - 3);
    const beforeStream = header + padding + suffix;
    const bytes = Buffer.from(`${beforeStream}stream\r\nXYZ\nendstream\nendobj\n2 0 obj\nnew\nendobj\n`, "latin1");
    const file = path.join(dir, "objects.pdf");
    fs.writeFileSync(file, bytes);
    const objects = new PdfScannedObjects(file);
    try {
      assert.deepEqual([...objects.entries.keys()], ["2,0", "1,0"]);
      assert.equal(objects.get("2,0").toString("latin1"), "new");
      assert.equal(objects.get("1,0").toString("latin1"),
        `<< /Length 3 /Note (${padding}) >>\nstream\r\nXYZ\nendstream`);
      assert.equal(objects.dictionary("1,0").toString("latin1"), `<< /Length 3 /Note (${padding}) >>`);
      const range = objects.streamRange("1,0", 3);
      const content = Buffer.alloc(3);
      assert.equal(fs.readSync(range.fd, content, 0, 3, range.start), 3);
      assert.equal(content.toString("ascii"), "XYZ");
    } finally { objects.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("file-backed layout keeps the same coordinates and split-line rules", () => {
  const original = [[1, 2, 3, "first\ninside"], [4, 5, 6, "second"]];
  const store = { *lines() { yield* original; } };
  const fileText = (value) => ({ *chunks() { for (let i = 0; i < value.length; i += 3) yield value.slice(i, i + 3); } });
  assert.deepEqual([...pageLayoutLines(store, fileText("first\ninside\nsecond"), 2)], original);
  const replayable = { [Symbol.iterator]: () => pageLayoutLines(store, fileText("first\ninside\nsecond"), 2) };
  assert.deepEqual([...pageLayoutLines({ lines: () => replayable }, fileText("first\ninside\nsecond"), 2)], original);
  assert.deepEqual([...pageLayoutLines(store, fileText("changed\nsecond"), 2)], [
    [1, 2, 3, "changed"], [4, 5, 6, "second"],
  ]);
  assert.deepEqual([...pageLayoutLines(store, fileText("changed\nmore\nlines"), 2)], []);
  assert.deepEqual([...textLines(["a\n", "b", "\n"])], ["a", "b", ""]);
  assert.deepEqual([...textLines([])], [""]);
});

test("TXT sink exactly matches the existing writer for empty pages, Unicode and extensionless output", async () => {
  const dir = scratch();
  try {
    const pages = ["", "\n", "က😀\u200b", "  ", "one\ntwo"].map((text) => ({ text }));
    const counts = { ZAWGYI: 1, UNICODE: 2, UNKNOWN: 2 };
    const oldPath = path.join(dir, "old");
    const newPath = path.join(dir, "new");
    const old = await writeOutput(oldPath, pages, { counts, source: "", includeText: true });
    const work = path.join(dir, "sink");
    fs.mkdirSync(work);
    const sink = new PdfTextSink(work, { includeText: true });
    for (const page of pages) sink.addPage([page.text]);
    const result = sink.finish(newPath, counts, "");
    assert.equal(result.file, `${newPath}.txt`);
    assert.deepEqual(fs.readFileSync(result.file), fs.readFileSync(old.file));
    for (const key of ["lineCount", "textChars", "textBytes", "mimeType", "text"]) {
      assert.equal(result[key], old[key], key);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("Manager path-backed TXT matches direct page results", async () => {
  const dir = scratch();
  const manager = new Manager({ outputDir: dir });
  try {
    const bytes = await makePdf();
    const input = path.join(dir, "input.pdf");
    fs.writeFileSync(input, bytes);
    for (const sourceEncoding of ["auto", "unicode", "zawgyi-one"]) {
      const source = "input.pdf";
      const [count, reports] = referenceReports(bytes, sourceEncoding);
      const job = collectPdfResult(reports, count, source);
      const old = await writeOutput(path.join(dir, `old-${sourceEncoding}.txt`), buildFinalPages(job, true), {
        counts: job.counts, source, includeText: true,
      });
      const actual = await manager.dispatch({
        job: "extracting", method: "default", output: "txt", inputKind: "pdf", filename: source,
        inPath: input, outPath: path.join(dir, `new-${sourceEncoding}`), sourceEncoding, includeText: true,
      });
      assert.deepEqual(fs.readFileSync(actual.file), fs.readFileSync(old.file));
      for (const key of ["lineCount", "textChars", "textBytes", "mimeType", "text"]) {
        assert.equal(actual[key], old[key], `${sourceEncoding}: ${key}`);
      }
      assert.deepEqual(actual.counts, job.counts);
      assert.equal(actual.encodingPath, job.encodingPath ?? null);
      assert.deepEqual(actual.pageWarnings ?? [], job.pageWarnings ?? []);
    }
  } finally {
    await manager.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("binary Manager input preserves PDF-to-DOCX layout and PDF drawing commands", async () => {
  const dir = scratch();
  const previous = process.env.PRASER_REGISTER;
  process.env.PRASER_REGISTER = path.join(dir, "register.log");
  const manager = new Manager({ outputDir: dir });
  try {
    const bytes = await makePdf();
    const input = path.join(dir, "input.pdf");
    fs.writeFileSync(input, bytes);
    const [count, reports] = referenceReports(bytes);
    const job = collectPdfResult(reports, count, "input.pdf");
    for (const extension of ["docx", "pdf"]) {
      const expected = await writeOutput(path.join(dir, `expected.${extension}`), buildFinalPages(job, true), {
        counts: job.counts, source: "input.pdf", includeText: true,
      });
      const result = await manager.dispatchStream(fs.createReadStream(input, { highWaterMark: 23 }), {
        filename: "input.pdf", output: extension, outPath: path.join(dir, `streamed.${extension}`), includeText: true,
      });
      for (const key of ["lineCount", "textChars", "textBytes", "mimeType", "text"]) {
        assert.equal(result[key], expected[key], `${extension}: ${key}`);
      }
      assert.equal(result.pages, count);
      assert.deepEqual(result.counts, job.counts);
      assert.deepEqual(result.pageWarnings ?? [], job.pageWarnings ?? []);
      if (extension === "docx") {
        assert.equal(docxDocument(result.file), docxDocument(expected.file));
      } else {
        assert.equal(await canonicalPdf(result.file, dir, "actual"), await canonicalPdf(expected.file, dir, "reference"));
      }
    }
    assert.match(fs.readFileSync(process.env.PRASER_REGISTER, "utf8"), /input\.pdf/u);
  } finally {
    await manager.close();
    if (previous === undefined) delete process.env.PRASER_REGISTER;
    else process.env.PRASER_REGISTER = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Manager PDF streams and Scraper classification do not use whole-file PDF reads", async () => {
  const dir = scratch();
  try {
    const document = await PDFDocument.create();
    document.addPage().drawText("First page");
    document.addPage().drawText("Second page");
    const input = path.join(dir, "source.pdf");
    fs.writeFileSync(input, await document.save({ useObjectStreams: false }));
    const preload = path.join(dir, "guard.cjs");
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      function rejectPdf(p) {
        const name = typeof p === 'string' ? p : p && typeof p.href === 'string' ? p.href : '';
        if (/\\.pdf$/i.test(name)) {
          fs.appendFileSync(${JSON.stringify(path.join(dir, "whole-pdf-reads.log"))}, name + '\\n');
          throw new Error('whole-file PDF read attempted: ' + name);
        }
      }
      const sync = fs.readFileSync;
      const promise = fs.promises.readFile;
      fs.readFileSync = function(p, ...args) { rejectPdf(p); return sync.call(this, p, ...args); };
      fs.promises.readFile = function(p, ...args) { rejectPdf(p); return promise.call(this, p, ...args); };
    `);
    const driver = path.join(dir, "driver.cjs");
    const managerUrl = new URL("../../../B.Parser/main/parser/manager.js", import.meta.url).href;
    fs.writeFileSync(driver, `
      const fs = require('node:fs');
      const path = require('node:path');
      (async () => {
        const { Manager } = await import(${JSON.stringify(managerUrl)});
        const dir = ${JSON.stringify(dir)};
        const manager = new Manager({ outputDir: dir });
        try {
          for (const method of ['default', 'manual']) {
            for (const output of ['docx', 'pdf']) {
              const source = fs.createReadStream(path.join(dir, 'source.pdf'), { highWaterMark: 37 });
              const result = await manager.dispatchStream(source, {
                filename: 'source.pdf', method, output, outPath: path.join(dir, method + '.' + output),
              });
              if (result.pages !== 2 || !source.readableEnded) throw new Error('stream did not finish');
            }
          }
          const scraped = await manager.dispatch({
            inPath: path.join(dir, 'source.pdf'), inputKind: 'pdf', filename: 'source.pdf',
            job: 'extracting', method: 'default', output: 'txt', outPath: path.join(dir, 'scraper.txt'),
          }, 'scraper');
          if (scraped.pages !== 2 || scraped.skipped) throw new Error('Scraper did not process the source');
          console.log('four streamed jobs and Scraper classification passed');
        } finally { await manager.close(); }
      })().catch((error) => { console.error(error); process.exitCode = 1; });
    `);
    const run = spawnSync(process.execPath, [driver], {
      encoding: "utf8", timeout: 90_000,
      env: { ...process.env, TMPDIR: dir, PRASER_REGISTER: path.join(dir, "register"),
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --require=${preload}`.trim() },
    });
    assert.equal(run.status, 0, run.stderr || String(run.error));
    assert.match(run.stdout, /four streamed jobs and Scraper classification passed/u);
    assert.equal(fs.existsSync(path.join(dir, "whole-pdf-reads.log")), false);
    assert.deepEqual(fs.readdirSync(dir).filter((name) => /^linga-(parser-input|pdf-job|pdf-output)-/u.test(name)), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PDF image worker keeps image markers without loading the source PDF", async () => {
  const dir = scratch();
  let imageDir;
  try {
    const input = path.join(dir, "images.pdf");
    fs.writeFileSync(input, await makePdf());
    const worker = createSourceRunner({ kind: "pdf", method: "manual", pdfImages: true });
    const result = await worker({ inPath: input, filename: "images.pdf", outPath: path.join(dir, "out.txt"), includeText: true });
    imageDir = result.imageDir;
    assert.equal(result.imageFiles.length, 1);
    assert.match(result.text, /\[\[IMAGE_0001\]\]/u);
    assert.ok(fs.statSync(result.imageFiles[0].path).size > 0);
  } finally {
    if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupported preserved content filters retry through qpdf without losing text", async () => {
  const dir = scratch();
  try {
    const bytes = await makeAsciiHexPdf();
    const input = path.join(dir, "ascii.pdf");
    const prepared = path.join(dir, "preserved.pdf");
    const work = path.join(dir, "work");
    fs.writeFileSync(input, bytes);
    fs.mkdirSync(work);
    await runQpdfFile(input, prepared, ["--object-streams=disable", "--stream-data=preserve"]);
    const [, , pages] = streamPdfPages(prepared, null, () => {}, { diskPages: true });
    try { assert.throws(() => pages.next(), (error) => error.code === "PDF_CONTENT_DECODE_REQUIRED"); }
    finally { pages.return(); }
    const result = await runPdfStream({ inPath: input, outPath: path.join(dir, "out.txt"), workDir: work, includeText: true });
    assert.match(result.text, /ASCII filter fallback/);
    assert.deepEqual(fs.readdirSync(work), []);
    const manager = new Manager({ outputDir: dir });
    try {
      for (const method of ["default", "manual"]) {
        for (const output of ["docx", "pdf"]) {
          const converted = await manager.dispatchStream(fs.createReadStream(input, { highWaterMark: 19 }), {
            filename: "ascii.pdf", method, output,
            outPath: path.join(dir, `${method}.${output}`), includeText: true,
          });
          assert.match(converted.text, /ASCII filter fallback/u);
        }
      }
    } finally { await manager.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("direct byte sources release their file-backed readers on early return and errors", async () => {
  const dir = scratch();
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  const remaining = () => fs.readdirSync(dir).filter((name) => /^(linga-pdf-source-|myangustis-pdf-pages-)/u.test(name));
  try {
    const [, , pages] = streamPdfPages(await makePdf());
    assert.ok(pages.next().value);
    pages.return();
    assert.deepEqual(remaining(), []);
    assert.throws(() => streamPdfPages(Buffer.from("not a PDF")), /No page tree/u);
    assert.deepEqual(remaining(), []);
    const single = await PDFDocument.create();
    single.addPage().drawText("single page");
    const [, , one] = streamPdfPages(Buffer.from(await single.save({ useObjectStreams: false })));
    assert.ok(one.next().value);
    assert.deepEqual(remaining(), []);
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("page spool and work directory are removed on early return and malformed input", async () => {
  const dir = scratch();
  try {
    const input = path.join(dir, "input.pdf");
    const prepared = path.join(dir, "prepared.pdf");
    const pagesDir = path.join(dir, "pages");
    fs.mkdirSync(pagesDir);
    fs.writeFileSync(input, await makePdf());
    await runQpdfFile(input, prepared, ["--object-streams=disable", "--stream-data=preserve"]);
    const [, , pages] = streamPdfPages(prepared, null, () => {}, { diskPages: true, scratchDir: pagesDir });
    const first = pages.next().value;
    assert.equal(fs.existsSync(first.text.path), true);
    pages.return();
    assert.equal(fs.existsSync(first.text.path), false);
    assert.deepEqual(fs.readdirSync(pagesDir), []);
    const bad = path.join(dir, "bad.pdf");
    const work = path.join(dir, "work");
    fs.writeFileSync(bad, "not a PDF");
    fs.mkdirSync(work);
    await assert.rejects(runPdfStream({ inPath: bad, outPath: path.join(dir, "bad.txt"), workDir: work }));
    assert.deepEqual(fs.readdirSync(work), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("object streams, long trailing comments and encrypted PDFs preserve qpdf behavior", async () => {
  const dir = scratch();
  try {
    const input = path.join(dir, "source.pdf");
    const encrypted = path.join(dir, "empty-password.pdf");
    const protectedFile = path.join(dir, "password.pdf");
    const packed = path.join(dir, "object-streams.pdf");
    const trimmed = path.join(dir, "trimmed.pdf");
    fs.writeFileSync(input, await makePdf());
    await runQpdfFile(input, packed, ["--object-streams=generate"]);
    const manager = new Manager({ outputDir: dir });
    try {
      const unpacked = await manager.dispatchStream(fs.createReadStream(packed), {
        filename: "object-streams.pdf", outPath: path.join(dir, "objects.txt"), includeText: true,
      });
      assert.equal(unpacked.pages, 4);
      assert.match(unpacked.text, /English text across streams/);
    } finally { await manager.close(); }
    await runQpdfFile(input, encrypted, ["--encrypt", "", "test-owner-password", "256", "--"]);
    await runQpdfFile(input, protectedFile, ["--encrypt", "test-password", "test-owner-password", "256", "--"]);
    const before = fs.readFileSync(encrypted);
    fs.appendFileSync(encrypted, `\n%${"x".repeat(300_000)}`);
    fs.appendFileSync(protectedFile, `\n%${"x".repeat(300_000)}`);
    const end = findPdfEnd(encrypted);
    assert.equal(end, before.lastIndexOf(Buffer.from("%%EOF")) + 5);
    copyPdfPrefix(encrypted, trimmed, end);
    assert.deepEqual(fs.readFileSync(trimmed), before.subarray(0, end));
    const result = await runPdfStream({ inPath: encrypted, outPath: path.join(dir, "ok.txt"), includeText: true });
    assert.equal(result.pages, 4);
    assert.match(result.text, /English text across streams/);
    await assert.rejects(runPdfStream({ inPath: protectedFile, outPath: path.join(dir, "no.txt") }), /needs a password/iu);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("manual PDF normalizes after OCR merge and scans the same final text", async () => {
  const root = scratch();
  try {
    const sourceText = "စဥ် ကိ";
    const normalize = await getEngineNormalize();
    const expected = normalize(sourceText);
    for (const extension of ["txt", "docx", "pdf"]) {
      const dir = path.join(root, extension);
      fs.mkdirSync(dir);
      const source = new PageStoreWriter(dir, "input");
      source.addPage({ text: [sourceText], lines: [[10, 20, 12, sourceText]], wh: [400, 500] });
      source.addPage({ text: [""], images: [{ pageSized: true }], hasImg: true, wh: [400, 500] });
      source.close();
      const result = await finishManualPdf({
        pageStore: source.store, sourcePath: "ignored.pdf", directory: dir,
        outPath: path.join(dir, `output.${extension}`), source: "input.pdf", counts: {},
        includeText: true, owner: false, maxOcrPages: 1,
        pageHasImage: async () => false, ocrPage: async () => sourceText, ocrRegion: async () => "",
      });
      assert.equal(result.text, `${expected}\n\n${expected}`, extension);
      assert.deepEqual(result.ocrPages, [2]);
      const report = fs.readFileSync(result.posScan.file, "utf8");
      assert.equal((report.match(/Original: စဉ် ကိ/gu) ?? []).length, 2);
      if (extension === "docx") assert.ok(docxDocument(result.file).includes(expected));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("manual page spool preserves full-page and regional OCR merge semantics", async () => {
  const dir = scratch();
  try {
    const pageTexts = ["footer text", "vector\n x \t y", " \n", "", `${"A".repeat(200_000)}\n x \t y`];
    const pages = [
      { images: [{ pageSized: true }] },
      { images: [{ bbox: [1, 2, 3, 4] }, { bbox: [5, 6, 7, 8] }] },
      { images: [] },
      { images: [] },
      { images: [{ bbox: [9, 10, 11, 12] }] },
    ];
    const indexPath = path.join(dir, "index.jsonl");
    const textPath = path.join(dir, "text.bin");
    let offset = 0;
    const records = pageTexts.map((text, index) => {
      const bytes = Buffer.from(text);
      const record = { index, start: offset, length: bytes.length, hasText: Boolean(text.trim()), hasImg: false, ...pages[index] };
      offset += bytes.length;
      return record;
    });
    fs.writeFileSync(textPath, Buffer.concat(pageTexts.map((text) => Buffer.from(text))));
    fs.writeFileSync(indexPath, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
    assert.equal((await Array.fromAsync(indexRecords(indexPath))).length, 5);
    const calls = [];
    const options = {
      pageStore: { indexPath, textPath }, sourcePath: "ignored.pdf", directory: dir,
      outPath: path.join(dir, "manual.txt"), source: "source.pdf", counts: { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 5 },
      includeText: true, owner: false, maxOcrPages: 10,
      pageHasImage: async (_file, number) => number === 4,
      ocrPage: async (_file, number) => { calls.push(["page", number]); return number === 1 ? "footer   text\nfull scan" : "blank scan"; },
      ocrRegion: async (_file, number, box) => {
        calls.push(["region", number, box]);
        if (number === 5) return "x y\nlong extra";
        return box[0] === 1 ? "x y\nregion one" : "region one\nregion two";
      },
    };
    await assert.rejects(finishManualPdf({ ...options, maxOcrPages: 3 }), /4 image pages/u);
    assert.deepEqual(calls, []);
    fs.rmSync(path.join(dir, "ocr-plan.jsonl"));
    const actual = await finishManualPdf(options);
    const expectedPages = [
      "full scan\nfooter text", "vector\n x \t y\nregion one\nregion two", " \n", "blank scan",
      `${pageTexts[4]}\nlong extra`,
    ].map((text) => ({ text }));
    const old = await writeOutput(path.join(dir, "expected.txt"), expectedPages, {
      counts: options.counts, source: options.source, includeText: true,
    });
    assert.deepEqual(actual.ocrPages, [1, 2, 4, 5]);
    assert.deepEqual(fs.readFileSync(actual.file), fs.readFileSync(old.file));
    assert.equal(actual.text, old.text);
    assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [["page", 1], ["region", 2], ["region", 2], ["page", 4], ["region", 5]]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("the POS sidecar reflects final merged OCR text, not just the PDF text layer", async () => {
  const dir = scratch();
  try {
    const pages = new PageStoreWriter(dir);
    pages.addPage({ text: ["footer"], images: [{ pageSized: true }], hasImg: true });
    pages.close();
    const result = await finishManualPdf({
      pageStore: pages.store, sourcePath: "ignored.pdf", directory: dir,
      outPath: path.join(dir, "manual.txt"), source: "scans.pdf",
      counts: { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 1 }, owner: false, maxOcrPages: 1,
      pageHasImage: async () => true,
      ocrPage: async () => "ကောင်းကင် စမ်းသပ် ကိ မြန်မာ",
      ocrRegion: async () => "",
    });
    assert.equal(result.posScan.unknownCount, 1);
    assert.match(fs.readFileSync(result.posScan.file, "utf8"), /Page 1, line 1\nOriginal: ကောင်းကင် စမ်းသပ် ကိ မြန်မာ\nContext: ကောင်းကင်\{n\}  စမ်းသပ်\{v\}  ကိ\{\?\}  မြန်မာ\{n\}/u);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("manual OCR spool preserves DOCX layout and PDF text when merging images", async () => {
  const root = scratch();
  const wh = [400, 500];
  const firstLine = [10, 30, 11, "Footer"];
  const secondLine = [25, 420, 14, "Vector"];
  try {
    for (const extension of ["docx", "pdf"]) {
      const dir = path.join(root, extension);
      fs.mkdirSync(dir);
      const source = new PageStoreWriter(dir);
      source.addPage({ text: ["Footer"], lines: [firstLine], wh, images: [{ pageSized: true }], hasImg: true });
      source.addPage({ text: ["Vector"], lines: [secondLine], wh, images: [{ bbox: [1, 2, 3, 4] }], hasImg: true });
      source.addPage({ text: [""], lines: [], wh, images: [], hasImg: false });
      source.close();
      const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 3 };
      const result = await finishManualPdf({
        pageStore: source.store, sourcePath: "ignored.pdf", directory: dir,
        outPath: path.join(dir, `actual.${extension}`), source: "scans.pdf", counts,
        includeText: true, owner: false, maxOcrPages: 5,
        pageHasImage: async () => false,
        ocrPage: async () => "Full scan\nFooter",
        ocrRegion: async () => "Vector",
      });
      const expected = await writeOutput(path.join(dir, `expected.${extension}`), [
        { text: "Full scan\nFooter", lines: [], wh, hasImg: true },
        { text: "Vector", lines: [secondLine], wh, hasImg: true },
        { text: "", lines: [], wh, hasImg: false },
      ], { counts, source: "scans.pdf", includeText: true });
      assert.deepEqual(result.ocrPages, [1, 2]);
      for (const key of ["lineCount", "textChars", "textBytes", "text"]) assert.equal(result[key], expected[key], key);
      if (extension === "docx") assert.equal(docxDocument(result.file), docxDocument(expected.file));
      else assert.equal(await canonicalPdf(result.file, dir, "actual"), await canonicalPdf(expected.file, dir, "expected"));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("streaming Rabbit handles long runs and U+200B consistently across chunks", () => {
  const input = `ကေ${"ျြွှ".repeat(200_000)}😀\u200b${"ိ".repeat(200_000)}\n`;
  for (const preserveSpaces of [false, true]) {
    let actual = "";
    const converter = createRabbitStream((part) => { actual += part; }, { preserveSpaces });
    for (let i = 0; i < input.length; i += 1023) converter.push(input.slice(i, i + 1023));
    converter.push("", true);
    assert.equal(actual, Rabbit.zg2uni(input, { preserveSpaces }));
    assert.equal(actual.includes("\u200b"), false);
  }
});

test("streaming Rabbit can retain spaces across chunk boundaries", () => {
  const source = "တူပါရဲ ႔၊\u200bနားရြက္ေတြ";
  const options = { preserveSpaces: true };
  let result = "";
  const converter = createRabbitStream((part) => { result += part; }, options);
  for (const char of source) converter.push(char);
  converter.push("", true);
  assert.equal(result, Rabbit.zg2uni(source, options));
  assert.equal(result, "တူပါရဲ ့၊နားရွက်တွေ");
  assert.equal(Rabbit.zg2uni("ရဲ ႔"), "ရဲ့");
});

test("actual OCR of an image-only PDF feeds recognized text into the POS sidecar", async (t) => {
  let canvas;
  try {
    canvas = await import("@napi-rs/canvas");
    await import("tesseract.js");
  } catch {
    t.skip("optional OCR and canvas dependencies are not installed");
    return;
  }
  const font = path.resolve("Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF");
  const model = path.resolve("B.Parser/main/parser/model/mya.traineddata");
  if (!fs.existsSync(font) || !fs.existsSync(model)) {
    t.skip("OCR model or layout font is not available");
    return;
  }
  const dir = scratch();
  const manager = new Manager({ outputDir: dir });
  try {
    assert.ok(canvas.GlobalFonts.registerFromPath(font, "PosOcrTestFont"));
    const bitmap = canvas.createCanvas(1800, 420);
    const ctx = bitmap.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1800, 420);
    ctx.fillStyle = "black"; ctx.font = "60px PosOcrTestFont";
    ctx.fillText("ကောင်းကင် စမ်းသပ် ကိ မြန်မာ", 70, 155);
    ctx.fillText("ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ", 70, 295);
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(bitmap.toBuffer("image/png"));
    pdf.addPage([900, 210]).drawImage(image, { x: 0, y: 0, width: 900, height: 210 });
    const input = path.join(dir, "image-only.pdf");
    fs.writeFileSync(input, await pdf.save());
    for (const [job, method] of [["ocr", "default"], ["extracting", "manual"]]) {
      const result = await manager.dispatchStream(fs.createReadStream(input), {
        filename: "image-only.pdf", job, method, output: "txt", outPath: path.join(dir, `${job}.txt`),
      });
      const text = fs.readFileSync(result.file, "utf8");
      const report = fs.readFileSync(result.posScan.file, "utf8");
      assert.equal(result.pages, 1);
      if (method === "manual") assert.deepEqual(result.ocrPages, [1]);
      assert.match(text, /[\u1000-\u109f]/u);
      assert.ok(result.posScan.unknownCount > 0);
      const originals = [...report.matchAll(/^Original: (.*)$/gmu)].map((match) => match[1]);
      assert.equal(originals.length, result.posScan.contextCount);
      assert.ok(originals.every((line) => text.includes(line)));
      assert.equal((report.match(/^Page 1, line \d+$/gmu) ?? []).length, originals.length);
    }
  } finally {
    await manager.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("DOCX image markers follow actual relationships and reused images", async (t) => {
  let canvas;
  try { canvas = await import("@napi-rs/canvas"); } catch { t.skip("optional canvas dependency is not installed"); return; }
  const imageBytes = (color) => {
    const image = canvas.createCanvas(8, 8);
    const context = image.getContext("2d");
    context.fillStyle = color; context.fillRect(0, 0, 8, 8);
    return image.toBuffer("image/png");
  };
  const red = imageBytes("red");
  const blue = imageBytes("blue");
  const drawing = (bytes) => new ImageRun({ type: "png", data: bytes, transformation: { width: 10, height: 10 } });
  const doc = new Document({ sections: [{ children: [
    new Paragraph({ children: [drawing(blue)] }), new Paragraph({ children: [drawing(red)] }),
    new Paragraph({ children: [drawing(blue)] }),
  ] }] });
  const dir = scratch();
  try {
    const files = [];
    const paragraphs = extractDocxParagraphs(await Packer.toBuffer(doc), { imageDir: dir, imageFiles: files });
    assert.equal(files.length, 2);
    assert.deepEqual(paragraphs.slice(0, 3), [files[0].marker, files[1].marker, files[0].marker]);
    assert.notEqual(files[0].marker, files[1].marker);
    assert.deepEqual(fs.readFileSync(files[0].path), blue);
    assert.deepEqual(fs.readFileSync(files[1].path), red);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("manual DOCX normalizes only after image OCR is merged", async () => {
  const root = scratch();
  try {
    const sourceText = "စဥ် ကိ";
    const normalize = await getEngineNormalize();
    const expected = normalize(sourceText);
    const marker = "\uE000OCR-12345678-1234-4234-8234-123456789abc-0001\uE001";
    for (const extension of ["txt", "docx", "pdf"]) {
      const dir = path.join(root, extension);
      fs.mkdirSync(dir);
      const source = new PageStoreWriter(dir, "input");
      source.addPage({ text: [`${sourceText}\n${marker}`] });
      source.close();
      const result = await finishManualDocx({
        pageStore: source.store, directory: dir, outPath: path.join(dir, `output.${extension}`),
        source: "input.docx", counts: {}, includeText: true, owner: false,
        imageFiles: [{ id: "0001", marker }], ocr: [{ id: "0001", text: sourceText }],
      });
      assert.equal(result.text, `${expected}\n${expected}`, extension);
      assert.equal((fs.readFileSync(result.posScan.file, "utf8").match(/Original: စဉ် ကိ/gu) ?? []).length, 2);
      if (extension === "docx") assert.ok(docxDocument(result.file).includes(expected));
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("manual DOCX OCR merges source chunks before writing all output formats and POS", async () => {
  const root = scratch();
  try {
    for (const extension of ["txt", "docx", "pdf"]) {
      const dir = path.join(root, extension);
      fs.mkdirSync(dir);
      const marker = "\uE000OCR-12345678-1234-4234-8234-123456789abc-0001\uE001";
      const source = new PageStoreWriter(dir, "source");
      source.addPage({ text: [`Page-12\nကောင်းကင် စမ်းသပ် ကိ မြန်မာ\n${marker}`] });
      source.addPage({ text: ["ကိ"] });
      source.close();
      const written = await finishManualDocx({
        pageStore: source.store, directory: dir, outPath: path.join(dir, `output.${extension}`),
        source: "source.docx", counts: {}, includeText: true, owner: false,
        imageFiles: [{ id: "0001", marker }],
        ocr: [{ id: "0001", text: "ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ" }],
      });
      const report = fs.readFileSync(written.posScan.file, "utf8");
      assert.equal(written.posScan.unknownCount, 4);
      assert.match(report, /Page 12, line 1\nOriginal: ကောင်းကင် စမ်းသပ် ကိ မြန်မာ/u);
      assert.match(report, /Page 12, line 2\nOriginal: ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ/u);
      assert.match(report, /Page 12, line 3\nOriginal: ကိ/u);
      assert.doesNotMatch(report, /Page 2,/u);
      assert.match(written.text, /ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ/u);
      assert.doesNotMatch(written.text, /\uE000OCR-/u);
      if (extension === "docx") assert.equal(fs.readFileSync(written.file).subarray(0, 2).toString(), "PK");
      if (extension === "pdf") assert.equal(fs.readFileSync(written.file).subarray(0, 5).toString(), "%PDF-");
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("Manager manual DOCX OCR scans final recognized text without inventing chunk pages", async (t) => {
  let canvas;
  try { canvas = await import("@napi-rs/canvas"); await import("tesseract.js"); }
  catch { t.skip("optional OCR and canvas dependencies are not installed"); return; }
  const font = path.resolve("Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF");
  const model = path.resolve("B.Parser/main/parser/model/mya.traineddata");
  if (!fs.existsSync(font) || !fs.existsSync(model)) { t.skip("OCR model or layout font is unavailable"); return; }
  const dir = scratch();
  const manager = new Manager({ outputDir: dir });
  try {
    canvas.GlobalFonts.registerFromPath(font, "DocxOcrTestFont");
    const bitmap = canvas.createCanvas(1400, 260);
    const ctx = bitmap.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 1400, 260);
    ctx.fillStyle = "black"; ctx.font = "60px DocxOcrTestFont";
    ctx.fillText("ဤ စာ ကိ ဃု ကောင်းကင် မြန်မာ", 50, 150);
    const doc = new Document({ sections: [{ children: [
      new Paragraph("Page-12"), new Paragraph("ကောင်းကင် စမ်းသပ် ကိ မြန်မာ"),
      new Paragraph({ children: [new ImageRun({ type: "png", data: bitmap.toBuffer("image/png"),
        transformation: { width: 700, height: 130 } })] }),
    ] }] });
    const input = path.join(dir, "source.docx");
    fs.writeFileSync(input, await Packer.toBuffer(doc));
    for (const [job, method, extension] of [
      ["extracting", "manual", "txt"], ["null", "default", "docx"], ["null", "default", "pdf"],
    ]) {
      const result = await manager.dispatchStream(fs.createReadStream(input), {
        filename: "source.docx", job, method, output: extension, includeText: true,
        outPath: path.join(dir, `out.${extension}`),
      });
      const text = result.text;
      const report = fs.readFileSync(result.posScan.file, "utf8");
      assert.match(report, /Page 12, line 1\nOriginal: ကောင်းကင် စမ်းသပ် ကိ မြန်မာ/u);
      assert.doesNotMatch(text, /\uE000OCR-/u);
      const originals = [...report.matchAll(/^Original: (.*)$/gmu)].map((match) => match[1]);
      assert.ok(originals.every((line) => text.includes(line)));
      assert.ok(originals.some((line) => line !== "ကောင်းကင် စမ်းသပ် ကိ မြန်မာ"), "recognized image text reached POS");
      const prefix = fs.readFileSync(result.file).subarray(0, 5).toString();
      if (extension === "docx") assert.ok(prefix.startsWith("PK"));
      if (extension === "pdf") assert.equal(prefix, "%PDF-");
    }
  } finally { await manager.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
