import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, degrees, rgb } from "pdf-lib";
import { createCanvas, loadImage } from "@napi-rs/canvas";

import { pageHasRasterImage, pdfPageCount, renderPdfPagePng, renderPdfRegionPng } from "../../../B.Parser/prised/@core/runtime/render.js";

test("region rendering converts PDF coordinates at each page rotation and offset", async () => {
  const document = await PDFDocument.create();
  for (const rotation of [0, 90, 180, 270]) {
    const page = document.addPage([300, 400]);
    page.setMediaBox(100, 200, 300, 400);
    page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 140, y: 260, width: 60, height: 100, color: rgb(1, 0, 0) });
  }
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  for (const [index, rotation] of [0, 90, 180, 270].entries()) {
    const region = await renderPdfRegionPng(bytes, index + 1, [140, 260, 200, 360], { scale: 2 });
    assert.equal(region.width, rotation % 180 ? 200 : 120, `${rotation} width`);
    assert.equal(region.height, rotation % 180 ? 120 : 200, `${rotation} height`);
    const image = await loadImage(region.png);
    const canvas = createCanvas(region.width, region.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const [red, green, blue, alpha] = context.getImageData(region.width / 2, region.height / 2, 1, 1).data;
    assert.ok(red > 240 && green < 20 && blue < 20 && alpha > 240, `${rotation} crop center`);
  }
});

test("range-backed PDF rendering matches a buffered source", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-range-render-"));
  try {
    const document = await PDFDocument.create();
    const page = document.addPage([300, 400]);
    page.drawRectangle({ x: 40, y: 80, width: 90, height: 100, color: rgb(1, 0, 0) });
    const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
    const file = path.join(dir, "source.pdf");
    fs.writeFileSync(file, bytes);
    assert.equal(await pdfPageCount(file), await pdfPageCount(bytes));
    assert.equal(await pageHasRasterImage(file, 1), await pageHasRasterImage(bytes, 1));
    const fromPath = await renderPdfPagePng(file, 1, { scale: 1 });
    const fromBuffer = await renderPdfPagePng(bytes, 1, { scale: 1 });
    assert.deepEqual(fromPath.png, fromBuffer.png);
    const box = [40, 80, 130, 180];
    assert.deepEqual((await renderPdfRegionPng(file, 1, box)).png, (await renderPdfRegionPng(bytes, 1, box)).png);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("region rendering rejects invalid or invisible bounding boxes", async () => {
  const document = await PDFDocument.create();
  document.addPage([200, 200]);
  const bytes = Buffer.from(await document.save({ useObjectStreams: false }));
  await assert.rejects(renderPdfRegionPng(bytes, 1, [0, 0, NaN, 10]), /four-number/);
  await assert.rejects(renderPdfRegionPng(bytes, 1, [300, 300, 400, 400]), /outside the visible page/);
});
