/*
(PDF 19) PDF branch, position 19 in the chain - after the extraction (PDF 13), before records are made (PDF 10).
This module finishes one page's text: it orders the marks, converts Zawgyi text, cleans Unicode text (PDF 20 to 26), and writes the finished page to its text file.
*/
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { containsMyanmar, hasOnlyZawgyiFonts } from "../../@rule/detect.js";
import { arrangeZawCodeOrder } from "../../@postprocess/beautify/zawcode-order.js";
import { correctWorldWord, judgePageLines, selectPageDecision } from "../../@rule/judgement.js";
import { cleanupText, orderText } from "../../@postprocess/beautify/clean.js";
import { preserveRegionalRuns } from "../../@rule/unicode-evidence.js";
import { Rabbit, createRabbitStream } from "../../@rule/rabbit.js";
import { StreamingReplace } from "../../@helper/stream-replace.js";

const READ_SIZE = 64 * 1024;

function writeAll(fd, text) {
  if (!text) return;
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("Could not write the PDF text spool");
    offset += count;
  }
}

// Split exactly like String#split("\n"), without holding an entire page.
export function* textLines(chunks) {
  let pending = "";
  for (const chunk of chunks) {
    let start = 0;
    for (let i = 0; i < chunk.length; i += 1) {
      if (chunk[i] !== "\n") continue;
      yield pending + chunk.slice(start, i);
      pending = "";
      start = i + 1;
    }
    pending += chunk.slice(start);
  }
  yield pending;
}

function equalChunks(left, right) {
  const a = left[Symbol.iterator]();
  const b = right[Symbol.iterator]();
  let x = "";
  let y = "";
  let doneA = false;
  let doneB = false;
  try {
    while (true) {
      while (!x && !doneA) {
        const part = a.next();
        doneA = part.done;
        if (!doneA) x = part.value;
      }
      while (!y && !doneB) {
        const part = b.next();
        doneB = part.done;
        if (!doneB) y = part.value;
      }
      if (!x || !y) return !x && !y && doneA && doneB;
      const n = Math.min(x.length, y.length);
      if (x.slice(0, n) !== y.slice(0, n)) return false;
      x = x.slice(n);
      y = y.slice(n);
    }
  } finally {
    a.return?.();
    b.return?.();
  }
}

// Preserve the buffered layout rule: reuse coordinates if the page is
// unchanged or if its converted text still has the same number of lines.
export function* pageLayoutLines(store, text, sourceLineCount) {
  let convertedLineCount = 1;
  for (const chunk of text.chunks()) {
    for (const char of chunk) if (char === "\n") convertedLineCount += 1;
  }
  if (convertedLineCount === sourceLineCount) {
    const converted = textLines(text.chunks());
    try {
      for (const [x, y, size, , font] of store.lines()) {
        yield [x, y, size, converted.next().value, font];
      }
    } finally { converted.return?.(); }
    return;
  }
  function* original() {
    let first = true;
    for (const [, , , line] of store.lines()) {
      if (!first) yield "\n";
      first = false;
      yield line;
    }
  }
  if (equalChunks(original(), text.chunks())) yield* store.lines();
}

export class PageTextFile {
  constructor(file, chars, bytes) {
    this.path = file;
    this.chars = chars;
    this.bytes = bytes;
  }

  *chunks() {
    const fd = fs.openSync(this.path, "r");
    const decoder = new StringDecoder("utf8");
    const buffer = Buffer.allocUnsafe(READ_SIZE);
    try {
      while (true) {
        const count = fs.readSync(fd, buffer, 0, buffer.length, null);
        if (!count) break;
        const text = decoder.write(buffer.subarray(0, count));
        if (text) yield text;
      }
      const text = decoder.end();
      if (text) yield text;
    } finally { fs.closeSync(fd); }
  }

  close() { fs.rmSync(this.path, { force: true }); }
}

// Write one final page transform to a spool file. The resulting spool is
// shared by the POS scanner and the output writer, so the page is not
// transformed again by a later document-wide phase.
export function normalizePageToFile(chunks, { directory, normalize } = {}) {
  if (typeof normalize !== "function") throw new TypeError("Expected page text transform function");
  const file = path.join(directory, `normalized-page-${randomUUID()}.txt`);
  let fd = null;
  let chars = 0;
  let bytes = 0;
  const write = (text) => {
    writeAll(fd, text);
    chars += text.length;
    bytes += Buffer.byteLength(text, "utf8");
  };
  try {
    fd = fs.openSync(file, "wx", 0o600);
    let first = true;
    for (const line of textLines(chunks)) {
      if (!first) write("\n");
      first = false;
      write(normalize(line));
    }
    fs.closeSync(fd);
    fd = null;
    return new PageTextFile(file, chars, bytes);
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw error;
  }
}

export const orderUnicodeText = (text) => preserveRegionalRuns(text, orderText);
export const cleanupUnicodeText = (text) => preserveRegionalRuns(text, cleanupText);

const FINAL_UNICODE_DECISIONS = new Set([
  "aligned", "zawcode", "unaligned-unicode",
]);

