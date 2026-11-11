/*
(output/docx) The DOCX output module: render finished pages into a
DOCX file. Pages arrive as marked-up strings (one per page);
paragraphs, headings and bold/italic runs come from the markup,
never from preserved layout. Streams word/document.xml into the
zip as it goes - member bytes are generated, not held. Shared
helpers in ../helper/.
*/
import { BURMESE_FONTS, DEFAULT_BURMESE_KEY } from "../helper/output-fonts.js";
import { parseMarkup } from "../helper/markup.js";
import { ZipStreamWriter } from "../../prised/@core/docx/zip.js";
import { pyRound } from "../../prised/@helper/pylib.js";

const BURMESE_DOCX_NAME = BURMESE_FONTS[DEFAULT_BURMESE_KEY].docx;

export function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

const TWIPS = 20;
const LH = 1.2;
export function hasMyanmar(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1000 && cp <= 0x109f) return true;
  }
  return false;
}

export function sectPr(wPt, hPt) {
  return `<w:sectPr><w:pgSz w:w="${pyRound(wPt * TWIPS)}" w:h="${pyRound(hPt * TWIPS)}"/>`
    + `<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" `
    + `w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

const HEADING_SIZE = { h1: 16, h2: 13, p: 11 };

function runXml(run, size) {
  const bm = hasMyanmar(run.text) ? BURMESE_DOCX_NAME : "Anonymous Pro";
  const rpr = `<w:rPr><w:rFonts w:ascii="Anonymous Pro" w:hAnsi="Anonymous Pro" `
    + `w:cs="${bm}"/>${run.bold ? "<w:b/>" : ""}${run.italic ? "<w:i/>" : ""}`
    + `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr>`;
  return `<w:r>${rpr}<w:t xml:space="preserve">${esc(run.text)}</w:t></w:r>`;
}

function paraXml(block) {
  const size = HEADING_SIZE[block.tag] ?? 11;
  const lineTw = Math.max(1, pyRound(size * LH * TWIPS));
  const ppr = `<w:pPr><w:spacing w:before="0" w:after="120" `
    + `w:line="${lineTw}" w:lineRule="auto"/><w:jc w:val="left"/></w:pPr>`;
  const lines = block.lines.map((runs, i) =>
    (i ? "<w:r><w:br/></w:r>" : "") + runs.map((run) => runXml(
      block.tag === "p" ? run : { ...run, bold: true }, size)).join(""));
  return `<w:p>${ppr}${lines.join("")}</w:p>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const DOC_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';

export async function writeDocxMarkup(outPath, markedPages, pageCount = markedPages.length) {
  async function* body() {
    yield DOC_HEAD;
    let i = 0;
    for await (const marked of markedPages) {
      for (const block of parseMarkup(marked)) yield paraXml(block);
      i += 1;
      if (i < pageCount) yield '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
    }
    if (i !== pageCount) throw new Error("Page count changed while writing DOCX");
    yield sectPr(612.0, 792.0);
    yield "</w:body></w:document>";
  }

  const zip = new ZipStreamWriter(outPath);
  try {
    await zip.writestr("[Content_Types].xml", CONTENT_TYPES);
    await zip.writestr("_rels/.rels", RELS);
    await zip.member("word/document.xml").stream(body());
    await zip.close();
  } finally {
    zip.abort();
  }
  return outPath;
}
