/*
(Repair 2) Repair branch, position 2 in the chain - after the scan (Repair 1).
This module drives the repair stage: broken lines become line-SVG requests to the original-PDF cache (PDF 37), and the returned vector decisions are applied to the text.
*/
// Repair is a separate stage after Parser output is written.
//
// repairFirstStage wraps scan.js. Scan owns the hash-free BindEngine POS
// generator: repair reads Parser's tmp output one line at a time, scan calls
// BindEngine for that line, and repair keeps only broken lines with their
// original PDF page/line reference. Each broken line becomes one line-scope
// SVG request for the original-PDF cache. The cache response then enters
// actualRepair, where the vector decisions are applied. Nothing here feeds
// back into Parser's first circle.
import fs from "node:fs";
import readline from "node:readline";
import {
  scanBrokenSpans, scanLineWithPos, tagPosLine, parseTaggedLine,
} from "../init.js";
import {
  beautifyText, beautifyFromScanVerdict, mendZawCodeText, zawCodeGuard,
} from "../beautify/beautify.js";
import { orderText } from "../beautify/clean.js";

// Raw-font evidence is available to a repair caller that retained provenance.
// These lookups return candidates only; they never alter text automatically.
export { pdfBeautifyCandidates, physicalKeyCandidates, evidenceForOutput } from "../../@core/pdf/method/legacy/codepage-pooled.js";

const MM_RUN = /[\u1000-\u1049\u105a-\u109f]+/gu;

export async function inspectPosCandidate(candidate, { bindEngine = null } = {}) {
  if (typeof candidate !== "string") throw new TypeError("A POS candidate must be text");
  const rawPos = await tagPosLine(candidate, bindEngine);
  const tagged = parseTaggedLine(rawPos);
  const unknown = tagged.filter((token) => token.kind === "unknown").length;
  const exact = tagged.length > 0 && tagged.every((token) => token.kind === "known")
    && tagged.map((token) => token.word).join("") === candidate.replace(/\s+/gu, "");
  return { singleWord: exact && tagged.length === 1, unknownCount: unknown || (exact ? 0 : 1) };
}

export async function scanBrokenSpansWithPos(text, { bindEngine = null } = {}) {
  const source = String(text ?? "");
  const spans = scanBrokenSpans(source);
  const cache = new Map();
  for (const match of source.matchAll(MM_RUN)) {
    if (!cache.has(match[0])) cache.set(match[0], await inspectPosCandidate(match[0], { bindEngine }));
    if (!cache.get(match[0]).unknownCount) continue;
    const start = match.index;
    const end = start + match[0].length;
    if (!spans.some((span) => span.start < end && span.end > start)) {
      spans.push({ start, end, token: match[0], rules: ["unknown"] });
    }
  }
  return spans.sort((a, b) => a.start - b.start);
}

// The synchronous beautify rules in beautify.js consume a small set-like view of known
// candidates. Resolve that view lazily from Engine POS, never from the master
// dictionary; replay a rule only when a newly encountered candidate needs a
// verdict. Source text is changed only after all of its candidates are known.
async function withPosVerdicts(run, bindEngine = null) {
  const cache = new Map();
  const pending = new Set();
  const verdicts = {
    size: 1,
    has(value) {
      if (!cache.has(value)) pending.add(value);
      return cache.get(value)?.singleWord === true;
    },
    unknownCount(value) {
      if (!cache.has(value)) pending.add(value);
      return cache.get(value)?.unknownCount ?? 0;
    },
  };
  for (;;) {
    pending.clear();
    const result = run(verdicts);
    if (!pending.size) return result;
    for (const candidate of pending) {
      cache.set(candidate, await inspectPosCandidate(candidate, { bindEngine }));
    }
  }
}

export async function repairTextWithPos(text, { bindEngine = null } = {}) {
  return withPosVerdicts((verdicts) => beautifyText(text, verdicts), bindEngine);
}

export async function repairFromPosVerdict(pages, {
  path = null, preserveZawCodeOrder = false, bindEngine = null,
} = {}) {
  return withPosVerdicts((verdicts) => beautifyFromScanVerdict(pages, {}, verdicts, {
    path, preserveZawCodeOrder,
  }), bindEngine);
}

