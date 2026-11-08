// Outside-stream decoding: read only the parts of a PDF that live
// OUTSIDE object streams, and translate what is found into per-page
// instructions. Uses the parser's own file scanner (pdf-objects.js),
// which walks the raw file for `N G obj` markers. Objects packed inside
// compressed object streams are invisible to it, and stream bodies are
// NEVER opened here: stream objects are reported as "not decoded", with
// only their dictionary (which lives outside the stream) read.
//
// This is the decoding pass for files the full stream parser has not
// prepared yet — page order, geometry, font chains and content
// references are all decidable from dictionaries alone, so no content
// stream (and no 2 KB sample probe) is decoded to get them.
import { openPdfScannedObjects } from "./pdf-objects.js";

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

// Decode a PDF (path or bytes) from outside-stream dictionaries only.
// Returns page instructions in page-tree leaf order; stream bodies are
// never opened, so every content/font stream is a reference, not bytes.
export function decodeOutsideStream(source) {
  const { objects, close } = openPdfScannedObjects(source);
  try {
    const dictOf = new Map(); // "num,gen" -> dictionary text (never stream bytes)
    for (const [key, dict] of objects) {
      dictOf.set(key, Buffer.from(dict).toString("latin1"));
    }
    const entryOf = (key) => objects.entries.get(key);
    const hasStream = (key) => entryOf(key)?.streamStart !== undefined;

    // Walk /Parent until an inheritable field (/MediaBox, /Rotate) is defined.
    function inherited(pageKey, name, pattern) {
      let key = pageKey;
      let own = true;
      while (key) {
        const text = dictOf.get(key) ?? "";
        const m = pattern.exec(text);
        if (m) return { value: m[1] ?? m[0], from: key, own };
        key = fieldRef(text, "Parent");
        own = false;
      }
      return null;
    }

    function fontSummary(fontKey) {
      const text = dictOf.get(fontKey) ?? "";
      const subtype = fieldName(text, "Subtype") ?? "?";
      const base = fieldName(text, "BaseFont") ?? "?";
      const parts = [`${subtype} ${base}`];
      const encodingRef = fieldRef(text, "Encoding");
      const encodingName = fieldName(text, "Encoding");
      if (encodingName) parts.push(`encoding ${encodingName}`);
      else if (encodingRef) parts.push(`encoding -> object ${refText(encodingRef)}`);
      const toUnicode = fieldRef(text, "ToUnicode");
      if (toUnicode) parts.push(`ToUnicode -> object ${refText(toUnicode)} (stream, not decoded)`);
      // Embedded? Follow FontDescriptor directly, or via Type0 descendant.
      let descriptorKey = fieldRef(text, "FontDescriptor");
      if (!descriptorKey) {
        const descendant = fieldRef(text, "DescendantFonts");
        if (descendant) descriptorKey = fieldRef(dictOf.get(descendant) ?? "", "FontDescriptor");
      }
      if (descriptorKey) {
        const descriptor = dictOf.get(descriptorKey) ?? "";
        const fileKey = fieldRef(descriptor, "FontFile2") ?? fieldRef(descriptor, "FontFile3") ?? fieldRef(descriptor, "FontFile");
        parts.push(fileKey
          ? `embedded font file -> object ${refText(fileKey)} (stream, not decoded)`
          : "not embedded");
      }
      return parts.join(", ");
    }

    function pageFonts(pageKey) {
      const text = dictOf.get(pageKey) ?? "";
      const fontAt = text.indexOf("/Font");
      if (fontAt < 0) {
        const parent = fieldRef(text, "Parent");
        return parent ? pageFonts(parent) : [];
      }
      const segment = text.slice(fontAt, text.indexOf(">>", fontAt) + 2 || undefined);
      return [...segment.matchAll(/\/([A-Za-z0-9]+)\s+(\d+)\s+(\d+)\s+R/gu)]
        .map((m) => ({ name: m[1], key: keyOf(m[2], m[3]), summary: null }));
    }

    const all = [...dictOf.keys()].sort((a, b) => {
      const [an, ag] = a.split(",").map(Number);
      const [bn, bg] = b.split(",").map(Number);
      return an - bn || ag - bg;
    });
    const streamKeys = all.filter(hasStream);
    const catalogKey = all.find((key) => fieldName(dictOf.get(key), "Type") === "Catalog") ?? null;
    const infoKey = all.find((key) => /\/Creator|\/Author|\/Title/u.test(dictOf.get(key) ?? "")) ?? null;
    const rootPagesKey = catalogKey ? fieldRef(dictOf.get(catalogKey), "Pages") : null;

    const info = {};
    if (infoKey) {
      const infoText = dictOf.get(infoKey);
      for (const name of ["Title", "Author", "Creator", "Producer", "CreationDate", "ModDate"]) {
        const value = fieldString(infoText, name);
        if (value) info[name] = value;
      }
    }

    // Page order = leaf order walking /Kids.
    const pageOrder = [];
    (function walk(key) {
      if (!key) return;
      const text = dictOf.get(key) ?? "";
      if (fieldName(text, "Type") === "Page") { pageOrder.push(key); return; }
      const kids = /\/Kids\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "";
      for (const kid of fieldRefs(kids)) walk(kid);
    })(rootPagesKey);

    const pages = pageOrder.map((pageKey, index) => {
      const text = dictOf.get(pageKey) ?? "";
      const box = inherited(pageKey, "MediaBox", /\/MediaBox\s*(\[[^\]]*\])/u);
      const rotate = inherited(pageKey, "Rotate", /\/Rotate\s+(-?\d+)/u);
      const fonts = pageFonts(pageKey).map((font) => ({
        ...font,
        summary: fontSummary(font.key),
      }));
      const contents = fieldRef(text, "Contents");
      const contentKeys = contents
        ? [contents]
        : fieldRefs(/\/Contents\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "");
      return {
        index: index + 1,
        key: pageKey,
        mediaBox: box
          ? { value: box.value.replace(/\s+/gu, " "), own: box.own, from: box.from }
          : null,
        rotate: rotate ? { value: rotate.value, own: rotate.own } : null,
        fonts,
        contents: contentKeys.map((contentKey) => {
          const dict = dictOf.get(contentKey) ?? "";
          return {
            key: contentKey,
            length: /\/Length\s+(\d+)/u.exec(dict)?.[1] ?? "?",
            filter: fieldName(dict, "Filter") ?? "none",
          };
        }),
      };
    });

    return {
      objectCount: all.length,
      streamCount: streamKeys.length,
      plainCount: all.length - streamKeys.length,
      catalog: catalogKey,
      rootPages: rootPagesKey,
      info,
      pages,
      objects: all.map((key) => {
        const entry = entryOf(key);
        return {
          key, start: entry.start, end: entry.end, stream: hasStream(key),
          dict: (dictOf.get(key) ?? "").replace(/\s+/gu, " ").trim(),
        };
      }),
    };
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
