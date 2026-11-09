import test from "node:test";
import assert from "node:assert/strict";

import {
  requestScanLineSvgs, svgRequestsForScanMemory,
} from "../../../B.Parser/core/beautify/repair.js";
import { createOriginalPdfCache } from "../../../B.Parser/core/original-pdf-cache.js";

// Scan (PosScanner) finishes with only broken lines in memory. Repair
// turns each one into a line-scope SVG request and sends it to the
// original-PDF cache -- the part that owns the PDF and exports its
// lines to SVG. Scan itself never talks to the PDF.
const MEMORY = [
  { page: 2, line: 5, context: "ကောင်း{n}  ကိ{F}  မြန်မာ{n}", count: 1 },
  { page: 2, line: 7, context: "စာ{n,p}  ဃု{F}  ကောင်း{n}", count: 2 },
];

test("scan memory becomes one SVG request per broken line", () => {
  const requests = svgRequestsForScanMemory({ memory: MEMORY }, { sourcePdf: "book.pdf" });
  assert.deepEqual(requests, [
    {
      id: "2:5", page: 2, line: 5, sequence: 1, scope: "line", format: "svg",
      sourcePdf: "book.pdf", context: MEMORY[0].context, count: 1,
    },
    {
      id: "2:7", page: 2, line: 7, sequence: 2, scope: "line", format: "svg",
      sourcePdf: "book.pdf", context: MEMORY[1].context, count: 2,
    },
  ]);
});

test("requests are sent to the original-PDF cache and responses normalized", async () => {
  const asked = [];
  const cache = createOriginalPdfCache({
    sourcePdf: "book.pdf",
    exportLineSvg: async (request) => {
      asked.push(request.id);
      return `<svg data-line="${request.line}"></svg>`;
    },
  });
  try {
    const result = await requestScanLineSvgs({ memory: MEMORY }, cache, { sourcePdf: "book.pdf" });
    assert.deepEqual(asked, ["2:5", "2:7"]);
    assert.equal(result.requests.length, 2);
    assert.deepEqual(result.responses, [
      { id: "2:5", page: 2, line: 5, svg: '<svg data-line="5"></svg>' },
      { id: "2:7", page: 2, line: 7, svg: '<svg data-line="7"></svg>' },
    ]);
    // Second ask for the same line is served from the cache, not re-exported.
    const again = await requestScanLineSvgs({ memory: [MEMORY[0]] }, cache, { sourcePdf: "book.pdf" });
    assert.equal(again.responses.length, 1);
    assert.deepEqual(asked, ["2:5", "2:7"]);
  } finally {
    cache.close();
  }
});

test("no cache or no JS exporter yet: requests stay pending, nothing throws", async () => {
  const noCache = await requestScanLineSvgs({ memory: MEMORY }, null);
  assert.equal(noCache.responses.length, 0);
  assert.equal(noCache.pending.length, 2);

  const cache = createOriginalPdfCache({ sourcePdf: "book.pdf" });
  try {
    const result = await requestScanLineSvgs({ memory: MEMORY }, cache);
    assert.equal(result.responses.length, 0);
    assert.equal(result.pending.length, 2);
    assert.match(result.unavailable, /not implemented/iu);
  } finally {
    cache.close();
  }
});

test("no broken lines means no requests", async () => {
  const result = await requestScanLineSvgs({ memory: [] }, null);
  assert.deepEqual(result, { stage: "original-pdf-svg", requests: [], responses: [] });
});