export async function mendZawCodeTextWithPos(text, { skipTokens = null, bindEngine = null } = {}) {
  return withPosVerdicts((verdicts) => mendZawCodeText(text, verdicts, [], { skipTokens }), bindEngine);
}

export async function zawCodeGuardWithPos(sample, { bindEngine = null } = {}) {
  return withPosVerdicts((verdicts) => zawCodeGuard(sample, verdicts), bindEngine);
}

// ---------------------------------------------------------------------------
// Staged repair flow
//
//   PosScanner.finish()
//     -> { memory }                             // broken lines from scan
//   requestScanLineSvgs(scanResult, originalPdfCache)
//     -> { requests, responses }                // one SVG request per broken line
//   repairFirstStage(input)
//     -> { brokenLines, svgRequests }          // standalone text first stage
//   requestOriginalPdfLineSvgs(firstStage, originalPdfCache)
//     -> { responses }                          // one SVG per broken line
//   actualRepair(firstStage, svgResponses)
//     -> { patches, unresolved }                // final repair result
//
// runRepair(input) is only the sequential caller of those stages; it does
// not merge them, and with no original-PDF cache it stops after first stage
// and returns the pending SVG requests.
// ---------------------------------------------------------------------------

const PAGE_MARKER_LINE = /^\s*--- Page (\d+) ---\s*$/u;
const PARSER_HEADER_LINE = /^(?:# Source:|# Pages:|# Detection:|#{4,})/u;

const repairLineKey = (page, line) => `${page ?? "unknown"}:${line}`;

function normaliseSpans(text, spans) {
  const valid = [];
  for (const span of spans ?? []) {
    const start = span?.start;
    const end = span?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    if (start < 0 || end < start || end > text.length) continue;
    valid.push({
      start,
      end,
      token: typeof span.token === "string" ? span.token : text.slice(start, end),
      rules: [...new Set(Array.isArray(span.rules) ? span.rules : [])],
    });
  }
  valid.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const span of valid) {
    const prev = merged[merged.length - 1];
    if (prev && span.start <= prev.end) {
      prev.end = Math.max(prev.end, span.end);
      prev.token = text.slice(prev.start, prev.end);
      prev.rules = [...new Set([...prev.rules, ...span.rules])];
    } else {
      merged.push({ ...span, rules: [...span.rules] });
    }
  }
  return merged;
}

const MYANMAR_CHAR = /[\u1000-\u109f]/u;

function posUnknownContexts(tokens) {
  const contexts = [];
  for (let i = 0; i < tokens.length;) {
    if (tokens[i].kind !== "unknown") { i += 1; continue; }
    let end = i + 1;
    while (end < tokens.length && tokens[end].kind === "unknown") end += 1;
    const from = Math.max(0, i - 2);
    const to = Math.min(tokens.length, end + 2);
    contexts.push(tokens.slice(from, to).map((token) => token.formatted).join("  "));
    i = end;
  }
  return contexts;
}

async function* readLines(readable, { closeStream = false } = {}) {
  const lines = readline.createInterface({ input: readable, crlfDelay: Infinity });
  try {
    for await (const line of lines) yield line;
  } finally {
    lines.close();
    if (closeStream) readable.destroy?.();
  }
}

function pageTextOf(page) {
  if (typeof page === "string") return page;
  if (typeof page?.text === "string") return page.text;
  if (Array.isArray(page?.lines)) {
    return page.lines.map((line) => {
      if (typeof line === "string") return line;
      if (Array.isArray(line)) return String(line[3] ?? "");
      return String(line?.text ?? "");
    }).join("\n");
  }
  return "";
}

