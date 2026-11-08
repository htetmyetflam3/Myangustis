import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { decodeOutsideStream, decodePdfInstructions, renderInstructions } from "../../../B.Parser/core/pdf/page-instructions.js";
import { openPdfScannedObjects } from "../../../B.Parser/core/pdf/pdf-objects.js";

const SAMPLE = path.resolve("B.Parser/host/Frontend/frontend-bootstrap/public/samples/sample.pdf");

// The outside-stream experiment, promoted to a parser pass: page order,
// geometry and font chains must be decidable from dictionaries alone,
// without opening or decompressing a single stream.
test("outside-stream instructions decode the sample without opening streams", () => {
  const decoded = decodeOutsideStream(SAMPLE);
  assert.equal(decoded.objectCount, 212);
  assert.equal(decoded.streamCount, 102);
  assert.equal(decoded.pages.length, 100);
  assert.ok(decoded.catalog, "catalog object found");
  assert.ok(decoded.rootPages, "page tree root found");

  const first = decoded.pages[0];
  assert.ok(first.mediaBox, "first page reports a MediaBox (own or inherited)");
  assert.ok(first.fonts.length > 0, "first page resolves font objects");
  for (const font of first.fonts) {
    assert.match(font.key, /^\d+,\d+$/, "font is an object reference, not decoded bytes");
    assert.ok(font.summary.length > 0, "font summary describes encoding/embeddedness");
  }
  for (const content of first.contents) {
    assert.match(content.key, /^\d+,\d+$/, "content is an object reference");
    assert.ok(content.filter, "content stream filter read from its dictionary");
  }

  const text = renderInstructions(decoded, { sourceLabel: "sample.pdf" });
  assert.ok(text.includes("PAGE 100 = object"), "instructions cover every page in tree order");
  assert.ok(text.includes("NOT DECODED"), "streams are referenced, never decoded");
});

// The wired form: the stream parser discovers pages through the same
// instructions over the objects reader it already opened — no second
// page-tree walk exists beside this one.
test("decodePdfInstructions drives page discovery over an opened objects reader", () => {
  const { objects, close } = openPdfScannedObjects(SAMPLE);
  try {
    const decoded = decodePdfInstructions(objects);
    assert.equal(decoded.pages.length, 100);
    assert.ok(decoded.rootPages, "page tree root resolved");
    const first = decoded.pages[0];
    assert.ok(Number.isInteger(first.num) && Number.isInteger(first.gen), "page carries its object number/generation");
    assert.ok(Array.isArray(first.size) && first.size[0] > 0 && first.size[1] > 0,
      "page carries its MediaBox size for extraction geometry");
    const keys = decoded.pages.map((page) => page.key);
    assert.equal(new Set(keys).size, keys.length, "each page listed once, in tree order");
  } finally {
    close();
  }
});
