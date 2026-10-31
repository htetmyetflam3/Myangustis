import { PDFContext, PDFName, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { PdfName, PdfRef } from "./pdf-fonts.js";

const STREAM = Buffer.from("stream");
const ENDSTREAM = Buffer.from("endstream");
const READ_SIZE = 64 * 1024;
export const PAGE_CONTENT_PREFIX_BYTES = 2048;

function streamReferences(loader, value, depth = 0) {
  if (depth > 32) throw new Error("PDF contents reference nesting is too deep");
  if (value instanceof PdfRef) {
    const object = loader.objectValue(value);
    return Array.isArray(object) ? streamReferences(loader, object, depth + 1) : [value];
  }
  if (Array.isArray(value)) return value.flatMap((item) => streamReferences(loader, item, depth + 1));
  return [];
}

function asPdfObject(context, loader, value, depth = 0) {
  if (depth > 32) throw new Error("PDF stream parameters are nested too deeply");
  value = loader.resolve(value);
  if (value instanceof PdfName) return PDFName.of(String(value));
  if (Array.isArray(value)) return context.obj(value.map((item) => asPdfObject(context, loader, item, depth + 1)));
  if (value instanceof Map) {
    const dict = context.obj({});
    for (const [key, entry] of value) dict.set(PDFName.of(key), asPdfObject(context, loader, entry, depth + 1));
    return dict;
  }
  return context.obj(value);
}

function encodedStream(loader, ref) {
  const raw = loader.objects.get(ref.key());
  const dictionary = loader.objectValue(ref);
  if (!raw || !(dictionary instanceof Map)) throw new Error(`Missing PDF content stream ${ref}`);
  let at = -1;
  let search = 0;
  while ((at = raw.indexOf(STREAM, search)) !== -1) {
    const before = at ? raw[at - 1] : 0x20;
    const after = raw[at + STREAM.length];
    if ((before === 0x3e || before <= 0x20) && (after === 0x0a || after === 0x0d)) break;
    search = at + STREAM.length;
  }
  if (at < 0) throw new Error(`PDF contents ${ref} is not a stream`);
  let start = at + STREAM.length;
  if (raw[start] === 0x0d) start += 1;
  if (raw[start] === 0x0a) start += 1;
  const end = raw.lastIndexOf(ENDSTREAM);
  const length = loader.resolve(dictionary.get("Length"));
  if (!Number.isSafeInteger(length) || length < 0 || end < start || start + length > end) {
    throw new Error(`Invalid PDF content stream length for ${ref}`);
  }
  return { bytes: raw.subarray(start, start + length), dictionary };
}

function openStream(loader, ref, maxBytes) {
  const { bytes, dictionary } = encodedStream(loader, ref);
  const parms = loader.resolve(dictionary.get("DecodeParms"));
  const list = Array.isArray(parms) ? parms : [parms];
  if (list.some((entry) => {
    const value = loader.resolve(entry);
    const predictor = value instanceof Map ? loader.resolve(value.get("Predictor")) : null;
    return predictor != null && Number(predictor) !== 1;
  })) throw new Error(`PDF content stream ${ref} uses an unsupported predictor`);

  const context = PDFContext.create();
  const streamDictionary = context.obj({});
  for (const key of ["Filter", "DecodeParms"]) {
    const value = dictionary.get(key);
    if (value != null) streamDictionary.set(PDFName.of(key), asPdfObject(context, loader, value));
  }
  const reader = decodePDFRawStream(PDFRawStream.of(streamDictionary, bytes));
  // Each filter in a chain can allocate a decoded buffer. Enforce the cap on
  // every stage, including the first block read while examining the prefix.
  for (let stage = reader; stage; stage = stage.stream) {
    if (typeof stage.ensureBuffer !== "function") continue;
    const ensure = stage.ensureBuffer.bind(stage);
    stage.ensureBuffer = (requested) => {
      if (requested > maxBytes + 1) throw new Error(`PDF content stream exceeds the ${maxBytes} byte cap`);
      return ensure(requested);
    };
  }
  return { reader, fragments: [], size: 0, maxBytes };
}

function readFromStream(state, requested) {
  const size = Math.min(requested, state.maxBytes - state.size + 1);
  const bytes = state.reader.getBytes(size);
  state.size += bytes.length;
  if (state.size > state.maxBytes) throw new Error(`PDF content stream exceeds the ${state.maxBytes} byte cap`);
  // DecodeStream may grow its backing buffer when the same decoder resumes.
  const copy = Buffer.from(bytes);
  if (copy.length) state.fragments.push(copy);
  return copy;
}

// The prefix is inspected before the same filter instances are resumed. The
// returned stream buffers contain that prefix exactly once, in their original
// stream boundaries; it is not parsed separately or decompressed again.
export function readPageContent(loader, pageNum, pageGen, { maxBytes, inspect = () => {} } = {}) {
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
    throw new RangeError("A content stream limit is required");
  }
  const page = loader.resolve(new PdfRef(pageNum, pageGen));
  const references = page instanceof Map ? streamReferences(loader, page.get("Contents")) : [];
  const streams = references.map((ref) => openStream(loader, ref, maxBytes));
  const prefix = [];
  let remaining = PAGE_CONTENT_PREFIX_BYTES;
  for (const state of streams) {
    if (!remaining) break;
    const part = readFromStream(state, remaining);
    prefix.push(part);
    remaining -= part.length;
  }
  inspect(Buffer.concat(prefix), references);
  for (const state of streams) {
    while (readFromStream(state, READ_SIZE).length) { /* continue the same decoder */ }
  }
  return { references, streams: streams.map((state) => Buffer.concat(state.fragments, state.size)) };
}
