/*
(PDF 11) PDF branch, position 11 in the chain - called by the orchestrator (PDF 10) before any page text is read.
This module decodes only what lives outside the PDF's streams - the dictionaries - and reports per-page instructions: page order, size, fonts and content references. Stream bodies are never opened here.
*/
// Outside-stream decoding: read only the parts of a PDF that live
// OUTSIDE object streams, and translate what is found into per-page
// instructions. Stream bodies are NEVER opened here: stream objects are
// reported as references ("not decoded"), with only their dictionary
// (which lives outside the stream) read.
//
// This is the parser's page-discovery layer: page order, geometry, font
// chains and content references are all decidable from dictionaries
// alone, so no content stream is decoded to learn what a document
// contains. The stream parser consumes these instructions; it does not
// walk the page tree itself.
import { openPdfScannedObjects } from "./pdf-objects.js";
import { ValueError } from "../pylib.js";
import { MAX_PAGES } from "../limits/local.js";

const keyOf = (num, gen) => `${num},${gen}`;
export const refText = (key) => {
  const [num, gen] = key.split(",");
  return `${num} ${gen} R`;
};

function fieldRef(text, name) {
  const m = new RegExp(`/${name}\\s+\\[?\\s*(\\d+)\\s+(\\d+)\\s+R`).exec(text);
  return m ? keyOf(m[1], m[2]) : null;
}

function fieldName(text, name) {
  const m = new RegExp(`/${name}\\s*/([A-Za-z0-9+._-]+)`).exec(text);
  return m ? m[1] : null;
}

function fieldRefs(text) {
  return [...text.matchAll(/(\d+)\s+(\d+)\s+R/gu)].map((m) => keyOf(m[1], m[2]));
}

// Decode a PDF string token: (literal) or <hex>, incl. UTF-16BE with BOM.
function decodePdfString(token) {
  if (!token) return null;
  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/gu, "");
    const bytes = Buffer.from(hex, "hex");
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      return bytes.subarray(2).swap16().toString("utf16le");
    }
    return bytes.toString("latin1");
  }
  return token.slice(1, -1).replace(/\\([nrtbf()\\])/gu, (_, c) => (
    { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[c] ?? c
  ));
}

function fieldString(text, name) {
  const m = new RegExp(`/${name}\\s*(\\((?:\\\\.|[^\\\\()])*\\)|<[^>]*>)`).exec(text);
  return m ? decodePdfString(m[1]) : null;
}

// [x0 y0 x1 y1] -> [width, height]; null when absent or degenerate (the
// caller then falls back to reading the box from the objects itself).
function boxSize(box) {
  if (!box) return null;
  const nums = (box.value.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu) ?? []).map(Number);
  if (nums.length !== 4 || !nums.every(Number.isFinite)) return null;
  const [x0, y0, x1, y1] = nums;
  if (x0 === x1 || y0 === y1) return null;
  return [Math.abs(x1 - x0), Math.abs(y1 - y0)];
}

// A page object is not required to declare /Type /Page first — or at
// all in the first nested dictionary (a transparency /Group carries its
// own /Type). Leaf classification therefore scans the whole dictionary
// text for the page type token, exactly as the page-tree walk this pass
// replaces always did.
const PAGE_TYPE_RE = /\/Type\s*\/Page(?!s)/u;
const CATALOG_TYPE_RE = /\/Type\s*\/Catalog/u;