// finishPageToFile() chooses the page lane and, for Rabbit/ZawCode pages,
// writes that conversion to the page spool. This is the single output-side
// Parser ordering/cleanup step for a finalized page. The streamed writer may
// run Engine character normalization immediately before it in the same spool
// pass; this step then puts the Parser's syllable-slot order last. Unicode
// lanes get that ordering (and cleanup when requested); retained/unknown
// lanes are left as supplied with their warnings. Rabbit pages are already
// converted by finishPageToFile(); like every rule-applied layer they get
// clean.js as follow-up here - ordering, then cleanup.
export function convertFinalizedPageText(text, page = {}, applyCleanup = true) {
  const raw = String(text ?? "");
  const decision = page?.decision;
  // Every beautify rule layer gets clean.js as its follow-up here,
  // then the page is finished: the Rabbit conversion and the ZawCode
  // swap both land on ordering first, then cleanup - no rule-applied
  // layer is exempt, and cleanup never runs on unordered text.
  if (decision === "rabbit") {
    const ordered = orderUnicodeText(raw);
    return applyCleanup ? cleanupUnicodeText(ordered) : ordered;
  }
  const unicodeLane = FINAL_UNICODE_DECISIONS.has(decision)
    || (!decision && page?.category === "UNICODE");
  if (!unicodeLane) return raw;
  const ordered = orderUnicodeText(raw);
  return applyCleanup ? cleanupUnicodeText(ordered) : ordered;
}

// Decide once for the entire page, but make the decision in passes over the
// disk-backed lines. No Rabbit rule is applied to a partially repaired page.
// Misuse warnings: the lane is decided ONCE here (judgement upstream of
// it); a decoder must not refuse or reroute a page by font name - the
// font evidence has already spoken. Beautify rules applied here are
// always followed by clean.js (see convertFinalizedPageText above),
// and cleanup is never applied to not-yet-ordered text. Do not add a
// blanket second ordering pass behind this finish.
export function finishPageToFile(store, {
  directory, parsingPath, sourceEncoding = "auto", fontKinds = new Set(),
  fontNames = new Set(),
} = {}) {
  function* pageTexts() {
    for (const [, , , text] of store.lines()) yield text;
  }
  // ZawCode is a codepage call: on a Zawgyi codepage page the beautify
  // swapping rule is not offered as a candidate, so shared visual-order
  // slots cannot reroute a Zawgyi page into the ZawCode lane.
  const zawgyiCodepage = hasOnlyZawgyiFonts(fontNames);
  const judgment = judgePageLines(pageTexts(),
    zawgyiCodepage ? (line) => line : arrangeZawCodeOrder);
  const { originalHasText, count } = judgment;
  let decision = selectPageDecision(judgment, parsingPath, { zawgyiCodepage });
  const worldEvidence = sourceEncoding !== "unicode" && decision === "rabbit";

  const id = randomUUID();
  const file = path.join(directory, `page-text-${id}.txt`);
  let fd = null;
  let chars = 0;
  let bytes = 0;
  let outputHasMyanmar = false;
  try {
    fd = fs.openSync(file, "wx", 0o600);
    const write = (text) => {
      writeAll(fd, text);
      chars += text.length;
      bytes += Buffer.byteLength(text, "utf8");
      outputHasMyanmar ||= containsMyanmar(text);
    };
    const writeOriginal = ({ transform = (text) => text } = {}) => {
      let first = true;
      for (const [, , , text] of store.lines()) {
        if (!first) write("\n");
        first = false;
        write(correctWorldWord(transform(text), worldEvidence));
      }
    };
    // Legacy pages are written as decoded, then given the one shared
    // ordering (orderUnicodeText) every lane gets at page finish. There
    // is no legacy-specific reorder rule: extraction only decodes.
    const writePlain = () => {
      let first = true;
      for (const [, , , text] of store.lines()) {
        if (!first) write("\n");
        first = false;
        write(text);
      }
    };

    if (decision === "legacy") {
      let first = true;
      for (const [, , , text] of store.lines()) {
        if (!first) write("\n");
        first = false;
        write(orderUnicodeText(text));
      }
    } else if (decision === "rabbit") {
      // The conversion writes straight out. Nothing is receipted or
      // rolled back: characters the converter does not handle flow
      // through it naturally.
      const world = worldEvidence ? new StreamingReplace(/က(?:မၻာ|မ်ဘာ)/u, "ကမ္ဘာ") : null;
      const output = (text) => {
        const transformed = world ? world.push(text) : text;
        write(transformed);
      };
      const rabbit = createRabbitStream(output, { preserveSpaces: true });
      let first = true;
      for (const [, , , text] of store.lines()) {
        const chunk = first ? text : `\n${text}`;
        first = false;
        rabbit.push(chunk);
      }
      rabbit.push("", true);
      if (world) write(world.push("", true));
    } else if (decision === "zawcode") {
      writeOriginal({ transform: arrangeZawCodeOrder });
    } else {
      writeOriginal();
    }
    fs.closeSync(fd);
    fd = null;
    const category = !outputHasMyanmar ? "UNKNOWN"
      : decision === "rabbit" ? "ZAWGYI" : "UNICODE";
    return { text: new PageTextFile(file, chars, bytes), decision, category, originalHasText, lineCount: count };
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw error;
  }
}
