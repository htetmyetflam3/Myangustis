/*
(output/docx) The DOCX output module: render finished pages into a DOCX file.
Two entries: writeDocxLayout takes pages with layout lines
[x, y, size, text] (what a PDF source offers) and positions each
paragraph; writeDocxPlain takes raw text (what a DOCX source
offers). Both stream word/document.xml into the zip as they go -
member bytes are generated, not held. Shared helpers in ../helper/.
*/
import { BURMESE_FONTS, DEFAULT_BURMESE_KEY } from "../../@parse/method/fonts.js";
import { ZipStreamWriter } from "../../@parse/docx/zip.js";
import { pyRound } from "../../core/@helper/pylib.js";
import { textLines } from "../helper/text-lines.js";

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
export function layoutPara(xTw, beforeTw, size, text) {
  const half = Math.max(1, pyRound(size * 2));
  const lineTw = Math.max(1, pyRound(size * LH * TWIPS));
  const bm = hasMyanmar(text) ? BURMESE_DOCX_NAME : "Anonymous Pro";
  const rpr = `<w:rPr><w:rFonts w:ascii="Anonymous Pro" w:hAnsi="Anonymous Pro" `
    + `w:cs="${bm}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr>`;
  const ppr = `<w:pPr><w:spacing w:before="${Math.max(0, pyRound(beforeTw))}" w:after="0" `
    + `w:line="${lineTw}" w:lineRule="exact"/>`
    + `<w:ind w:left="${Math.max(0, pyRound(xTw))}" w:right="0" w:firstLine="0"/>`
    + `<w:jc w:val="left"/></w:pPr>`;
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

export function sectPr(wPt, hPt) {
  return `<w:sectPr><w:pgSz w:w="${pyRound(wPt * TWIPS)}" w:h="${pyRound(hPt * TWIPS)}"/>`
    + `<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" `
    + `w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
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


export async function writeDocxLayout(outPath, pages, pdfPath, pageCount = pages.length) {
  void pdfPath;
  async function* body() {
    yield DOC_HEAD;
    let i = 0;
    for await (const pg of pages) {
      const [wPt, hPt] = pg.wh ?? [612.0, 792.0];
      const count = pg.lineCount ?? pg.lines?.length ?? 0;
      const lines = typeof pg.lines === "function" ? pg.lines() : (pg.lines ?? []);
      const hasText = pg.hasText ?? Boolean(String(pg.text ?? "").trim());
      if (!count && hasText) {
        const text = typeof pg.textChunks === "function" ? pg.textChunks() : [String(pg.text ?? "")];
        for (const line of textLines(text)) yield line ? layoutPara(20 * TWIPS, 0, 11, line) : "<w:p/>";
      } else if (!count && pg.hasImg) {
        yield layoutPara(20 * TWIPS, 20 * TWIPS, 10, "[image-only page]");
      }
      let prevBase = null;
      let prevH = 0.0;
      for (const [x, y, size, text] of lines) {
        if (!text) continue;
        const baseTop = hPt - y;
        let before;
        if (prevBase === null) before = Math.max(0.0, baseTop - size);
        else before = Math.max(0.0, baseTop - prevBase - prevH);
        prevBase = baseTop;
        prevH = size * LH;
        yield layoutPara(x * TWIPS, before * TWIPS, size, text);
      }
      if (i < pageCount - 1) yield `<w:p><w:pPr>${sectPr(wPt, hPt)}</w:pPr></w:p>`;
      else yield sectPr(wPt, hPt);
      i += 1;
    }
    if (i !== pageCount) throw new Error("Page count changed while writing DOCX");
    if (pageCount === 0) yield sectPr(612.0, 792.0);
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


export async function writeDocxPlain(outPath, text) {
  async function* body() {
    yield DOC_HEAD;
    const chunks = typeof text === "string" || text == null ? [String(text ?? "")] : text;
    for (const line of textLines(chunks)) {
      yield line ? layoutPara(0.0, 0.0, 11.0, line) : "<w:p/>";
    }
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