async function* inputLineRecords(input) {
  const sources = ["path", "text", "pages", "lines", "stream"]
    .filter((key) => input?.[key] !== undefined);
  if (!input || sources.length !== 1) {
    throw new TypeError("repairFirstStage needs exactly one input source: path, text, pages, lines or stream");
  }
  if (typeof input.pages === "string" || typeof input.lines === "string") {
    throw new TypeError("repairFirstStage pages/lines input must be an iterable, not a string");
  }

  let sequence = 0;
  if (input.pages !== undefined) {
    let fallbackPage = 0;
    for (const page of input.pages) {
      fallbackPage += 1;
      const pageNumber = typeof page === "string"
        ? fallbackPage
        : page?.page ?? page?.pageNumber ?? page?.number ?? fallbackPage;
      const lines = pageTextOf(page).split(/\r?\n/u);
      for (let i = 0; i < lines.length; i += 1) {
        sequence += 1;
        yield { page: pageNumber, line: i + 1, sequence, text: lines[i] };
      }
    }
    return;
  }

  let rawLines;
  if (input.path !== undefined) {
    rawLines = readLines(fs.createReadStream(input.path, { encoding: "utf8" }), { closeStream: true });
  } else if (input.stream !== undefined) {
    rawLines = readLines(input.stream);
  } else if (input.text !== undefined) {
    rawLines = String(input.text).split(/\r?\n/u);
  } else {
    rawLines = input.lines;
  }

  let page = input.page ?? input.pageNumber ?? null;
  let lineInPage = 0;
  let sawPageMarker = false;
  for await (const raw of rawLines) {
    if (Array.isArray(raw)) {
      lineInPage += 1;
      sequence += 1;
      yield { page, line: lineInPage, sequence, text: String(raw[3] ?? "") };
      continue;
    }
    if (raw && typeof raw === "object") {
      const recordPage = raw.page ?? raw.pageNumber ?? page;
      if (recordPage !== page) { page = recordPage; lineInPage = 0; }
      const recordLine = Number.isInteger(raw.line)
        ? raw.line
        : Number.isInteger(raw.lineNumber) ? raw.lineNumber : lineInPage + 1;
      lineInPage = recordLine;
      sequence += 1;
      yield {
        page: recordPage,
        line: recordLine,
        sequence,
        text: String(raw.text ?? (typeof raw.line === "string" ? raw.line : "")),
      };
      continue;
    }
    const text = String(raw ?? "");
    const marker = PAGE_MARKER_LINE.exec(text);
    if (marker) {
      page = Number(marker[1]);
      sawPageMarker = true;
      lineInPage = 0;
      continue;
    }
    if (!sawPageMarker && page === null && PARSER_HEADER_LINE.test(text)) continue;
    lineInPage += 1;
    sequence += 1;
    yield { page, line: lineInPage, sequence, text };
  }
}

export async function repairFirstStage(input = {}) {
  const sourcePdf = input?.sourcePdf ?? input?.pdf ?? null;
  const bindEngine = input?.bindEngine ?? null;
  const includeRawPos = input?.includeRawPos === true;
  const brokenLines = [];
  const svgRequests = [];
  const seenPages = new Set();
  let lines = 0;
  let scannedLines = 0;
  let brokenSpans = 0;

  for await (const record of inputLineRecords(input)) {
    lines += 1;
    if (record.page !== null && record.page !== undefined) seenPages.add(record.page);
    if (!record.text.trim()) continue;
    scannedLines += 1;

    // clean.js runs on every path before the scan: whatever lane wrote
    // this record (unicode, zawgyi, legacy WinInnwa/Ayar, docx, ocr),
    // its text passes through clean.js here, at the scan's single
    // intake. The spans below index into this cleaned text, so the
    // broken record stores it too.
    const text = orderText(record.text);
    const pos = await scanLineWithPos(text, { bindEngine });
    const posUnknownTokens = pos.tokens
      .filter((token) => token.kind === "unknown" && MYANMAR_CHAR.test(token.word))
      .map((token) => token.word);
    // Full-line POS is the line verdict; whole Myanmar runs give the exact
    // broken spans. This keeps foreign text and punctuation that the Engine
    // segments as "unknown" out of the SVG request list.
    const spans = posUnknownTokens.length
      ? await scanBrokenSpansWithPos(text, { bindEngine })
      : scanBrokenSpans(text);
    const lineSpans = normaliseSpans(text, spans);
    if (!lineSpans.length) continue;
    const unknownTokens = lineSpans
      .filter((span) => span.rules.includes("unknown"))
      .map((span) => span.token);
    brokenSpans += lineSpans.length;
    const id = repairLineKey(record.page, record.line);
    const broken = {
      id,
      page: record.page,
      line: record.line,
      sequence: record.sequence,
      text,
      spans: lineSpans,
      unknownTokens,
      contexts: posUnknownContexts(pos.tokens),
      sourcePdf,
    };
    if (includeRawPos) broken.rawPos = pos.rawPos;
    brokenLines.push(broken);
    svgRequests.push({
      id,
      page: record.page,
      line: record.line,
      sequence: record.sequence,
      scope: "line",
      format: "svg",
      sourcePdf,
    });
  }

  return {
    stage: "repair-scan",
    sourcePdf,
    brokenLines,
    svgRequests,
    stats: {
      pages: seenPages.size,
      lines,
      scannedLines,
      brokenLines: brokenLines.length,
      brokenSpans,
    },
  };
}

