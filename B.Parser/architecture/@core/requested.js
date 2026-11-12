/*
(output/requested) The requested file creator - last link of the chain.
This door wraps the two document writers (pdf/write.js renders a
PDF, docx/write.js renders a DOCX) and the plain txt write below:
it creates whichever file was requested.
Finished pages come in (text, plus layout lines when the source
had them); the requested file comes out. The conversion IS the
dispatch: the target format is chosen by the output name, the
source kind only decides how much layout the pages can offer -
  PDF pages -> .docx   layout lines become positioned paragraphs
  DOCX pages -> .pdf   paragraph text is laid out and rendered
  anything  -> .txt    plain paged text
One function, three writers beneath it (core/io/compose.js renders
the real DOCX/PDF; txt is written here). Caps from the input
stage's limit home; owner jobs are uncapped there already.
*/
import fs from "node:fs";
import path from "node:path";
import { writePdf } from "../../@output/pdf/write.js";
import { writeDocxMarkup } from "../@output/docx/write.js";
import { stripMarkup } from "../@output/helper/markup.js";
import { normalizeOutputType } from "../@output/helper/output-type.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../@entry/helper/limit.js";

const MIME_TYPES = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};

function header(source, pages, counts) {
  const c = counts || {};
  return [
    `# Source: ${source || "-"}`,
    `# Pages: ${pages.length}`,
    `# Detection: ${c.ZAWGYI ?? 0} Zawgyi, ${c.UNICODE ?? 0} Unicode, ${c.UNKNOWN ?? 0} unknown`,
    "#".repeat(50),
  ].join("\n") + "\n\n";
}

// pages: [{ text, lines?, wh? }] or plain strings. Returns where
// the file landed and what conversion, if any, that meant.
export async function writeOutputFile(pages, outPath, {
  source = "", sourceKind = null, counts = {}, log = () => {},
} = {}) {
  if (!outPath || typeof outPath !== "string") {
    throw new TypeError("requested: output path is required");
  }
  let out = outPath;
  let ext = path.extname(out).toLowerCase().replace(/^\./, "");
  if (!ext) { ext = "txt"; out += ".txt"; }
  const to = normalizeOutputType(ext); // throws on anything but pdf/docx/txt

  const norm = (Array.isArray(pages) ? pages : []).map((p) =>
    typeof p === "string" ? { text: p } : (p ?? { text: "" }));
  if (norm.length > MAX_PAGES) throw new Error("Output exceeds the page cap");
  let textChars = 0;
  for (const p of norm) {
    textChars += String(p.text ?? "").length;
    if (textChars > MAX_TEXT_CHARS) throw new Error("Output text exceeds the character cap");
  }
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

  if (to === "txt") {
    let body = header(source, norm, counts);
    norm.forEach((p, i) => { body += `--- Page ${i + 1} ---\n${stripMarkup(p.text ?? "")}\n\n`; });
    fs.writeFileSync(out, body, "utf8");
  } else if (to === "docx") {
    // Pages are marked-up strings; the writer renders the markup.
    await writeDocxMarkup(out, norm.map((p) => p.text ?? ""));
  } else {
    await writePdf(out, norm.map((p) => p.text ?? ""), {}, source, norm.length, log);
  }

  const from = sourceKind ? String(sourceKind).toLowerCase() : null;
  return {
    file: out,
    from,
    to,
    converted: from !== null && from !== to,
    mimeType: MIME_TYPES[to],
    pages: norm.length,
    textChars,
    size: fs.statSync(out).size,
  };
}