function buildInstructions(objects, { census = false } = {}) {
  const texts = new Map(); // "num,gen" -> dictionary text (never stream bytes)
  const dictText = (key) => {
    if (!texts.has(key)) {
      const dict = objects.dictionary(key);
      texts.set(key, dict === undefined ? "" : Buffer.from(dict).toString("latin1"));
    }
    return texts.get(key);
  };
  const entryOf = (key) => objects.entries.get(key);
  const hasStream = (key) => {
    dictText(key);
    return entryOf(key)?.streamStart !== undefined;
  };

  // Walk /Parent until an inheritable field (/MediaBox, /Rotate) is defined.
  function inherited(pageKey, pattern) {
    let key = pageKey;
    let own = true;
    while (key) {
      const text = dictText(key);
      const m = pattern.exec(text);
      if (m) return { value: m[1] ?? m[0], from: key, own };
      key = fieldRef(text, "Parent");
      own = false;
    }
    return null;
  }

  // Slice the balanced << ... >> dictionary starting at index `at`.
  function dictSlice(text, at) {
    let depth = 0;
    for (let i = at; i < text.length - 1; i++) {
      const pair = text.slice(i, i + 2);
      if (pair === "<<") { depth++; i++; }
      else if (pair === ">>") { depth--; i++; if (depth === 0) return text.slice(at, i + 1); }
    }
    return text.slice(at);
  }

  // Structured font facts, decidable from the font dictionary alone. The
  // summary string is the experiment's text form of the same facts.
  function fontFacts(fontKey) {
    return factsOf(dictText(fontKey));
  }

  function factsOf(text) {
    const subtype = fieldName(text, "Subtype") ?? "?";
    const base = fieldName(text, "BaseFont") ?? "?";
    const parts = [`${subtype} ${base}`];
    const encodingRef = fieldRef(text, "Encoding");
    const encodingName = fieldName(text, "Encoding");
    if (encodingName) parts.push(`encoding ${encodingName}`);
    else if (encodingRef) parts.push(`encoding -> object ${refText(encodingRef)}`);
    const toUnicodeKey = fieldRef(text, "ToUnicode");
    if (toUnicodeKey) parts.push(`ToUnicode -> object ${refText(toUnicodeKey)} (stream, not decoded)`);
    // Embedded? Follow FontDescriptor directly, or via Type0 descendant.
    let descriptorKey = fieldRef(text, "FontDescriptor");
    if (!descriptorKey) {
      const descendant = fieldRef(text, "DescendantFonts");
      if (descendant) descriptorKey = fieldRef(dictText(descendant), "FontDescriptor");
    }
    let embedded = null;
    if (descriptorKey) {
      const descriptor = dictText(descriptorKey);
      const fileKey = fieldRef(descriptor, "FontFile2") ?? fieldRef(descriptor, "FontFile3") ?? fieldRef(descriptor, "FontFile");
      embedded = Boolean(fileKey);
      parts.push(fileKey
        ? `embedded font file -> object ${refText(fileKey)} (stream, not decoded)`
        : "not embedded");
    }
    return {
      summary: parts.join(", "),
      subtype,
      baseFont: base,
      encoding: encodingName ?? (encodingRef ? refText(encodingRef) : null),
      toUnicode: Boolean(toUnicodeKey),
      embedded,
    };
  }

  // The page fonts, wherever the dictionaries keep them: inline in the page
  // dictionary, inside an indirect /Resources object, or inherited from a
  // parent node. The /Font dictionary itself may also be indirect, and a
  // font entry may be an inline dictionary instead of a reference.
  function fontEntriesIn(text) {
    const fontAt = text.indexOf("/Font");
    if (fontAt < 0) return null;
    const after = text.slice(fontAt + "/Font".length);
    const indirect = /^\s*(\d+)\s+(\d+)\s+R/u.exec(after);
    const segment = indirect
      ? dictText(keyOf(indirect[1], indirect[2]))
      : dictSlice(after, after.indexOf("<<"));
    const entries = [];
    const entryPattern = /\/([A-Za-z0-9]+)\s+(?:(\d+)\s+(\d+)\s+R|<<)/gu;
    let m;
    while ((m = entryPattern.exec(segment)) !== null) {
      if (m[2] !== undefined) {
        entries.push({ name: m[1], key: keyOf(m[2], m[3]), summary: null });
      } else {
        // Skip past the inline dictionary so its own entries (FontDescriptor,
        // ToUnicode, ...) are not mistaken for page fonts.
        const dictAt = m.index + m[0].length - 2;
        const inline = dictSlice(segment, dictAt);
        entries.push({ name: m[1], key: null, summary: null, inline });
        entryPattern.lastIndex = dictAt + inline.length;
      }
    }
    return entries;
  }

  function pageFonts(pageKey) {
    const own = fontEntriesIn(dictText(pageKey));
    if (own) return own;
    const resources = fieldRef(dictText(pageKey), "Resources");
    if (resources) {
      const held = fontEntriesIn(dictText(resources));
      if (held) return held;
    }
    const parent = fieldRef(dictText(pageKey), "Parent");
    return parent ? pageFonts(parent) : [];
  }

  const sortedKeys = () => [...objects.entries.keys()].sort((a, b) => {
    const [an, ag] = a.split(",").map(Number);
    const [bn, bg] = b.split(",").map(Number);
    return an - bn || ag - bg;
  });

  // Catalog: prefer the trailer /Root when it is one (the prepared-file
  // reader carries it), else the first catalog object that names /Pages.
  let catalogKey = null;
  let rootPagesKey = null;
  const candidates = [];
  if (objects.rootKey && CATALOG_TYPE_RE.test(dictText(objects.rootKey))) {
    candidates.push(objects.rootKey);
  }
  for (const key of sortedKeys()) {
    if (key !== objects.rootKey && CATALOG_TYPE_RE.test(dictText(key))) candidates.push(key);
  }
  for (const key of candidates) {
    catalogKey ??= key;
    rootPagesKey = fieldRef(dictText(key), "Pages");
    if (rootPagesKey) { catalogKey = key; break; }
  }

  const info = {};
  if (census) {
    const infoKey = sortedKeys().find((key) => /\/Creator|\/Author|\/Title/u.test(dictText(key)));
    if (infoKey) {
      const infoText = dictText(infoKey);
      for (const name of ["Title", "Author", "Creator", "Producer", "CreationDate", "ModDate"]) {
        const value = fieldString(infoText, name);
        if (value) info[name] = value;
      }
    }
  }

  // Page order = leaf order walking /Kids. A page object listed twice is
  // one page; a page-tree cycle is a corrupt document, not a hang.
  const pageOrder = [];
  const seenPages = new Set();
  const visiting = new Set();
  (function walk(key) {
    if (!key) return;
    const text = dictText(key);
    if (PAGE_TYPE_RE.test(text)) {
      if (seenPages.has(key)) return;
      seenPages.add(key);
      pageOrder.push(key);
      if (pageOrder.length > MAX_PAGES) {
        throw new ValueError(`PDF exceeds the ${MAX_PAGES} page cap`);
      }
      return;
    }
    if (visiting.has(key)) throw new ValueError("Cycle found in PDF page tree");
    visiting.add(key);
    try {
      const kids = /\/Kids\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "";
      for (const kid of fieldRefs(kids)) walk(kid);
    } finally {
      visiting.delete(key);
    }
  })(rootPagesKey);

  const pages = pageOrder.map((pageKey, index) => {
    const text = dictText(pageKey);
    const [num, gen] = pageKey.split(",").map(Number);
    const box = inherited(pageKey, /\/MediaBox\s*(\[[^\]]*\])/u);
    const rotate = inherited(pageKey, /\/Rotate\s+(-?\d+)/u);
    const fonts = pageFonts(pageKey).map((font) => ({
      ...font,
      ...(font.key ? fontFacts(font.key) : factsOf(font.inline)),
    }));
    const contentsRef = fieldRef(text, "Contents");
    const contentKeys = contentsRef
      ? [contentsRef]
      : fieldRefs(/\/Contents\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "");
    const mediaBox = box
      ? { value: box.value.replace(/\s+/gu, " "), own: box.own, from: box.from }
      : null;
    return {
      index: index + 1,
      key: pageKey,
      num,
      gen,
      mediaBox,
      size: boxSize(mediaBox),
      rotate: rotate ? { value: rotate.value, own: rotate.own } : null,
      fonts,
      contents: contentKeys.map((contentKey) => {
        const dict = dictText(contentKey);
        return {
          key: contentKey,
          length: /\/Length\s+(\d+)/u.exec(dict)?.[1] ?? "?",
          filter: fieldName(dict, "Filter") ?? "none",
        };
      }),
    };
  });

  const decoded = { catalog: catalogKey, rootPages: rootPagesKey, info, pages };
  if (census) {
    const all = sortedKeys();
    const streamKeys = all.filter(hasStream);
    decoded.objectCount = all.length;
    decoded.streamCount = streamKeys.length;
    decoded.plainCount = all.length - streamKeys.length;
    decoded.objects = all.map((key) => {
      const entry = entryOf(key);
      return {
        key, start: entry.start ?? entry.offset ?? 0, end: entry.end,
        stream: hasStream(key),
        dict: dictText(key).replace(/\s+/gu, " ").trim(),
      };
    });
  }
  return decoded;
}