function svgRequestsOf(firstStage) {
  if (Array.isArray(firstStage?.svgRequests)) return firstStage.svgRequests;
  return (firstStage?.brokenLines ?? []).map((broken) => ({
    id: broken.id ?? repairLineKey(broken.page, broken.line),
    page: broken.page,
    line: broken.line,
    sequence: broken.sequence,
    scope: "line",
    format: "svg",
    sourcePdf: broken.sourcePdf ?? firstStage?.sourcePdf ?? null,
  }));
}

function cacheExporter(originalPdfCache) {
  if (typeof originalPdfCache === "function") return originalPdfCache;
  for (const name of ["exportLineSvg", "exportPdfLineSvg", "requestLineSvg", "getLineSvg"]) {
    if (typeof originalPdfCache?.[name] === "function") {
      return (request) => originalPdfCache[name](request);
    }
  }
  throw new TypeError("repair SVG stage needs an original-PDF cache: a function or an object with exportLineSvg(request)");
}

function normaliseSvgResponse(request, response) {
  if (typeof response === "string") {
    return { id: request.id, page: request.page, line: request.line, svg: response };
  }
  if (response && typeof response === "object") {
    return {
      ...response,
      id: response.id ?? request.id,
      page: response.page ?? request.page,
      line: response.line ?? request.line,
    };
  }
  return {
    id: request.id, page: request.page, line: request.line,
    missing: true, response: response ?? null,
  };
}

export async function* streamOriginalPdfLineSvgs(firstStage, originalPdfCache) {
  const exportLineSvg = cacheExporter(originalPdfCache);
  for (const request of svgRequestsOf(firstStage)) {
    yield normaliseSvgResponse(request, await exportLineSvg(request));
  }
}

export async function requestOriginalPdfLineSvgs(firstStage, originalPdfCache) {
  const responses = [];
  for await (const response of streamOriginalPdfLineSvgs(firstStage, originalPdfCache)) {
    responses.push(response);
  }
  return { stage: "original-pdf-svg", responses };
}

// Scan's finish is the request source for the PDF path: PosScanner has
// already consumed BindEngine output and kept only broken lines in
// scan.memory. Turn each retained broken line into one line-scope SVG
// request and send those requests to the job's original-PDF cache, which
// is the part that owns the PDF and exports PDF lines to SVG.
export function svgRequestsForScanMemory(scanResult, { sourcePdf = null } = {}) {
  const memory = Array.isArray(scanResult)
    ? scanResult
    : scanResult?.memory ?? scanResult?.brokenLines ?? [];
  const fallbackSource = sourcePdf ?? scanResult?.sourcePdf ?? null;
  return memory
    .filter((entry) => entry && (entry.page !== undefined || entry.line !== undefined))
    .map((entry, index) => ({
      id: entry.id ?? repairLineKey(entry.page, entry.line),
      page: entry.page ?? null,
      line: entry.line ?? null,
      sequence: entry.sequence ?? index + 1,
      scope: "line",
      format: "svg",
      sourcePdf: entry.sourcePdf ?? fallbackSource,
      context: entry.context ?? null,
      count: entry.count ?? null,
    }));
}

