import fs from "node:fs";
import path from "node:path";
import { writeDocxLayout, writeDocxPlain, writePdf } from "./render.mjs";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../core/limits.mjs";

const MIME_TYPES = {
  ".txt": "text/plain",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pdf": "application/pdf",
};

function header(source, pages, counts) {
  const c = counts || {};
  return (
    [
      `# Source: ${source || "-"}`,
      `# Pages: ${pages.length}`,
      `# Detection: ${c.ZAWGYI ?? 0} Zawgyi, ${c.UNICODE ?? 0} Unicode, ${c.UNKNOWN ?? 0} unknown`,
      "#".repeat(50),
    ].join("\n") + "\n\n"
  );
}


function countLines(texts) {
  let n = 0;
  for (const t of texts) if (t) n += t.split("\n").length;
  return n;
}


export async function writeOutput(outPath, pages, { counts = {}, source = "", log = () => {} } = {}) {
  let out = outPath;
  let ext = path.extname(out).toLowerCase();
  if (ext === "") {
    ext = ".txt";
    out += ".txt";
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });

  if (!Array.isArray(pages) || pages.length > MAX_PAGES) {
    throw new Error(`Output exceeds the ${MAX_PAGES} page cap`);
  }
  const norm = pages.map((p) => (typeof p === "string" ? { text: p } : p || { text: "" }));
  const texts = norm.map((p) => p.text ?? "");
  let textChars = 0;
  for (const text of texts) {
    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new Error(`Output text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
  }
  const joined = texts.join("\n\n");

  if (ext === ".txt") {
    let body = header(source, norm, counts);
    for (let i = 0; i < texts.length; i += 1) {
      body += `--- Page ${i + 1} ---\n${texts[i] || ""}\n\n`;
    }
    fs.writeFileSync(out, body, "utf8");
  } else if (ext === ".docx") {
    
    
    if (norm.some((p) => Array.isArray(p.lines))) {
      await writeDocxLayout(out, norm, source);
    } else {
      await writeDocxPlain(out, joined);
    }
  } else if (ext === ".pdf") {
    await writePdf(out, texts, {}, source, texts.length, log);
  } else {
    throw new Error(`Unsupported output type: ${ext} (use .txt/.docx/.pdf)`);
  }

  const result = {
    file: out,
    lineCount: countLines(texts),
    textChars: joined.length,
    textBytes: Buffer.byteLength(joined, "utf8"),
    mimeType: MIME_TYPES[ext],
  };
  if (ext === ".docx") result.text = joined;
  return result;
}