// Instructions over an objects reader the caller already opened (the
// live parser's PdfFileObjects / PdfScannedObjects). No census: page
// discovery needs only the dictionaries on the page-tree path.
export function decodePdfInstructions(objects) {
  return buildInstructions(objects);
}

// Decode a PDF (path or bytes) from outside-stream dictionaries only,
// with the full object census. Stream bodies are never opened, so every
// content/font stream is a reference, not bytes.
export function decodeOutsideStream(source, { maxObjects } = {}) {
  const { objects, close } = openPdfScannedObjects(source, { maxObjects });
  try {
    return buildInstructions(objects, { census: true });
  } finally {
    close();
  }
}

// The experiment's text form: instructions a human (or the future
// page exporter) can follow without opening a single stream.
export function renderInstructions(decoded, { sourceLabel = "" } = {}) {
  const lines = [];
  lines.push("OUTSIDE-STREAM SAMPLE PARSE -> INSTRUCTIONS");
  lines.push("=".repeat(60));
  lines.push(`Source PDF : ${sourceLabel}`);
  lines.push("Scope      : only objects that live outside object streams.");
  lines.push("Streams    : never opened, never decompressed in this sample.");
  lines.push("");
  lines.push("INVENTORY");
  lines.push(`  objects visible outside object streams : ${decoded.objectCount}`);
  lines.push(`  plain dictionary/values objects        : ${decoded.plainCount}`);
  lines.push(`  stream objects (bodies skipped)        : ${decoded.streamCount}`);
  lines.push(`  pages (page-tree leaves)               : ${decoded.pages.length}`);
  lines.push("");

  lines.push("DOCUMENT");
  if (decoded.catalog) lines.push(`  START at object ${refText(decoded.catalog)} (Catalog)`);
  if (decoded.rootPages) lines.push(`  FOLLOW /Pages -> object ${refText(decoded.rootPages)} (page tree root)`);
  for (const [name, value] of Object.entries(decoded.info)) {
    lines.push(`  INFO ${name} = ${JSON.stringify(value)}`);
  }
  lines.push("");

  lines.push("PAGE INSTRUCTIONS (streams referenced, never decoded)");
  for (const page of decoded.pages) {
    lines.push(`PAGE ${page.index} = object ${refText(page.key)}`);
    if (page.mediaBox) {
      lines.push(`  BOX    MediaBox ${page.mediaBox.value}${page.mediaBox.own ? " (own)" : ` (inherited from object ${refText(page.mediaBox.from)})`}`);
    }
    lines.push(`  ROTATE ${page.rotate ? `${page.rotate.value}${page.rotate.own ? " (own)" : " (inherited)"}` : "0 (default)"}`);
    for (const font of page.fonts) {
      lines.push(`  USE FONT /${font.name} -> object ${refText(font.key)}: ${font.summary}`);
    }
    for (const content of page.contents) {
      lines.push(`  DRAW   content -> object ${refText(content.key)} (stream, ${content.filter}, ${content.length} bytes) NOT DECODED`);
    }
  }
  lines.push("");

  lines.push("ALL OBJECTS OUTSIDE OBJECT STREAMS");
  for (const object of decoded.objects) {
    const shown = object.dict.length > 220 ? `${object.dict.slice(0, 220)}...` : object.dict;
    const kind = object.stream ? "STREAM (not decoded)" : "object";
    lines.push(`${refText(object.key)} @bytes ${object.start}..${object.end} [${kind}] ${shown}`);
  }

  return `${lines.join("\n")}\n`;
}