export async function requestScanLineSvgs(scanResult, originalPdfCache, { sourcePdf = null } = {}) {
  const requests = svgRequestsForScanMemory(scanResult, { sourcePdf });
  if (!requests.length) return { stage: "original-pdf-svg", requests, responses: [] };
  if (!originalPdfCache) {
    return { stage: "original-pdf-svg", requests, responses: [], pending: requests };
  }
  try {
    const result = await requestOriginalPdfLineSvgs({ svgRequests: requests }, originalPdfCache);
    return { stage: result.stage, requests, responses: result.responses };
  } catch (error) {
    if (error?.code === "PDF_LINE_SVG_NOT_IMPLEMENTED") {
      return {
        stage: "original-pdf-svg",
        requests,
        responses: [],
        pending: requests,
        unavailable: error.message,
      };
    }
    throw error;
  }
}

function applySpanReplacements(text, replacements) {
  const usedFrom = new Map();
  const specs = [];
  for (const item of replacements ?? []) {
    const to = item?.to ?? item?.replacement ?? item?.replacementText ?? item?.text;
    if (typeof to !== "string") return null;
    let start = item?.start;
    let end = item?.end;
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      const from = item?.from ?? item?.token;
      if (typeof from !== "string" || !from) return null;
      start = text.indexOf(from, usedFrom.get(from) ?? 0);
      if (start < 0) return null;
      end = start + from.length;
      usedFrom.set(from, end);
    }
    if (start < 0 || end < start || end > text.length) return null;
    specs.push({ start, end, from: text.slice(start, end), to });
  }
  const ordered = [...specs].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < ordered.length; i += 1) {
    if (ordered[i].start < ordered[i - 1].end) return null;
  }
  let out = text;
  for (const spec of [...ordered].reverse()) {
    out = out.slice(0, spec.start) + spec.to + out.slice(spec.end);
  }
  return { text: out, replacements: ordered };
}

function decisionToLine(broken, decision, { fromResolver = false } = {}) {
  if (typeof decision === "string") {
    return {
      text: decision,
      replacements: [{ start: 0, end: broken.text.length, from: broken.text, to: decision }],
    };
  }
  if (!decision || typeof decision !== "object") return null;
  const full = decision.repairedText ?? decision.replacementText ?? decision.finalText ?? decision.lineText;
  if (typeof full === "string") {
    return {
      text: full,
      replacements: [{ start: 0, end: broken.text.length, from: broken.text, to: full }],
    };
  }
  if (Array.isArray(decision.replacements)) return applySpanReplacements(broken.text, decision.replacements);
  if (Number.isInteger(decision.start) && Number.isInteger(decision.end)) {
    return applySpanReplacements(broken.text, [decision]);
  }
  if (fromResolver && decision.accepted === true && typeof decision.text === "string") {
    return {
      text: decision.text,
      replacements: [{ start: 0, end: broken.text.length, from: broken.text, to: decision.text }],
    };
  }
  return null;
}

async function vectorImageReplacements(broken, entry, vectorOptions) {
  let vote = null;
  let sawSource = false;
  const replacements = [];
  const missing = [];
  for (let i = 0; i < broken.spans.length; i += 1) {
    const span = broken.spans[i];
    const source = entry?.spanImages?.[i] ?? entry?.spanCrops?.[i]
      ?? entry?.images?.[i] ?? entry?.crops?.[i]
      ?? (broken.spans.length === 1 ? entry?.image ?? entry?.crop : null);
    if (!source) { missing.push(span); continue; }
    sawSource = true;
    const candidates = entry?.spanCandidates?.[i] ?? entry?.candidatesBySpan?.[i] ?? entry?.candidates;
    const options = { ...vectorOptions, ...(candidates !== undefined ? { candidates } : {}) };
    vote ??= await import("./vote.js");
    const match = source?.data && Number.isInteger(source.width) && Number.isInteger(source.height)
      ? vote.matchPixelsToVector(source, options)
      : await vote.matchImageToVector(source, options);
    if (match?.accepted && typeof match.text === "string") {
      replacements.push({ start: span.start, end: span.end, to: match.text });
    } else {
      missing.push(span);
    }
  }
  return sawSource ? { replacements, missing } : null;
}

