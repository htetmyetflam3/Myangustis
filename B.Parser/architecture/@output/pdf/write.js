/*
(output/pdf) The PDF output module: render finished pages into a PDF file.
Text arrives finished (one entry per page); each page is laid out
line by line with its role's font (title/meta/body/page number),
written by PdfWriter to a first-pass file, then qpdf-optimized
when available (writeOptimizedPdf keeps the first pass if not).
Shared helpers live in ../helper/.
*/
import {
  ANONYMOUS_PRO_FILES, FONT_ROLES, classifyTextRole, isFile,
  registerPdfFonts, applyPdfRole,
} from "../helper/output-fonts.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUTPUT_FONT_DIR } from "../../_path.js";
import { PdfWriter } from "../../@core/runtime/pdf-writer.js";
import { writeOptimizedPdf } from "../../@core/runtime/optimize.js";
import { RuntimeError } from "../../@helper/pylib.js";
import { parseMarkup } from "../helper/markup.js";

export function pdfLineHeight(pdf, role) {
  const cfg = FONT_ROLES[role];
  return pdf.fontSizePt * cfg.line_spacing / pdf.k;
}

export async function writePdf(outPath, texts, metadata, pdfPath, npages, log = () => {}, workDir = null) {
  const engReg = ANONYMOUS_PRO_FILES[""];
  if (!engReg || !isFile(engReg)) {
    throw new RuntimeError(
      `Anonymous Pro font not found in ${OUTPUT_FONT_DIR} (required for PDF output).`,
    );
  }

  const directory = fs.mkdtempSync(workDir
    ? path.join(workDir, "pdf-output-") : path.join(os.tmpdir(), "linga-pdf-output-"));
  let pdf;
  try {
  pdf = new PdfWriter(directory);
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

  let idx = 0;
  for await (const txt of texts) {
    pdf.addPage();
    pdf.setXY(left, top);
    if (idx === 0) {
      renderHeader();
      pdf.ln(3);
    }
    // Marked-up page string: headings and paragraph breaks come from
    // the markup; bold/italic apply per line (a line wholly wrapped in
    // <b>/<i> takes that role - mixed runs take the paragraph role).
    for (const block of parseMarkup(txt)) {
      for (const runs of block.lines) {
        const line = runs.map((run) => run.text).join("");
        if (!line.trim()) continue;
        const role = block.tag === "h1" ? "title"
          : block.tag === "h2" ? "heading"
          : runs.length && runs.every((run) => run.bold) ? "bold"
          : runs.length && runs.every((run) => run.italic) ? "italic"
          : "paragraph";
        applyPdfRole(pdf, role);
        pdf.cell(0, pdfLineHeight(pdf, role), line, {
          newX: "LMARGIN", newY: "NEXT", align: FONT_ROLES[role].align,
        });
      }
      pdf.ln(pdfLineHeight(pdf, "paragraph") * 0.5);
    }
    idx += 1;
  }

  const firstPass = path.join(directory, "first-pass.pdf");
  await pdf.output(firstPass);
  await writeOptimizedPdf(outPath, firstPass, log);
  return outPath;
  } finally {
    pdf?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
