import {
  ANONYMOUS_PRO_FILES,
  BURMESE_FONTS,
  DEFAULT_BURMESE_KEY,
  FONT_ROLES,
  classifyTextRole,
  isFile,
  registerPdfFonts,
  applyPdfRole,
} from "./fonts.mjs";
import { OUTPUT_FONT_DIR } from "../core/paths.mjs";

const BURMESE_DOCX_NAME = BURMESE_FONTS[DEFAULT_BURMESE_KEY].docx;
import { PdfWriter } from "./pdf-writer.mjs";
import { writeOptimizedPdf } from "./pdf-optimize.mjs";
import { ZipStreamWriter } from "../core/zip.mjs";
import { pyRound, RuntimeError } from "../core/pylib.mjs";

export function esc(s) {
  
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}


export function pdfLineHeight(pdf, role) {
  const cfg = FONT_ROLES[role];
  return pdf.fontSizePt * cfg.line_spacing / pdf.k;
}





export async function writePdf(outPath, texts, metadata, pdfPath, npages, log = () => {}) {
  const engReg = ANONYMOUS_PRO_FILES[""];
  if (!engReg || !isFile(engReg)) {
    throw new RuntimeError(
      `Anonymous Pro font not found in ${OUTPUT_FONT_DIR} (required for PDF output).`,
    );
  }

  const pdf = new PdfWriter();
  pdf.setFooter((self) => {
    self.setY(-15);
    applyPdfRole(self, "page_number");
    self.cell(0, pdfLineHeight(self, "page_number"), String(self.pageNo), { align: "C" });
  });
  pdf.setAutoPageBreak(true, 20);
  registerPdfFonts(pdf);

  const left = 18;
  const top = 18;

  const renderHeader = () => {
    pdf.setXY(left, top);
    applyPdfRole(pdf, "title");
    pdf.cell(0, pdfLineHeight(pdf, "title"), `Source: ${pdfPath}`, { newX: "LMARGIN", newY: "NEXT" });
    applyPdfRole(pdf, "meta");
    const metaItems = [["Pages", npages], ...Object.entries(metadata || {})];
    for (const [k, v] of metaItems) {
      pdf.cell(0, pdfLineHeight(pdf, "meta"), `${k}: ${v}`, { newX: "LMARGIN", newY: "NEXT" });
    }
    pdf.ln(5);
  };

  texts.forEach((txt, idx) => {
    pdf.addPage();
    pdf.setXY(left, top);
    if (idx === 0) {
      renderHeader();
      pdf.ln(3);
    }
    let prevBlank = true;
    for (const line of String(txt ?? "").split("\n")) {
      const role = classifyTextRole(line, prevBlank);
      if (role === "blank") {
        pdf.ln(pdfLineHeight(pdf, "paragraph") * 0.5);
        prevBlank = true;
        continue;
      }
      applyPdfRole(pdf, role);
      pdf.cell(0, pdfLineHeight(pdf, role), line, {
        newX: "LMARGIN", newY: "NEXT", align: FONT_ROLES[role].align,
      });
      prevBlank = false;
    }
  });

  
  
  
  await writeOptimizedPdf(outPath, pdf.toBuffer(), log);
  return outPath;
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


export async function writeDocxLayout(outPath, pages, pdfPath) {
  void pdfPath; 
  const n = pages.length;

  async function* body() {
    yield DOC_HEAD;
    for (let i = 0; i < n; i += 1) {
      const pg = pages[i];
      const chunk = [];
      const [wPt, hPt] = pg.wh ?? [612.0, 792.0];
      const lines = pg.lines ?? [];
      if (!lines.length && pg.hasImg) {
        chunk.push(layoutPara(20 * TWIPS, 20 * TWIPS, 10, "[image-only page]"));
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
        chunk.push(layoutPara(x * TWIPS, before * TWIPS, size, text));
      }
      if (i < n - 1) chunk.push(`<w:p><w:pPr>${sectPr(wPt, hPt)}</w:pPr></w:p>`);
      else chunk.push(sectPr(wPt, hPt));
      yield chunk.join("");
    }
    if (n === 0) yield sectPr(612.0, 792.0);
    yield "</w:body></w:document>";
  }

  const zip = new ZipStreamWriter(outPath);
  await zip.writestr("[Content_Types].xml", CONTENT_TYPES);
  await zip.writestr("_rels/.rels", RELS);
  await zip.member("word/document.xml").stream(body());
  await zip.close();
  return outPath;
}


export async function writeDocxPlain(outPath, text) {
  async function* body() {
    yield DOC_HEAD;
    const lines = String(text ?? "").split("\n");
    const step = 2000;
    for (let i = 0; i < lines.length; i += step) {
      const chunk = [];
      for (const line of lines.slice(i, i + step)) {
        if (line) chunk.push(layoutPara(0.0, 0.0, 11.0, line));
        else chunk.push("<w:p/>");
      }
      yield chunk.join("");
    }
    yield sectPr(612.0, 792.0);
    yield "</w:body></w:document>";
  }
  const zip = new ZipStreamWriter(outPath);
  await zip.writestr("[Content_Types].xml", CONTENT_TYPES);
  await zip.writestr("_rels/.rels", RELS);
  await zip.member("word/document.xml").stream(body());
  await zip.close();
  return outPath;
}
