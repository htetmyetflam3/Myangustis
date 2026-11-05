import { PageStoreWriter, pageRecords, textChunks } from "./page-store.js";
import { writePageStore } from "./emit.js";
import { PosScanner } from "./scan.js";
import { normalizeOutputText } from "./preserved-transform.js";
import { getEngineNormalize } from "../../../../_path.js";

// DOCX extraction already holds paragraph chunks in memory. Merge OCR into
// those source chunks before writing any output or assigning POS locations;
// their 80-paragraph boundaries are not physical page boundaries.
export async function finishManualDocx({
  pageStore, directory, outPath, source, counts, includeText, owner, imageFiles, ocr,
}) {
  const recognized = new Map();
  for (const item of ocr) {
    if (typeof item?.id !== "string" || typeof item.text !== "string") {
      throw new Error("DOCX OCR did not return image text");
    }
    recognized.set(item.id, item.text);
  }
  const replacements = new Map();
  for (const image of imageFiles) {
    if (typeof image.marker !== "string" || !recognized.has(image.id)) {
      throw new Error(`DOCX OCR did not return image ${image.id}`);
    }
    replacements.set(image.marker, recognized.get(image.id));
  }
  const used = new Set();
  const normalize = await getEngineNormalize();
  const finalPages = new PageStoreWriter(directory, "merged");
  let scanner;
  try {
    scanner = new PosScanner({ directory });
    for await (const page of pageRecords(pageStore.indexPath)) {
      const text = [...textChunks(pageStore.textPath, page.start, page.length)].join("");
      const merged = text.replace(/\uE000OCR-[0-9a-f-]{36}-\d+\uE001/gu, (marker) => {
        if (!replacements.has(marker)) return marker;
        used.add(marker);
        return replacements.get(marker);
      });
      const output = normalizeOutputText(merged, normalize);
      finalPages.addPage({ text: [output] });
      await scanner.writePage(null, [output]);
    }
    if (used.size !== replacements.size) throw new Error("DOCX image placeholders were not preserved during parsing");
    finalPages.close();
    const written = await writePageStore(outPath, finalPages.store, {
      directory, counts, source, includeText, owner, layout: false,
    });
    const posScan = await scanner.finish(written.file);
    return { ...written, posScan };
  } finally {
    try { await scanner?.close(); } finally { finalPages.close(); }
    // The Manager owns the enclosing directory and removes it after this call.
  }
}
