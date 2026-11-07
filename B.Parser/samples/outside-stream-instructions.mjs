#!/usr/bin/env node
// Sample: parse only the parts of a PDF that live OUTSIDE object streams,
// and translate what the parser finds into plain instructions.
//
//   node B.Parser/samples/outside-stream-instructions.mjs [input.pdf] [output.txt]
//
// Uses the parser's own file scanner (core/pdf/pdf-objects.js), which walks
// the raw file for `N G obj` markers. Objects packed inside compressed
// object streams are invisible to it, and stream bodies are NEVER opened
// here: stream objects are reported as "not decoded", with only their
// dictionary (which lives outside the stream) read.
//
// Defaults: the shipped sample PDF -> sample-outside-stream.instructions.txt
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openPdfScannedObjects } from "../core/pdf/pdf-objects.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const input = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repo, "F.Site", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");
const output = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(here, "sample-outside-stream.instructions.txt");

const { objects, close } = openPdfScannedObjects(input);

const keyOf = (num, gen) => `${num},${gen}`;
const refText = (num, gen) => `${num} ${gen} R`;
const dictOf = new Map(); // "num,gen" -> dictionary text (never stream bytes)
for (const [key, dict] of objects) {
  dictOf.set(key, Buffer.from(dict).toString("latin1"));
}
const entryOf = (key) => objects.entries.get(key);
const hasStream = (key) => entryOf(key)?.streamStart !== undefined;

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
  else if (encodingRef) parts.push(`encoding -> object ${refText(...encodingRef.split(","))}`);
  const toUnicode = fieldRef(text, "ToUnicode");
  if (toUnicode) parts.push(`ToUnicode -> object ${refText(...toUnicode.split(","))} (stream, not decoded)`);
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
      ? `embedded font file -> object ${refText(...fileKey.split(","))} (stream, not decoded)`
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
    .map((m) => ({ name: m[1], key: keyOf(m[2], m[3]) }));
}

const lines = [];
const all = [...dictOf.keys()].sort((a, b) => {
  const [an, ag] = a.split(",").map(Number);
  const [bn, bg] = b.split(",").map(Number);
  return an - bn || ag - bg;
});
const streamKeys = all.filter(hasStream);
const catalogKey = all.find((key) => fieldName(dictOf.get(key), "Type") === "Catalog");
const infoKey = all.find((key) => /\/Creator|\/Author|\/Title/u.test(dictOf.get(key) ?? ""));
const rootPagesKey = catalogKey ? fieldRef(dictOf.get(catalogKey), "Pages") : null;

// Page order = leaf order walking /Kids.
const pageOrder = [];
(function walk(key) {
  if (!key) return;
  const text = dictOf.get(key) ?? "";
  if (fieldName(text, "Type") === "Page") { pageOrder.push(key); return; }
  const kids = /\/Kids\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "";
  for (const kid of fieldRefs(kids)) walk(kid);
})(rootPagesKey);

lines.push("OUTSIDE-STREAM SAMPLE PARSE -> INSTRUCTIONS");
lines.push("=".repeat(60));
lines.push(`Source PDF : ${path.relative(repo, input)}`);
lines.push("Scope      : only objects that live outside object streams.");
lines.push("Streams    : never opened, never decompressed in this sample.");
lines.push("");
lines.push("INVENTORY");
lines.push(`  objects visible outside object streams : ${all.length}`);
lines.push(`  plain dictionary/values objects        : ${all.length - streamKeys.length}`);
lines.push(`  stream objects (bodies skipped)        : ${streamKeys.length}`);
lines.push(`  pages (page-tree leaves)               : ${pageOrder.length}`);
lines.push("");

lines.push("DOCUMENT");
if (catalogKey) lines.push(`  START at object ${refText(...catalogKey.split(","))} (Catalog)`);
if (rootPagesKey) lines.push(`  FOLLOW /Pages -> object ${refText(...rootPagesKey.split(","))} (page tree root)`);
if (infoKey) {
  const info = dictOf.get(infoKey);
  for (const name of ["Title", "Author", "Creator", "Producer", "CreationDate", "ModDate"]) {
    const value = fieldString(info, name);
    if (value) lines.push(`  INFO ${name} = ${JSON.stringify(value)}`);
  }
}
lines.push("");

lines.push("PAGE INSTRUCTIONS (streams referenced, never decoded)");
pageOrder.forEach((pageKey, index) => {
  const text = dictOf.get(pageKey) ?? "";
  lines.push(`PAGE ${index + 1} = object ${refText(...pageKey.split(","))}`);
  const box = inherited(pageKey, "MediaBox", /\/MediaBox\s*(\[[^\]]*\])/u);
  if (box) lines.push(`  BOX    MediaBox ${box.value.replace(/\s+/gu, " ")}${box.own ? " (own)" : ` (inherited from object ${refText(...box.from.split(","))})`}`);
  const rotate = inherited(pageKey, "Rotate", /\/Rotate\s+(-?\d+)/u);
  lines.push(`  ROTATE ${rotate ? `${rotate.value}${rotate.own ? " (own)" : " (inherited)"}` : "0 (default)"}`);
  for (const font of pageFonts(pageKey)) {
    lines.push(`  USE FONT /${font.name} -> object ${refText(...font.key.split(","))}: ${fontSummary(font.key)}`);
  }
  const contents = fieldRef(text, "Contents");
  const contentKeys = contents ? [contents] : fieldRefs(/\/Contents\s*\[([^\]]*)\]/u.exec(text)?.[1] ?? "");
  for (const contentKey of contentKeys) {
    const dict = dictOf.get(contentKey) ?? "";
    const length = /\/Length\s+(\d+)/u.exec(dict)?.[1] ?? "?";
    const filter = fieldName(dict, "Filter") ?? "none";
    lines.push(`  DRAW   content -> object ${refText(...contentKey.split(","))} (stream, ${filter}, ${length} bytes) NOT DECODED`);
  }
});
lines.push("");

lines.push("ALL OBJECTS OUTSIDE OBJECT STREAMS");
for (const key of all) {
  const entry = entryOf(key);
  const text = dictOf.get(key).replace(/\s+/gu, " ").trim();
  const shown = text.length > 220 ? `${text.slice(0, 220)}...` : text;
  const kind = hasStream(key) ? "STREAM (not decoded)" : "object";
  lines.push(`${refText(...key.split(","))} @bytes ${entry.start}..${entry.end} [${kind}] ${shown}`);
}

close();
fs.writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
console.log(`wrote ${path.relative(repo, output)} (${pageOrder.length} pages, ${all.length} objects, ${streamKeys.length} streams skipped)`);
