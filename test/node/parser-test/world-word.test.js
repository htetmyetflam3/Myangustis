import test from "node:test";
import assert from "node:assert/strict";
import { correctWorldWord } from "../../../B.Parser/main/parser/text/page-decision.js";
import { streamPdfPages } from "../../../B.Parser/core/decoding/source-decoding.js";

// The text is from the merged PDF's output; the font dictionaries are a small
// synthetic way to exercise the existing page-font evidence boundary.
function pdfWithText(font, text) {
  const codes = [...text].map((ch) => ch.codePointAt(0));
  const unique = [...new Set(codes)];
  const hex = (cp) => cp.toString(16).toUpperCase().padStart(4, "0");
  const cmap = `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n`
    + `/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n`
    + `${unique.length} beginbfchar\n${unique.map((cp) => `<${hex(cp)}> <${hex(cp)}>`).join("\n")}\n`
    + `endbfchar\nendcmap\nend end\n`;
  const content = `BT /F1 12 Tf 1 0 0 1 20 700 Tm <${codes.map(hex).join("")}> Tj ET\n`;
  return Buffer.from(
    `%PDF-1.4\n`
    + `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`
    + `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`
    + `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] `
    + `/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`
    + `4 0 obj\n<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream\nendobj\n`
    + `5 0 obj\n<< /Type /Font /Subtype /Type0 /BaseFont /${font} /Encoding /Identity-H `
    + `/DescendantFonts [6 0 R] /ToUnicode 7 0 R >>\nendobj\n`
    + `6 0 obj\n<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${font} /CIDToGIDMap /Identity >>\nendobj\n`
    + `7 0 obj\n<< /Length ${Buffer.byteLength(cmap)} >>\nstream\n${cmap}endstream\nendobj\n%%EOF\n`,
    "latin1",
  );
}

test("the final word correction is restricted to the observed word forms", () => {
  const text = "ထိုအချိန်တွင် ကမ်ဘာရှိ\nဇူရှီ၊ ကမၻာလိပ်နက်၏\n[0830] \u200bကမ္ဘာ";
  const expected = "ထိုအချိန်တွင် ကမ္ဘာရှိ\nဇူရှီ၊ ကမ္ဘာလိပ်နက်၏\n[0830] \u200bကမ္ဘာ";
  assert.equal(correctWorldWord(text, true), expected);
  assert.equal(correctWorldWord(text, false), text);
});

test("the PDF final text and layout use the same correction with Zawgyi evidence", () => {
  const text = "ထိုအချိန်တွင် ကမ်ဘာရှိ အထွတ်အထိပ်";
  const [, , pages] = streamPdfPages(pdfWithText("Zawgyi-One", text));
  const page = pages.next().value;
  assert.equal(page.text, "ထိုအချိန်တွင် ကမ္ဘာရှိ အထွတ်အထိပ်");
  assert.equal(page.lines[0][3], page.text);
  assert.deepEqual([...page.fontKinds], ["ZAWGYI"]);
});

test("the PDF correction does not alter known or explicitly selected Unicode", () => {
  const text = "ထိုအချိန်တွင် ကမ်ဘာရှိ အထွတ်အထိပ်";
  const [, , pages] = streamPdfPages(pdfWithText("MyanmarText", text));
  const page = pages.next().value;
  assert.equal(page.text, text);
  assert.deepEqual([...page.fontKinds], ["UNICODE"]);

  const [, , selected] = streamPdfPages(pdfWithText("Zawgyi-One", text), () => {}, {
    sourceEncoding: "unicode",
  });
  assert.equal(selected.next().value.text, text);
});
