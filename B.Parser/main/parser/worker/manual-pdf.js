import fs from "node:fs";
import path from "node:path";
import { copyTextFile } from "../write/pdf-text-sink.js";
import { writePageStore } from "../write/emit.js";
import { PageStoreWriter, layoutLines, pageRecords, textChunks } from "../read/page-store.js";
import { PosScanner } from "../text/scan.js";

function writeAll(fd, value) {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
}

function copyRange(file, start, length, out) {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let offset = 0;
  try {
    while (offset < length) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - offset), start + offset);
      if (!count) throw new Error("Unexpected end of PDF page text spool");
      offset += count;
      writeAll(out, buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
}

const normalized = (line) => String(line || "").trim().replace(/\s+/gu, " ");

function existingLinesMatching(file, candidates) {
  const wanted = new Set(candidates.filter(Boolean));
  if (!wanted.size) return new Set();
  let maxLength = 0;
  for (const line of wanted) maxLength = Math.max(maxLength, line.length);
  const found = new Set();
  let line = "";
  let pendingSpace = false;
  let overflow = false;
  const finish = () => {
    if (!overflow && wanted.has(line)) found.add(line);
    line = "";
    pendingSpace = false;
    overflow = false;
  };
  for (const chunk of textChunks(file)) {
    for (const char of chunk) {
      if (char === "\n") { finish(); continue; }
      if (overflow) continue;
      if (/\s/u.test(char)) {
        if (line) pendingSpace = true;
        continue;
      }
      if (pendingSpace) line += " ";
      pendingSpace = false;
      line += char;
      if (line.length > maxLength) { line = ""; overflow = true; }
    }
  }
  finish();
  return found;
}

function mergeOcr(pageFile, scratch, hasText, text, fullPage) {
  const lines = String(text || "").split("\n");
  const keys = lines.map(normalized);
  const seen = existingLinesMatching(pageFile, keys);
  const extra = lines.filter((line, i) => line.trim() && !seen.has(keys[i])).join("\n");
  if (!extra) return { hasText, changed: false };
  const next = path.join(scratch, "page-merged.txt");
  const out = fs.openSync(next, "w", 0o600);
  try {
    if (fullPage) {
      writeAll(out, extra);
      if (hasText) { writeAll(out, "\n"); copyTextFile(pageFile, out); }
    } else {
      if (hasText) { copyTextFile(pageFile, out); writeAll(out, "\n"); }
      writeAll(out, extra);
    }
  } finally {
    fs.closeSync(out);
  }
  fs.renameSync(next, pageFile);
  return { hasText: true, changed: true };
}

export async function finishManualPdf({
  pageStore, sourcePath, directory, outPath, source, counts, includeText, owner,
  maxOcrPages, pageHasImage, ocrPage, ocrRegion,
}) {
  const planPath = path.join(directory, "ocr-plan.jsonl");
  const planFd = fs.openSync(planPath, "wx", 0o600);
  const ocrPages = [];
  try {
    for await (const page of pageRecords(pageStore.indexPath)) {
      const tasks = [];
      const images = Array.isArray(page.images) ? page.images : [];
      if (images.some((image) => image.pageSized)) {
        tasks.push({ fullPage: true });
      } else if (images.length) {
        for (const image of images) tasks.push({ bbox: image.bbox });
      } else if (!page.hasText) {
        const hasImage = page.hasImg || await pageHasImage(sourcePath, page.index + 1);
        if (hasImage) tasks.push({ fullPage: true });
      }
      if (tasks.length) ocrPages.push(page.index + 1);
      writeAll(planFd, JSON.stringify({ ...page, tasks }) + "\n");
    }
  } finally {
    fs.closeSync(planFd);
  }
  if (!owner && ocrPages.length > maxOcrPages) {
    throw new Error(`PDF has ${ocrPages.length} image pages; the OCR lane accepts at most ${maxOcrPages} at a time`);
  }

  const finalPages = new PageStoreWriter(directory, "final");
  const scanner = new PosScanner({ directory });
  const currentPage = path.join(directory, "ocr-page.txt");
  try {
    for await (const page of pageRecords(planPath)) {
      let chunks = textChunks(pageStore.textPath, page.start, page.length);
      let changed = false;
      if (page.tasks.length) {
        const out = fs.openSync(currentPage, "w", 0o600);
        try { copyRange(pageStore.textPath, page.start, page.length, out); } finally { fs.closeSync(out); }
        let hasText = page.hasText;
        for (const task of page.tasks) {
          const text = task.fullPage
            ? await ocrPage(sourcePath, page.index + 1)
            : await ocrRegion(sourcePath, page.index + 1, task.bbox);
          if (typeof text !== "string") throw new Error(`OCR did not return text for page ${page.index + 1}`);
          const merged = mergeOcr(currentPage, directory, hasText, text, task.fullPage);
          hasText = merged.hasText;
          changed ||= merged.changed;
        }
        chunks = textChunks(currentPage);
      }
      await scanner.writePage(page.index + 1, page.tasks.length
        ? textChunks(currentPage) : textChunks(pageStore.textPath, page.start, page.length));
      finalPages.addPage({
        text: chunks,
        lines: changed ? [] : layoutLines(pageStore, page),
        wh: page.wh, images: page.images ?? [], hasImg: changed || page.hasImg === true,
      });
    }
    finalPages.close();
    const written = await writePageStore(outPath, finalPages.store, {
      directory, counts, source, includeText, owner,
    });
    const posScan = await scanner.finish(written.file);
    return { ...written, ocrPages, posScan };
  } finally {
    await scanner.close();
    finalPages.close();
  }
}
