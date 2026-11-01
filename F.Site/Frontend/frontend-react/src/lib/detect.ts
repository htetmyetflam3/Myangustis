import JSZip from "jszip";

export type DetectorName = "pdf.js" | "mammoth";

export type Detection = {
  parser: DetectorName;
  inputFormat: "pdf" | "docx";
  
  text: string;
  pages: number;
  textPages: number;
  imagePages: number;
  /** Number of pages actually inspected in the browser. Large PDFs are
   * sampled; the server still processes every page after upload. */
  sampledPages?: number;
  sampledTextPages?: number;
  sampledImagePages?: number;
  imageBytes: number;
  textBytes: number;
};


export const PDF_TEXT_MIN_CHARS = 24;

export const PAGE_TEXT_MIN_CHARS = 12;

export const DOCX_IMAGE_DOMINANCE = 3;
export const PDF_IMAGE_DOMINANCE = 20;
export const PDF_TEXT_BYTES_PER_PAGE = 120;
// Browser inspection only chooses a processing route. Parsing an entire book
// here duplicates the expensive server pass, so large PDFs use a spread sample.
export const PDF_INSPECTION_MAX_PAGES = 32;

const IMG_MARK = [0x2f, 0x53, 0x75, 0x62, 0x74, 0x79, 0x70, 0x65];
const IMAGE_WORD = [0x2f, 0x49, 0x6d, 0x61, 0x67, 0x65];
const STREAM = [0x73, 0x74, 0x72, 0x65, 0x61, 0x6d];
const ENDSTREAM = [0x65, 0x6e, 0x64, 0x73, 0x74, 0x72, 0x65, 0x61, 0x6d];

function at(bytes: Uint8Array, pos: number, pattern: number[]) {
  for (let k = 0; k < pattern.length; k += 1) if (bytes[pos + k] !== pattern[k]) return false;
  return true;
}
function find(bytes: Uint8Array, pattern: number[], from: number) {
  for (let i = from; i <= bytes.length - pattern.length; i += 1) if (at(bytes, i, pattern)) return i;
  return -1;
}
const isWs = (c: number) => c === 0x20 || (c >= 0x09 && c <= 0x0d);

export function pdfImageBytes(bytes: Uint8Array): number {
  let total = 0;
  let i = 0;
  while (i < bytes.length) {
    const mark = find(bytes, IMG_MARK, i);
    if (mark < 0) break;
    let j = mark + IMG_MARK.length;
    while (j < bytes.length && isWs(bytes[j])) j += 1;
    if (!at(bytes, j, IMAGE_WORD)) { i = mark + 1; continue; }
    const st = find(bytes, STREAM, j);
    if (st < 0) break;
    let body = st + STREAM.length;
    if (bytes[body] === 0x0d) body += 1;
    if (bytes[body] === 0x0a) body += 1;
    const end = find(bytes, ENDSTREAM, body);
    if (end < 0) break;
    total += end - body;
    i = end + ENDSTREAM.length;
  }
  return total;
}

const utf8 = (value: string) => new TextEncoder().encode(value).length;





type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfjsRuntime = {
  pdfjs: PdfjsModule;
  Worker: new (options?: { name?: string }) => Worker;
};
let pdfjsPromise: Promise<PdfjsRuntime> | null = null;

async function loadPdfjs(): Promise<PdfjsRuntime> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [pdfjs, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        // Vite embeds the PDF.js worker in a Blob-backed Worker, avoiding a
        // separate .mjs request that production static hosts may mis-serve.
        import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline"),
      ]);
      return { pdfjs, Worker: worker.default };
    })();
  }
  return pdfjsPromise;
}

export async function detectPdf(file: Blob): Promise<Detection> {
  const { pdfjs, Worker: PdfjsWorker } = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const imageBytes = pdfImageBytes(data);
  const pdfWorker = pdfjs.PDFWorker.create({ port: new PdfjsWorker() });
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: false,
    verbosity: 0,
    worker: pdfWorker,
  });

  try {
    const doc = await task.promise;
    const pages = doc.numPages;

    const imageOps = new Set<number>([
      pdfjs.OPS.paintImageXObject,
      pdfjs.OPS.paintInlineImageXObject,
      pdfjs.OPS.paintImageMaskXObject,
    ]);

    const sampleCount = Math.min(pages, PDF_INSPECTION_MAX_PAGES);
    const pageNumbers = Array.from({ length: sampleCount }, (_, index) =>
      sampleCount === 1 ? 1 : 1 + Math.round((index * (pages - 1)) / (sampleCount - 1)),
    );
    const parts: string[] = [];
    let sampledTextPages = 0;
    let sampledImagePages = 0;

    for (const n of pageNumbers) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join("");
      parts.push(pageText);

      if (pageText.replace(/\s/g, "").length >= PAGE_TEXT_MIN_CHARS) {
        sampledTextPages++;
        page.cleanup();
        continue;
      }

      const ops = await page.getOperatorList();
      if (ops.fnArray.some((fn: number) => imageOps.has(fn))) sampledImagePages++;
      page.cleanup();
    }

    const text = parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    const scale = pages / sampleCount;
    const textPages = Math.min(pages, Math.round(sampledTextPages * scale));
    const imagePages = Math.min(pages - textPages, Math.round(sampledImagePages * scale));
    const sampledTextBytes = utf8(text);
    const textBytes = Math.round(sampledTextBytes * scale);

    return {
      parser: "pdf.js",
      inputFormat: "pdf",
      text,
      pages,
      sampledPages: sampleCount,
      sampledTextPages,
      sampledImagePages,
      textPages,
      imagePages,
      imageBytes,
      textBytes,
    };
  } finally {
    // getDocument does not own a PDFWorker supplied by the caller.
    await task.destroy().catch(() => {});
    pdfWorker.destroy();
  }
}





const MEDIA_PARTS = /^word\/media\//i;

export async function detectDocx(file: Blob): Promise<Detection> {
  const buffer = await file.arrayBuffer();
  const mammoth = await import("mammoth");
  const extract = mammoth.extractRawText ?? (mammoth as any).default?.extractRawText;
  
  
  const B = (globalThis as any).Buffer;
  const input =
    typeof window === "undefined" && B ? { buffer: B.from(buffer) } : { arrayBuffer: buffer };
  const { value } = await extract(input);
  const text = String(value ?? "").trim();

  
  
  let imageBytes = 0;
  const zip = await JSZip.loadAsync(buffer);
  for (const name of Object.keys(zip.files)) {
    const entry = zip.files[name];
    if (entry.dir || !MEDIA_PARTS.test(name)) continue;
    imageBytes += (await entry.async("uint8array")).length;
  }

  return {
    parser: "mammoth",
    inputFormat: "docx",
    text,
    
    pages: 0,
    textPages: 0,
    imagePages: 0,
    imageBytes,
    textBytes: utf8(text),
  };
}

export async function detect(file: File): Promise<Detection | null> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) return detectPdf(file);
  if (lower.endsWith(".docx")) return detectDocx(file);
  return null;
}
