import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeDocxLayout, writeDocxPlain, writePdf } from "./render.js";
import { PdfTextSink } from "../pdf/pdf-text-sink.js";
import { layoutLines, pageRecords, textChunks } from "../page/page-spool.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../limits/local.js";

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


async function* storedPages(store) {
  for await (const page of pageRecords(store.indexPath)) {
    yield {
      ...page,
      textChunks: () => textChunks(store.textPath, page.start, page.length),
      lines: () => layoutLines(store, page),
    };
  }
}

// The same page spool feeds each output format; PDF bytes and other pages do
// not have to be collected while the current page is being rendered.
export async function writePageStore(outPath, store, {
  directory, counts = {}, source = "", log = () => {}, includeText = false, owner = false, layout = true,
} = {}) {
  let out = outPath;
  let ext = path.extname(out).toLowerCase();
  if (!ext) { ext = ".txt"; out += ext; }
  if (!(ext in MIME_TYPES)) throw new Error(`Unsupported output type: ${ext} (use .txt/.docx/.pdf)`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (ext === ".txt") {
    const sink = new PdfTextSink(directory, { includeText, owner });
    try {
      for await (const page of storedPages(store)) sink.addPage(page.textChunks());
      return sink.finish(outPath, counts, source);
    } finally { sink.close(); }
  }

  const wantText = ext === ".docx" || includeText;
  const joinedPath = wantText ? path.join(directory, `joined-${randomUUID()}.txt`) : null;
  let joinedFd = null;
  let pages = 0;
  let pageChars = 0;
  let textChars = 0;
  let textBytes = 0;
  let lineCount = 0;
  const writeJoined = (chunk) => {
    if (joinedFd == null) return;
    const bytes = Buffer.from(chunk, "utf8");
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.writeSync(joinedFd, bytes, offset, bytes.length - offset);
      if (!count) throw new Error("Could not write the joined page text");
      offset += count;
    }
  };
  try {
    if (joinedPath) joinedFd = fs.openSync(joinedPath, "wx", 0o600);
    for await (const page of storedPages(store)) {
      if (!owner && pages >= MAX_PAGES) throw new Error(`Output exceeds the ${MAX_PAGES} page cap`);
      if (pages) { textChars += 2; textBytes += 2; writeJoined("\n\n"); }
      pages += 1;
      let nonempty = false;
      let newlines = 0;
      for (const chunk of page.textChunks()) {
        if (!chunk) continue;
        nonempty = true;
        pageChars += chunk.length;
        if (!owner && pageChars > MAX_TEXT_CHARS) throw new Error(`Output text exceeds the ${MAX_TEXT_CHARS} character cap`);
        textChars += chunk.length;
        textBytes += Buffer.byteLength(chunk, "utf8");
        for (const char of chunk) if (char === "\n") newlines += 1;
        writeJoined(chunk);
      }
      if (nonempty) lineCount += newlines + 1;
    }
    if (joinedFd != null) fs.closeSync(joinedFd);
    joinedFd = null;
    if (ext === ".docx") {
      if (layout) await writeDocxLayout(out, storedPages(store), source, pages);
      else await writeDocxPlain(out, textChunks(joinedPath));
    } else {
      await writePdf(out, storedPages(store), {}, source, pages, log, directory);
    }
    return {
      file: out, lineCount, textChars, textBytes, mimeType: MIME_TYPES[ext],
      ...(wantText ? { text: fs.readFileSync(joinedPath, "utf8") } : {}),
    };
  } finally {
    if (joinedFd != null) fs.closeSync(joinedFd);
    if (joinedPath) fs.rmSync(joinedPath, { force: true });
  }
}

export async function writeOutput(outPath, pages, {
  counts = {}, source = "", log = () => {}, includeText = false, owner = false,
} = {}) {
  let out = outPath;
  let ext = path.extname(out).toLowerCase();
  if (ext === "") {
    ext = ".txt";
    out += ".txt";
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });

  const maxPages = owner ? Infinity : MAX_PAGES;
  const maxTextChars = owner ? Infinity : MAX_TEXT_CHARS;
  if (!Array.isArray(pages) || pages.length > maxPages) {
    throw new Error(`Output exceeds the ${maxPages} page cap`);
  }
  const norm = pages.map((p) => (typeof p === "string" ? { text: p } : p || { text: "" }));
  const texts = norm.map((p) => p.text ?? "");
  let textChars = 0;
  for (const text of texts) {
    textChars += text.length;
    if (textChars > maxTextChars) {
      throw new Error(`Output text exceeds the ${maxTextChars} character cap`);
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
  if (ext === ".docx" || includeText) result.text = joined;
  return result;
}