function responseEntries(svgResponses) {
  if (!svgResponses) return [];
  if (Array.isArray(svgResponses)) return svgResponses;
  if (svgResponses instanceof Map) {
    return [...svgResponses.entries()].map(([id, value]) => (
      typeof value === "string" ? { id, svg: value } : { id, ...value }
    ));
  }
  if (Array.isArray(svgResponses.responses)) return svgResponses.responses;
  if (typeof svgResponses === "object") {
    return Object.entries(svgResponses).map(([id, value]) => (
      typeof value === "string" ? { id, svg: value } : { id, ...value }
    ));
  }
  return [];
}

export async function actualRepair(firstStage, svgResponses, {
  vectorResolve = null, vectorOptions = {},
} = {}) {
  const byKey = new Map();
  for (const entry of responseEntries(svgResponses)) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.id) byKey.set(String(entry.id), entry);
    if (entry.page !== undefined && entry.line !== undefined) byKey.set(repairLineKey(entry.page, entry.line), entry);
  }

  const patches = [];
  const unresolved = [];
  for (const broken of firstStage?.brokenLines ?? []) {
    const id = broken.id ?? repairLineKey(broken.page, broken.line);
    const entry = byKey.get(String(id)) ?? byKey.get(repairLineKey(broken.page, broken.line));
    if (!entry || entry.missing) {
      unresolved.push({
        id, page: broken.page, line: broken.line, sequence: broken.sequence,
        reason: "missing-svg-response", spans: broken.spans,
      });
      continue;
    }

    let applied = decisionToLine(broken, entry);
    let partialMissing = [];
    if (!applied && vectorResolve) {
      const decision = await vectorResolve({ broken, entry, svg: entry.svg ?? entry });
      applied = decisionToLine(broken, decision, { fromResolver: true });
    }
    if (!applied) {
      const vector = await vectorImageReplacements(broken, entry, vectorOptions);
      if (vector?.replacements.length) {
        applied = applySpanReplacements(broken.text, vector.replacements);
        partialMissing = vector.missing;
      } else if (vector) {
        partialMissing = vector.missing;
      }
    }

    if (!applied || applied.text === broken.text) {
      unresolved.push({
        id, page: broken.page, line: broken.line, sequence: broken.sequence,
        reason: applied ? "vector-decision-unchanged"
          : entry.svg || entry.format === "svg" ? "svg-vector-resolver-required" : "no-vector-decision",
        spans: partialMissing.length ? partialMissing : broken.spans,
      });
      continue;
    }

    patches.push({
      id,
      page: broken.page,
      line: broken.line,
      sequence: broken.sequence,
      from: broken.text,
      to: applied.text,
      replacements: applied.replacements,
    });
    if (partialMissing.length) {
      unresolved.push({
        id, page: broken.page, line: broken.line, sequence: broken.sequence,
        reason: "vector-partial", spans: partialMissing,
      });
    }
  }

  return {
    stage: "actual-repair",
    patches,
    unresolved,
    stats: {
      brokenLines: (firstStage?.brokenLines ?? []).length,
      patches: patches.length,
      unresolved: unresolved.length,
    },
  };
}

export async function runRepair(input = {}) {
  const {
    originalPdfCache = null, vectorResolve = null, vectorOptions = {},
    ...firstInput
  } = input ?? {};
  const firstStage = await repairFirstStage(firstInput);
  if (!firstStage.brokenLines.length) {
    return {
      firstStage,
      svgResponses: [],
      final: {
        stage: "actual-repair", patches: [], unresolved: [],
        stats: { brokenLines: 0, patches: 0, unresolved: 0 },
      },
    };
  }
  if (!originalPdfCache) {
    return { firstStage, svgResponses: null, final: null, pending: firstStage.svgRequests };
  }
  const svg = await requestOriginalPdfLineSvgs(firstStage, originalPdfCache);
  const final = await actualRepair(firstStage, svg, { vectorResolve, vectorOptions });
  return { firstStage, svgResponses: svg.responses, final };
}
