
// FILE: api/dispatcher.js
/*
(Support 19) Shared support, no chain position - caller routing and job normalization.
This module decides which worker a job goes to based on the caller, and normalizes job, method, source encoding and output before the Manager pool (Support 23) submits it.
*/
// Dispatcher — caller routing and job normalization.
// Decides which worker thread to use based on caller type (site/local).
// Manager pool is only a worker lifecycle helper; all routing logic lives here.
import { pool } from "../manager/manager-core.js";
import { normalizeCaller } from "../../extend/caller-policy.js";

export const JOBS = new Set(["extracting", "ocr", "null"]);
export const METHODS = new Set(["default", "manual", "null"]);
export const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);
export const OUTPUTS = new Set(["pdf", "docx", "txt"]);

function normalizeJob(job = {}) {
  // One shape only: a job object { job, method?, sourceEncoding?, ... }.
  // Callers that hold a plain-string job (the trigger/lazy boundary) build
  // this object themselves; the dispatcher does not accept both forms.
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    throw new TypeError("dispatcher: job must be an object");
  }
  const jobType = String(job.job ?? "extracting").toLowerCase();
  const encoding = String(job.sourceEncoding ?? "auto").toLowerCase();
  if (!JOBS.has(jobType)) throw new TypeError(`Unsupported job "${jobType}"`);
  if (job.method !== undefined && job.method !== null
      && !METHODS.has(String(job.method).toLowerCase())) {
    throw new TypeError(`Unsupported method "${job.method}"`);
  }
  if (!SOURCE_ENCODINGS.has(encoding)) throw new TypeError(`Unsupported encoding "${encoding}"`);
  return { ...job, job: jobType, sourceEncoding: encoding };
}

function ownerForCaller(caller) {
  const who = normalizeCaller(caller);
  // Site callers are non-owner workers; local/scraper callers are owner workers.
  return { who, owner: who !== "site" };
}

export const WORKER_KEYS = Object.freeze({
  OCR: "ocr",
  CONVERTER: "converter",
});

function keyForJob(jobType) {
  return String(jobType ?? "").toLowerCase() === WORKER_KEYS.OCR
    ? WORKER_KEYS.OCR
    : WORKER_KEYS.CONVERTER;
}

function normalizeWorkerKey(key, jobType) {
  if (key === undefined || key === null || key === "") return keyForJob(jobType);
  const normalized = String(key).trim().toLowerCase();
  if (!Object.values(WORKER_KEYS).includes(normalized)) {
    throw new TypeError(`Unsupported worker key "${key}" (use "ocr" or "converter")`);
  }
  return normalized;
}

function normalizeOutput(output) {
  if (output === undefined || output === null || output === "") return "txt";
  const normalized = String(output).trim().toLowerCase().replace(/^\./, "");
  if (!OUTPUTS.has(normalized)) {
    throw new TypeError(`Unsupported output "${output}" (use "pdf", "docx", or "txt")`);
  }
  return normalized;
}

// limit 0 means no worker budget cap; any positive limit uses the capped
// budget. The limit arrives on the trigger request and must reach the pool —
// it is never re-derived or dropped here.
function budgetFor(limit, owner) {
  if (limit === 0) return null;
  if (Number.isInteger(limit) && limit > 0) return 300000;
  return owner ? null : 300000;
}

// Single entry point. Normalizes job/method, decides worker from caller,
// submits to manager pool, returns the worker result.
export async function dispatch({
  object,
  method,
  caller = "site",
  identity,
  job = {},
  limit = null,
  worker: workerName = null,
  key = null,
  output = null,
}) {
  if (!object || typeof object !== "object") {
    throw new TypeError("dispatcher: object is required");
  }
  const normalized = normalizeJob(job);
  const m = String(method ?? "").toLowerCase();
  if (!METHODS.has(m)) throw new TypeError(`Unsupported method "${m}"`);
  const effectiveLimit = limit ?? normalized.limit ?? null;
  if (effectiveLimit !== null && (!Number.isInteger(effectiveLimit) || effectiveLimit < 0)) {
    throw new TypeError(`Unsupported worker limit "${effectiveLimit}"`);
  }
  const effectiveWorker = workerName ?? normalized.worker ?? null;
  // `key` is the fifth trigger param and picks the actual worker script:
  // ocr -> worker/ocr.js, converter -> worker/converter.js.
  const effectiveKey = normalizeWorkerKey(key ?? normalized.key ?? null, normalized.job);
  const effectiveOutput = normalizeOutput(
    output ?? normalized.output ?? normalized.outputFormat ?? normalized.outputType,
  );
  const { who, owner } = ownerForCaller(caller);
  const worker = pool.createWorker(effectiveKey, owner, {
    limit: effectiveLimit,
    worker: effectiveWorker,
  });
  const payload = {
    ...normalized,
    method: m,
    object,
    // The two worker scripts consume the file directly. Expose the stream
    // reader's object in that shape as well, so converter.js can detect
    // PDF vs DOCX from the bytes/path without a caller-side format split.
    filename: normalized.filename
      ?? object.filename
      ?? (typeof object.path === "string" ? object.path.split(/[\\/]/).pop() : null),
    inPath: normalized.inPath ?? object.path ?? null,
    data: normalized.data ?? object.bytes ?? null,
    // True when the input door already ran qpdf over the file: the
    // worker's parse then seeks in the prepared file instead of
    // preparing a second time.
    prepared: object.prepared === true,
    caller: who,
    identity,
    owner,
    // The trigger's params, carried into the worker untouched. `key` picks
    // one of the only two worker scripts; `output` is the requested file
    // type for that worker to produce.
    limit: effectiveLimit,
    worker: effectiveWorker,
    key: effectiveKey,
    output: effectiveOutput,
  };
  return pool.submit(worker, payload, budgetFor(effectiveLimit, owner));
}

export async function dispatchSite(request = {}) {
  return dispatch({ ...request, caller: "public" });
}

export async function dispatchLocal(request = {}) {
  return dispatch({ ...request, caller: "owner" });
}

export async function dispatchServices(request = {}) {
  return dispatch({ ...request, caller: "scraper" });
}

export {
  normalizeJob,
  ownerForCaller,
  keyForJob,
  normalizeWorkerKey,
  normalizeOutput,
};


// FILE: beautify/beautify.js
/*
(Repair 3) Repair branch, position 3 in the chain - text fixing used inside the repair stage (Repair 2).
This module beautifies tokens: it splits glued numbers and fixes homoglyph mistakes using the master word data.
*/


























import { loadMapJson } from "../json-map.js";
import { scanText, scanBrokenSpans } from "./scan.js";
import {
  orderText, unmixZawCodeMarks, retraceZawCodeMarks, settleZawCodeAhE,
  medialFollows, reorderMarks,
} from "../clean.js";
import { scoreText, isIndex } from "../decoding/judgement.js";
import { arrangeZawCodeOrder } from "../zawcode-order.js";

const DATA = loadMapJson("homoglyphs.json");


export const HOMOGLYPH_PAIRS = DATA.pairs.map(([a, b]) => [a, b]);


const SWAPS = HOMOGLYPH_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]);


const MM_RUN = /[\u1000-\u1049\u105a-\u109f]+/gu;





export function homoglyphVariants(token) {
  const out = new Set();
  for (const [from, to] of SWAPS) {
    if (!token.includes(from)) continue;
    out.add(token.split(from).join(to));
    let i = -1;
    while ((i = token.indexOf(from, i + 1)) >= 0) {
      out.add(token.slice(0, i) + to + token.slice(i + 1));
    }
  }
  out.delete(token);
  return [...out];
}





export function beautifyToken(token, words) {
  // A number on its own is not evidence that ၀ or ၇ should become a letter.
  if (/^[၀-၉]+$/u.test(token) || !words || !words.size) return null;
  const variants = homoglyphVariants(token);
  if (!variants.length || words.has(token)) return null;
  const hits = variants.filter((v) => words.has(v));
  return hits.length === 1 ? hits[0] : null;
}





export function beautifyHomoglyphs(text, words) {
  if (!text || !words || !words.size) return { text, repairs: [] };
  const tally = new Map();
  const out = String(text).replace(MM_RUN, (token) => {
    const fixed = beautifyToken(token, words);
    if (!fixed) return token;
    const key = `${token}\u0000${fixed}`;
    tally.set(key, (tally.get(key) || 0) + 1);
    return fixed;
  });
  const repairs = [...tally].map(([k, count]) => {
    const [from, to] = k.split("\u0000");
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);
  return { text: out, repairs };
}

















export function splitGluedNumber(token, words) {
  if (!words || !words.size) return null;
  const tail = /^(.*?)([\u1040-\u1049]+)$/u.exec(token);
  const head = /^([\u1040-\u1049]+)(.*)$/u.exec(token);
  if ((!tail?.[1] && !head?.[2]) || words.has(token)) return null;
  const tailOk = Boolean(tail && tail[1] && words.has(tail[1]));
  const headOk = Boolean(head && head[2] && words.has(head[2]));
  if (tailOk && headOk) return null;
  if (tailOk) return [tail[1], tail[2]];
  if (headOk) return [head[1], head[2]];
  return null;
}





export function beautifyText(text, words) {
  const first = beautifyHomoglyphs(text, words);
  const tally = new Map();
  const out = first.text.replace(MM_RUN, (token) => {
    const parts = splitGluedNumber(token, words);
    if (!parts) return token;
    tally.set(token, (tally.get(token) || 0) + 1);
    return parts.join(" ");
  });
  const splits = [...tally].map(([from, count]) => ({ from, count }))
    .sort((a, b) => b.count - a.count);
  return { text: out, repairs: first.repairs, splits };
}



























const MEND_GATE_RULES = ["orphan", "impossible", "stray", "virama", "unknown"];

function gateHits(token, words, standalone) {
  const rep = scanText(token, { perRule: 1 });
  const structural = MEND_GATE_RULES.reduce((n, k) => n + (rep[k]?.total ?? 0), 0);
  return structural + (typeof words?.unknownCount === "function" ? words.unknownCount(token) : 0);
}















export function zawCodeGuard(sample, words, standalone = []) {
  const empty = {
    zawcode: false, pureScore: 0, crossedScore: 0, marks: 0,
    pureGate: 0, crossedGate: 0, gain: 0,
  };
  if (!sample || !words || !words.size) return empty;
  const pureText = orderText(String(sample));
  const crossedText = orderText(unmixZawCodeMarks(String(sample)));
  const pure = scoreText(pureText);
  const crossed = scoreText(crossedText);
  const pureGate = gateHits(pureText, words, standalone);
  const crossedGate = gateHits(crossedText, words, standalone);
  const gain = pureGate - crossedGate;
  const zawcode = pure.marks >= 50
    && pure.score >= 0.99
    && crossed.score >= pure.score - 0.001
    && crossedText !== pureText
    && pureGate >= 10
    && gain >= 2
    && gain * 20 >= pureGate;
  return {
    zawcode,
    pureScore: pure.score,
    crossedScore: crossed.score,
    marks: pure.marks,
    pureGate,
    crossedGate,
    gain,
  };
}
























const MEND_MEDIALS = new Set(["\u103B", "\u103C", "\u103D", "\u103E"]);
const MEND_VOWEL_MARKS = new Set([
  "\u102B", "\u102C", "\u102D", "\u102E", "\u102F", "\u1030", "\u1031",
  "\u1032", "\u1033", "\u1034", "\u1035",
]);
const MEND_HA_HOSTS = new Set(["\u1019", "\u100A", "\u101B"]);
const MEND_WA_HA_HOSTS = new Set(["\u101C", "\u101B", "\u100A", "\u1014", "\u1019"]);
const MEND_STACK_SECONDS = new Set([
  "\u1001", "\u1005", "\u1006", "\u1010", "\u1012", "\u1013", "\u1015",
  "\u1018", "\u1019",
]);




function zawCodeClusters(chars) {
  const res = [];
  let i = 0;
  while (i < chars.length) {
    if (isIndex(chars[i])) {
      let j = i + 1;
      while (j < chars.length && !isIndex(chars[j])) {
        if (chars[j] === "\u1039" && j + 1 < chars.length && isIndex(chars[j + 1])) break;
        j += 1;
      }
      res.push({ start: i, end: j });
      i = j;
    } else i += 1;
  }
  return res;
}


export function zawCodeInsertionVariants(token) {
  const chars = Array.from(token);
  const variants = new Set();
  const add = (pos, str) => {
    const c = [...chars];
    c.splice(pos, 0, ...Array.from(str));
    variants.add(reorderMarks(c.join("")));
  };
  for (const cl of zawCodeClusters(chars)) {
    const base = chars[cl.start];
    const marks = chars.slice(cl.start + 1, cl.end);
    let medialEnd = cl.start + 1;
    while (medialEnd < cl.end && MEND_MEDIALS.has(chars[medialEnd])) medialEnd += 1;
    const closed = marks.includes("\u103A");
    const vowelFree = !marks.some((m) => MEND_VOWEL_MARKS.has(m));
    if (medialFollows("\u103C", base) && !marks.includes("\u103C")) add(cl.start + 1, "\u103C");
    if (MEND_HA_HOSTS.has(base) && !marks.includes("\u103E")) add(cl.start + 1, "\u103E");
    if (MEND_WA_HA_HOSTS.has(base) && !marks.includes("\u103D") && !marks.includes("\u103E")) {
      add(cl.start + 1, "\u103D\u103E");
    }



    if (vowelFree && !closed && chars[cl.start - 1] !== "\u1031") add(medialEnd, "\u1030");
    const uFree = !marks.some((m) => [
      "\u102B", "\u102C", "\u102E", "\u102F", "\u1030", "\u1031", "\u1032",
    ].includes(m));
    if (uFree && !closed) {
      let pos = medialEnd;
      if (chars[pos] === "\u102D") pos += 1;
      add(pos, "\u102F");
    }
  }
  for (let i = 0; i + 1 < chars.length; i += 1) {
    if (isIndex(chars[i]) && isIndex(chars[i + 1]) && MEND_STACK_SECONDS.has(chars[i + 1])) {
      add(i + 1, "\u1039");
    }
  }
  variants.delete(token);
  return [...variants];
}


export function zawCodeSpuriousIVariants(token) {
  const out = new Set();
  let idx = -1;
  while ((idx = token.indexOf("\u102D\u102F", idx + 1)) >= 0) {
    out.add(token.slice(0, idx) + "\u102F" + token.slice(idx + 2));
  }
  out.delete(token);
  return [...out];
}










function mendZawCodeToken(token, words, standalone) {
  const own = gateHits(token, words, standalone);
  const wins = (cand) => (cand && cand !== token
    && (typeof words.unknownCount !== "function" || words.unknownCount(cand) === 0)
    && gateHits(cand, words, standalone) < own ? cand : null);
  const arbitrate = (variants) => {
    const hits = variants.filter((v) => wins(v));
    return hits.length === 1 ? hits[0] : null;
  };
  const unmixed = unmixZawCodeMarks(token);
  let fixed = wins(unmixed);
  if (fixed) return fixed;
  const retraced = retraceZawCodeMarks(token);
  fixed = wins(retraced) || wins(unmixZawCodeMarks(retraced)) || wins(retraceZawCodeMarks(unmixed));
  if (fixed) return fixed;
  const base = retraced !== token ? retraced : token;
  return arbitrate(zawCodeInsertionVariants(base))
    || arbitrate(zawCodeSpuriousIVariants(base))
    || wins(settleZawCodeAhE(base));
}


















function zawCodeFrameFix(token, words, standalone) {
  const candidates = [];
  if (token.startsWith("\u101e\u1010\u102d\u102f\u1037")) {
    candidates.push("\u101e\u1030" + token.slice(1));
  } else if (token.startsWith("\u101e\u1037") && token.length > 2) {
    candidates.push("\u101e\u1030\u1037" + token.slice(2));
  } else {
    const chars = Array.from(token);
    if (!(chars[0] === "\u1021" && chars[1] === "\u1031" && chars[2] !== undefined && isIndex(chars[2]))) {
      return null;
    }
    const retraced = retraceZawCodeMarks(token);
    candidates.push(settleZawCodeAhE(retraced), retraced, settleZawCodeAhE(token));
  }
  if (words.has(token)) return null;
  for (const cand of candidates) {
    for (const v of [cand, retraceZawCodeMarks(cand)]) {
      if (v && v !== token && gateHits(v, words, standalone) === 0) return v;
    }
  }
  return null;
}

export function mendZawCodeText(text, words, standalone = [], { skipTokens = null } = {}) {
  if (!text || !words || !words.size) return { text, repairs: [] };
  const isProtected = (token) => skipTokens?.size
    && (token.match(MM_RUN) || []).some((part) => skipTokens.has(part));
  const spans = scanBrokenSpans(String(text));
  if (typeof words.unknownCount === "function") {
    for (const match of String(text).matchAll(MM_RUN)) {
      if (!words.unknownCount(match[0])) continue;
      const start = match.index;
      const end = start + match[0].length;
      if (!spans.some((span) => span.start < end && span.end > start)) {
        spans.push({ start, end, token: match[0], rules: ["unknown"] });
      }
    }
    spans.sort((a, b) => a.start - b.start);
  }
  const tally = new Map();
  const tallyAdd = (from, to) => {
    const key = `${from}\u0000${to}`;
    tally.set(key, (tally.get(key) || 0) + 1);
  };
  let out = String(text);

  const cache = new Map();
  const mendCached = (token) => {
    if (!cache.has(token)) cache.set(token, mendZawCodeToken(token, words, standalone));
    return cache.get(token);
  };
  for (let s = spans.length - 1; s >= 0; s -= 1) {
    const { start, end, token } = spans[s];




    if (isProtected(token)) continue;
    const fixed = mendCached(token);
    if (!fixed) continue;
    tallyAdd(token, fixed);
    out = out.slice(0, start) + fixed + out.slice(end);
  }
  out = out.replace(MM_RUN, (token) => {
    if (isProtected(token)) return token;
    const fixed = zawCodeFrameFix(token, words, standalone);
    if (!fixed) return token;
    tallyAdd(token, fixed);
    return fixed;
  });
  const repairs = [...tally].map(([k, count]) => {
    const [from, to] = k.split("\u0000");
    return { from, to, count };
  }).sort((a, b) => b.count - a.count);
  return { text: out, repairs };
}






















export function beautifyFromScanVerdict(pages, report, words, {
  path = null, standalone = [], preserveZawCodeOrder = false,
} = {}) {
  if (path !== "zawcode" || !report || !words || !words.size) return pages;
  return pages.map((page) => {
    const text = page?.text || "";
    if (!text) return page;
    const skipTokens = new Set();
    if (preserveZawCodeOrder) {
      const sources = [text, ...(Array.isArray(page.lines) ? page.lines.map((line) => String(line[3] ?? "")) : [])];
      for (const source of sources) {
        for (const match of source.matchAll(MM_RUN)) {
          if (arrangeZawCodeOrder(match[0]) !== match[0]) skipTokens.add(match[0]);
        }
      }
    }
    const mended = mendZawCodeText(text, words, standalone, { skipTokens });
    if (mended.text === text) return page;
    const byToken = new Map(mended.repairs.map(({ from, to }) => [from, to]));
    let lines = Array.isArray(page.lines)
      ? page.lines.map(([x, y, size, lineText]) => [
        x, y, size,
        String(lineText ?? "").replace(MM_RUN, (token) => byToken.get(token) ?? token),
      ])
      : page.lines;





    if (Array.isArray(lines)
      && lines.every((line, i) => line[3] === page.lines[i][3])) {
      lines = page.lines.map(([x, y, size, lineText]) => [
        x, y, size,
        mendZawCodeText(String(lineText ?? ""), words, standalone, { skipTokens }).text,
      ]);
    }
    return { ...page, text: mended.text, ...(lines ? { lines } : {}) };
  });
}


// FILE: beautify/repair.js
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
} from "./scan.js";
import {
  beautifyText, beautifyFromScanVerdict, mendZawCodeText, zawCodeGuard,
} from "./beautify.js";

// Raw-font evidence is available to a repair caller that retained provenance.
// These lookups return candidates only; they never alter text automatically.
export { pdfBeautifyCandidates, physicalKeyCandidates, evidenceForOutput } from "../codepage/codepage-pooled.js";

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

    const pos = await scanLineWithPos(record.text, { bindEngine });
    const posUnknownTokens = pos.tokens
      .filter((token) => token.kind === "unknown" && MYANMAR_CHAR.test(token.word))
      .map((token) => token.word);
    // Full-line POS is the line verdict; whole Myanmar runs give the exact
    // broken spans. This keeps foreign text and punctuation that the Engine
    // segments as "unknown" out of the SVG request list.
    const spans = posUnknownTokens.length
      ? await scanBrokenSpansWithPos(record.text, { bindEngine })
      : scanBrokenSpans(record.text);
    const lineSpans = normaliseSpans(record.text, spans);
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
      text: record.text,
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
    vote ??= await import("../codepage/vote.js");
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


// FILE: beautify/repair/svg/build-svg.js
#!/usr/bin/env node
/*
(Repair 12) Repair branch, position 12 in the chain - a build-time tool, not part of a live parse.
This module builds the expanded font-11 Burmese+Pali index SVG used as a glyph reference. Identical twin of B.Parser/main/parser/js/build-svg.js.
*/
/**
 * Build one expanded font-11 Burmese+Pali index SVG (build-time HarfBuzz shaping).
 * JS mirror of B.Parser/main/Python/make-index-font11.py.
 *
 * The A4 pages are stacked vertically in one SVG canvas (panel 1 at top,
 * then panel 2 below, then panel 3 below that).
 *
 * Order requested by the owner:
 *   1. Myanmar marks separately, omitting the standalone U+1039 entry;
 *   2. all base consonants from master MMap.Base;
 *   3. all Myanmar digits;
 *   4. all Burmese syllables from tools-box/js/scripts.db;
 *   5. Pali syllables for the SVG only: the stack parts filtered from the
 *      master dictionary (segments containing U+1039) plus the owner's given
 *      Pali list.
 *
 * E = 5.5, word slot = 3E = 16.5, spacing band = E = 5.5, pitch/cell = 22.
 * Pink cell border, blue bounded lines (baseline +/- E), yellow baseline.
 */

import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const Database = (await import("better-sqlite3")).default;
import opentypeDefault from "opentype.js";
const opentype = opentypeDefault.default || opentypeDefault;
import { Blob, Face, Font, Buffer, shape } from "harfbuzzjs";

const SIZE = 11.0;
const E = SIZE * 0.5;
const PITCH = 22.0;
const BASELINE0 = 33.0;
const WIDTH = 595.276;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 22.0;
const ROWS_PER_PAGE = 37;
const GAP = 3.206;

const MARKS = [
  "\u103B", "\u103C", "\u103D", "\u103E",
  "\u1031",
  "\u102D", "\u102E", "\u102F", "\u1030", "\u1032",
  "\u102C", "\u102B",
  "\u1036", "\u103A", "\u1037", "\u1038",
];

const BASE_CONSONANTS_MASTER_ORDER = [
  "က", "ခ", "ဂ", "ဃ", "င", "စ", "ဇ", "ည", "ဋ", "ဉ", "ဍ", "ဏ", "တ", "ထ", "ဒ", "န",
  "ပ", "ဖ", "ဗ", "ဘ", "မ", "ယ", "ရ", "လ", "သ", "ဟ", "အ", "ဥ", "ဧ", "ဈ", "ဝ", "ဓ",
  "ဩ", "ဿ", "ဣ", "ဦ", "ဠ", "ဌ", "ဆ", "ဎ", "ဪ", "၎",
];
const DIGITS = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];

const USER_GIVEN_PALI = [
  "\u1004\u103A\u1039\u1000",
  "\u1004\u103A\u1039\u1001",
  "\u1004\u103A\u1039\u1002",
  "\u1004\u103A\u1039\u1002\u102B",
  "\u1010\u1039\u1010\u1030",
  "\u1000\u1039\u1000\u1030",
  "\u1000\u1039\u1000\u102D\u102F",
  "\u1000\u103A\u103B\u102C\u1038",
  "\u1004\u103A\u1039\u101E\u1031\u1037",
  "\u1019\u1039\u1018\u102C",
  "\u1005\u1039\u1005\u100A\u103A\u1038",
  "\u1010\u102D\u1036",
  "\u1010\u1039\u1010\u102F",
  "\u1010\u1039\u1011\u102D",
];

function fmt(value, digits = 2) {
  const text = value.toFixed(digits);
  return ["-0", "-0.0", "-0.00", "-0.000"].includes(text) ? "0" : text;
}

function pathNumber(token) {
  const text = parseFloat(token).toFixed(3).replace(/\.?0+$/, "");
  return text === "" || text === "-0" ? "0" : text;
}

function roundPathNumbers(pathData) {
  const tokens = pathData.match(
    /[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.\d+(?:e-?\d+)?|-?\d+/g
  ) || [];
  const params = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, S: 4, T: 2, A: 7, Z: 0 };
  const out = [];
  let cmd = "";
  let firstGroup = true;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      cmd = token;
      firstGroup = true;
      out.push(cmd);
      i += 1;
      continue;
    }
    if (!cmd) {
      i += 1;
      continue;
    }
    const count = params[cmd.toUpperCase()];
    const group = tokens.slice(i, i + count);
    if (group.length < count) break;
    if (!firstGroup) {
      out.push(cmd === "M" ? "L" : cmd === "m" ? "l" : cmd);
    }
    group.forEach((part) => out.push(pathNumber(part)));
    firstGroup = false;
    i += count;
  }
  return out.join(" ").replace(/^ /, "").trim();
}

function attr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function codepoints(text) {
  return [...text]
    .map((ch) => `U+${ch.codePointAt(0).toString(16).padStart(4, "0")}`)
    .join(" ");
}

function loadUnits(dbPath) {
  const db = new Database(dbPath, { readonly: true });

  const burmese = db
    .prepare("SELECT line FROM burmese_syllables ORDER BY id")
    .all()
    .map((row) => row.line);

  const masterRow = db.prepare("SELECT data FROM master_json WHERE id=1").get();
  const master = JSON.parse(masterRow.data);
  db.close();

  const dictionaryPali = [];
  const dictionarySeen = new Set();
  let dictionaryOccurrences = 0;
  let dictionaryEntries = 0;

  for (const entries of Object.values(master.dictionary)) {
    for (const entry of entries) {
      const hits = entry
        .trim()
        .split(/\s{2,}/)
        .filter((seg) => seg && seg.includes("\u1039"));
      if (hits.length) dictionaryEntries += 1;
      for (const seg of hits) {
        dictionaryOccurrences += 1;
        if (!dictionarySeen.has(seg)) {
          dictionarySeen.add(seg);
          dictionaryPali.push(seg);
        }
      }
    }
  }

  const pali = [...dictionaryPali];
  const userGivenCandidates = [];
  for (const text of USER_GIVEN_PALI) {
    if (!dictionarySeen.has(text)) {
      userGivenCandidates.push(text);
      pali.push(text);
    }
  }

  const bases = [...new Set(BASE_CONSONANTS_MASTER_ORDER)].sort(
    (a, b) => a.codePointAt(0) - b.codePointAt(0)
  );

  const groups = [
    ["mark", MARKS],
    ["consonant", bases],
    ["digit", DIGITS],
    ["syllable", burmese],
    ["pali", pali],
  ];

  const seen = new Set();
  const units = [];
  const counts = {};
  let duplicates = 0;

  for (const [kind, values] of groups) {
    let kept = 0;
    for (const text of values) {
      if (seen.has(text)) {
        duplicates += 1;
        continue;
      }
      seen.add(text);
      units.push({
        text,
        kind,
        cp: codepoints(text),
        newRowBefore: kept === 0 && units.length > 0,
      });
      kept += 1;
    }
    counts[kind] = kept;
  }

  counts.total = units.length;
  counts.duplicatesSkipped = duplicates;
  counts.burmeseRows = burmese.length;
  counts.dictionaryPaliUnique = dictionaryPali.length;
  counts.dictionaryPaliOccurrences = dictionaryOccurrences;
  counts.dictionaryPaliEntries = dictionaryEntries;
  counts.userGivenPali = USER_GIVEN_PALI.length;
  counts.userGivenPaliCandidates = userGivenCandidates.length;
  counts.userGivenPaliAdded = counts.pali - dictionaryPali.length;

  return { units, counts };
}

class Shaper {
  constructor(fontPath) {
    const fontData = readFileSync(fontPath);
    this.font = opentype.parse(fontData);
    this.upm = this.font.unitsPerEm || 2048;
    this.k = SIZE / this.upm;
    this.paths = new Map();
    this.notdefTexts = [];

    const blob = new Blob(fontData);
    const hbFace = new Face(blob);
    this.hbFont = new Font(hbFace);
  }

  glyphPath(gid) {
    if (this.paths.has(gid)) return this.paths.get(gid);

    const glyph = this.font.glyphs.get(gid);
    if (!glyph) return "";

    const path = glyph.path;
    const scale = this.k;
    let d = "";

    path.commands.forEach((cmd) => {
      const type = cmd.type;
      const x = cmd.x * scale;
      const y = -cmd.y * scale;
      const x2 = cmd.x2 !== undefined ? cmd.x2 * scale : 0;
      const y2 = cmd.y2 !== undefined ? -cmd.y2 * scale : 0;
      const x1 = cmd.x1 !== undefined ? cmd.x1 * scale : 0;
      const y1 = cmd.y1 !== undefined ? -cmd.y1 * scale : 0;

      switch (type) {
        case "M":
          d += `M${fmt(x)} ${fmt(y)} `;
          break;
        case "L":
          d += `L${fmt(x)} ${fmt(y)} `;
          break;
        case "Q":
          d += `Q${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} `;
          break;
        case "C":
          d += `C${fmt(x2)} ${fmt(y2)} ${fmt(x1)} ${fmt(y1)} ${fmt(x)} ${fmt(y)} `;
          break;
        case "Z":
          d += "Z ";
          break;
      }
    });

    const rounded = roundPathNumbers(d.trim());
    this.paths.set(gid, rounded);
    return rounded;
  }

  shape(text) {
    const buf = new Buffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    shape(this.hbFont, buf, [], []);

    const infos = buf.getGlyphInfos();
    const positions = buf.getGlyphPositions();

    let cursor = 0;
    const uses = [];
    let sawNotdef = false;

    for (let i = 0; i < infos.length; i++) {
      const gid = infos[i].codepoint;
      const pos = positions[i];
      const x = (cursor + pos.xOffset) * this.k;
      const y = -pos.yOffset * this.k;
      cursor += pos.xAdvance;

      if (gid === 0) sawNotdef = true;

      const glyphName = this.font.glyphs.get(gid)?.name;
      if (glyphName === "uni25CC") continue;

      const path = this.glyphPath(gid);
      if (path) {
        uses.push({ gid, x, y });
      }
    }

    if (sawNotdef) this.notdefTexts.push(text);

    return { uses, advance: cursor * this.k };
  }
}

function layout(units) {
  const sheets = [];
  let sheet = [];
  let row = 0;
  let cursorX = MARGIN_X;

  function startRow() {
    if (row + 1 >= ROWS_PER_PAGE) {
      sheets.push(sheet);
      sheet = [];
      row = 0;
    } else {
      row += 1;
    }
    cursorX = MARGIN_X;
  }

  for (const unit of units) {
    const advance = unit.advance + GAP;
    if (unit.newRowBefore && cursorX > MARGIN_X) {
      startRow();
    }
    if (cursorX + advance > WIDTH - MARGIN_X && cursorX > MARGIN_X) {
      startRow();
    }
    const placed = {
      ...unit,
      row,
      x: cursorX,
      baseline: BASELINE0 + row * PITCH,
    };
    sheet.push(placed);
    cursorX += advance;
  }
  if (sheet.length > 0) sheets.push(sheet);
  return sheets;
}

function ruleLine(y, x0 = 0, inset = 0.35) {
  return `<line x1="${fmt(x0 + inset)}" y1="${fmt(y)}" x2="${fmt(x0 + WIDTH - inset)}" y2="${fmt(y)}"/>`;
}

function mergedSvg(panels, shaper) {
  const totalHeight = PAGE_HEIGHT * panels.length;
  const allEntries = panels.flat();
  const usedGids = new Set();
  for (const entry of allEntries) {
    for (const use of entry.uses) {
      usedGids.add(use.gid);
    }
  }
  const sortedGids = [...usedGids].sort((a, b) => a - b);

  const defs = sortedGids
    .map((gid) => `<path id="g${gid}" d="${attr(shaper.paths.get(gid))}"/>`)
    .join("\n");

  const cells = [];
  const blue = [];
  const yellow = [];
  const bodyParts = [];
  const rules = [];
  const panelRows = [];

  for (let panelIndex = 0; panelIndex < panels.length; panelIndex++) {
    const entries = panels[panelIndex];
    const offsetY = panelIndex * PAGE_HEIGHT;
    const rows = [...new Set(entries.map((e) => e.row))].sort((a, b) => a - b);
    panelRows.push(rows.length);

    for (const r of rows) {
      const baseline = BASELINE0 + r * PITCH + offsetY;
      cells.push(
        `<rect id="p${panelIndex + 1}-line${r + 1}+gap" x="${fmt(MARGIN_X)}" y="${fmt(baseline - 2 * E)}" width="${fmt(WIDTH - 2 * MARGIN_X)}" height="${fmt(PITCH)}"/>`
      );
      blue.push(ruleLine(baseline, MARGIN_X, -E));
      blue.push(ruleLine(baseline, MARGIN_X, E));
      yellow.push(ruleLine(baseline, MARGIN_X, 0));
      rules.push([-2 * E, -E, 0, E, 2 * E].map((d) => fmt(baseline + d)).join(","));
    }

    for (const entry of entries) {
      const globalY = offsetY + entry.baseline;
      const uses = entry.uses
        .map(
          (use) =>
            `<use href="#g${use.gid}" x="${fmt(MARGIN_X + use.x)}" y="${fmt(globalY + use.y)}"/>`
        )
        .join("");
      bodyParts.push(
        `<g id="${attr(entry.text)}" data-kind="${attr(entry.kind)}" data-cp="${attr(entry.cp)}" data-row="${entry.row}" data-y="${fmt(globalY)}" data-baseline="${fmt(globalY)}">${uses}</g>`
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Burmese+Pali index (font 11), one expanded SVG: ${panels.length} A4 panels stacked vertically.
     Panel 1 at top, then panel 2 below, then panel 3 below that.
     Order: marks separately (no standalone U+1039), base consonants, Myanmar digits,
     then Burmese syllables, then Pali syllables. SVG Pali is restricted to the
     dictionary U+1039 parts plus the owner-given list; it is not master syllables.pali.
     E = 5.5; word slot = 16.5 (baseline-11..baseline+5.5); spacing band = 5.5;
     line+gap cell/pitch = 22. Pink = shared cell border/end of spacing,
     blue = baseline +/- 5.5, yellow = baseline. Shaped with HarfBuzz at build time. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(WIDTH)}" height="${fmt(totalHeight)}" viewBox="0 0 ${fmt(WIDTH)} ${fmt(totalHeight)}"
     data-font="PYIDAUNGSU-2.5.2_REGULAR.TTF" data-shaped="harfbuzz" data-size="11" data-em="11"
     data-line-h="22" data-pitch="22" data-E="5.5" data-band="0.5" data-slot="16.5" data-cell="22" data-spacing="5.5"
     data-layout="vertical-a4-panels" data-panels="${panels.length}" data-pages="${panels.length}" data-panel-height="${fmt(PAGE_HEIGHT)}"
     data-rows="${Math.max(...panelRows, 0)}" data-total-rows="${panelRows.reduce((a, b) => a + b, 0)}" data-rows-per-page="${ROWS_PER_PAGE}"
     data-baseline0="33" data-count="${allEntries.length}" data-glyphs="${sortedGids.length}" data-rules="${attr(rules.join(";"))}">
<title>Pyidaungsu Burmese+Pali index — font 11, ${panels.length} A4 panels stacked vertically</title>
<rect x="0" y="0" width="${fmt(WIDTH)}" height="${fmt(totalHeight)}" fill="#FFFFFF"/>
<g id="lines" fill="#E5E5E5" stroke="#FF6EAE" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round">${cells.join("")}</g>
<defs>
${defs}
</defs>
<g fill="#000000" fill-rule="evenodd">
${bodyParts.join("")}
</g>
<g id="bounded" stroke="#77BDFD" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${blue.join("")}</g>
<g id="baselinegroup" stroke="#FFFF00" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${yellow.join("")}</g>
</svg>`;
}

async function main() {
  const args = process.argv.slice(2);
  let fontPath = resolve("Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF");
  let dbPath = resolve("tools-box/js/scripts.db");
  let outPath = resolve("B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali.svg");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--font") fontPath = resolve(args[++i]);
    else if (args[i] === "--db") dbPath = resolve(args[++i]);
    else if (args[i] === "--out") outPath = resolve(args[++i]);
  }

  const { units, counts } = loadUnits(dbPath);
  const shaper = new Shaper(fontPath);

  for (const unit of units) {
    Object.assign(unit, shaper.shape(unit.text));
  }

  const panels = layout(units);

  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, mergedSvg(panels, shaper), { encoding: "utf8" });

  console.log(JSON.stringify({
    counts,
    file: outPath,
    width: WIDTH,
    height: PAGE_HEIGHT * panels.length,
    panels: panels.map((entries, i) => ({
      panel: i + 1,
      yOffset: i * PAGE_HEIGHT,
      entries: entries.length,
      rows: [...new Set(entries.map((e) => e.row))].length,
    })),
    distinctGlyphs: shaper.paths.size,
    notdefTexts: shaper.notdefTexts,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


// FILE: beautify/repair/svg/make-line.js
/*
(Repair 6) Repair branch, position 6 in the chain - builds the line picture a repair decision is made from.
This module turns one exported page into line SVGs: it groups glyphs into lines with the four-rule line frame. It is the JS twin of the Python make_line.py and must produce identical bytes.
*/
// JS twin of B.Parser/main/Python/make_line.py — same input, same bytes.
//
// Standalone: does not call Python. The Python side does not call this
// either. Both read the same page export and must produce identical SVG.
//
//   node make-line.js <page.svg> [seed] [suffix] [only-lines]
//
// Size is NOT a constant. Every glyph carries its own: the page export
// writes <use transform="matrix(sx,0,0,-sy,x,y)"> and sx IS the font size
// in points, because the glyph paths in <defs> are in em units.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  framesOf, pitchOf, blankOf, overflow, bandFor, lineSvg, sheetSvg, fixed, num,
} from "./scan-frame.js";

export const UNITS = 0.9; // baseline grouping tolerance, as a fraction of the size

const NUM = /[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const ARITY = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, Z: 0 };

export function bboxOf(d, cache = new Map()) {
  // Glyph bbox in em units, walked command by command.
  //
  // Control points are included, so the box is a superset: the fit check
  // can only be pessimistic, never optimistic. H and V take one number,
  // which is why a naive "numbers come in pairs" scan desyncs and
  // invents ink.
  if (cache.has(d)) return cache.get(d);
  const tok = d.match(NUM) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const note = (px, py) => {
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
  };

  let cmd = null;
  while (i < tok.length) {
    if (/^[A-Za-z]$/.test(tok[i])) {
      cmd = tok[i];
      i += 1;
    }
    if (cmd === null) throw new Error("invalid glyph path: missing command");
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === "Z") {
      x = sx;
      y = sy;
      cmd = null;
      continue;
    }
    const n = ARITY[C];
    if (n === undefined) throw new Error(`unsupported glyph path command ${cmd}`);
    if (i + n > tok.length) throw new Error("invalid glyph path: truncated command");
    if (tok.slice(i, i + n).some((v) => /^[A-Za-z]$/.test(v))) {
      throw new Error("invalid glyph path: missing arguments");
    }
    const v = tok.slice(i, i + n).map(Number);
    i += n;
    const ox = x;
    const oy = y;
    if (C === "H") {
      x = rel ? x + v[0] : v[0];
      note(x, y);
    } else if (C === "V") {
      y = rel ? y + v[0] : v[0];
      note(x, y);
    } else if (C === "M") {
      x = rel ? x + v[0] : v[0];
      y = rel ? y + v[1] : v[1];
      sx = x;
      sy = y;
      note(x, y);
      cmd = rel ? "l" : "L";
    } else if (C === "L") {
      x = rel ? x + v[0] : v[0];
      y = rel ? y + v[1] : v[1];
      note(x, y);
    } else if (C === "C") {
      for (let k = 0; k < 6; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[4] : v[4];
      y = rel ? oy + v[5] : v[5];
    } else if (C === "Q") {
      for (let k = 0; k < 4; k += 2) note(rel ? ox + v[k] : v[k], rel ? oy + v[k + 1] : v[k + 1]);
      x = rel ? ox + v[2] : v[2];
      y = rel ? oy + v[3] : v[3];
    }
  }

  const r = x0 === Infinity ? null : [x0, y0, x1, y1];
  cache.set(d, r);
  return r;
}

// Preserve every use in its source group/order. The reader accepts the SVG
// form produced by pdf2svg.py; unfamiliar containers or references fail
// explicitly rather than yielding a partial sheet.
const TAGS = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const IDENTITY = [1, 0, 0, 1, 0, 0];
const CSS_ATTRS = ["style", "class"];
const EFFECT_ATTRS = ["stroke", "stroke-width", "filter", "mask", "marker",
  "marker-start", "marker-mid", "marker-end"];

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function attr(tag, name) {
  const m = new RegExp(`(?:^|\\s)${escapeRegExp(name)}\\s*=\\s*(["'])([\\s\\S]*?)\\1`).exec(tag);
  return m ? m[2] : null;
}

function hasAny(tag, names) {
  return names.some((name) => attr(tag, name) !== null);
}

export function matrix(value) {
  if (value === null || value === undefined) return IDENTITY;
  const m = /^matrix\s*\(([^)]*)\)\s*$/.exec(value.trim());
  if (!m) return null;
  const parts = m[1].trim().split(/[\s,]+/).map(Number);
  return parts.length === 6 && parts.every(Number.isFinite) ? parts : null;
}

export function multiply(p, q) {
  if (!p || !q) return null;
  const [a, b, c, d, e, f] = p;
  const [g, h, i, j, k, l] = q;
  return [a * g + c * h, b * g + d * h, a * i + c * j,
    b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

export function readScene(source) {
  const defs = {};
  const pathFlags = {};
  const bodyDefs = {};
  const references = new Set();
  const defined = new Set();
  const allIds = new Set();
  const definitions = [];
  const scene = [];
  const sourceUses = [];
  const groups = [];
  let defsDepth = 0;
  let defsStart = 0;
  let end = 0;
  let root = null;
  let rootClosed = false;
  let stylesheet = false;
  let definitionEffects = false;

  const rememberPath = (gid, tag) => {
    const d = attr(tag, "d");
    if (d === null) return;
    defs[gid] = d;
    pathFlags[gid] = {
      css: hasAny(tag, CSS_ATTRS) || attr(tag, "transform") !== null,
      effects: hasAny(tag, EFFECT_ATTRS),
    };
  };

  TAGS.lastIndex = 0;
  let match;
  while ((match = TAGS.exec(source)) !== null) {
    if (source.slice(end, match.index).includes("<")) {
      throw new Error("malformed SVG markup");
    }
    const tag = match[0];
    end = match.index + tag.length;
    if (tag.startsWith("<!--") || tag.startsWith("<?")) continue;
    if (tag.startsWith("<!")) throw new Error("unsupported SVG declaration");
    if (tag.slice(1).includes("<")) throw new Error("malformed SVG markup");
    const nameMatch = /^<\s*(\/?)\s*([A-Za-z_][A-Za-z0-9:_.-]*)/.exec(tag);
    if (!nameMatch) throw new Error("unsupported SVG tag");
    const closing = Boolean(nameMatch[1]);
    const name = nameMatch[2];
    if (name.includes(":")) throw new Error(`unsupported namespaced SVG element <${name}>`);
    const selfClosing = /\/\s*>$/.test(tag);
    const gid = closing ? null : attr(tag, "id");
    if (gid) {
      if (allIds.has(gid)) {
        throw new Error(`duplicate SVG id ${gid}; the page was not emitted`);
      }
      allIds.add(gid);
    }
    const href = closing ? null : (attr(tag, "xlink:href") ?? attr(tag, "href"));
    if (name === "use" && href && !href.startsWith("#")) {
      throw new Error("unsupported external SVG use reference; the page was not emitted");
    }
    if (name === "image" && href && !href.startsWith("#") && !href.startsWith("data:")) {
      throw new Error("unsupported external SVG image reference; the page was not emitted");
    }
    if ((name === "use" || name === "image") && href && href.startsWith("#")) {
      references.add(href.slice(1));
    }
    for (const ref of tag.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/g)) {
      const value = ref[2].trim();
      if (!value.startsWith("#")) {
        throw new Error("unsupported external SVG resource; the page was not emitted");
      }
      references.add(value.slice(1));
    }

    if (defsDepth) {
      if (gid) defined.add(gid);
      if (!closing && name === "path" && gid) rememberPath(gid, tag);
      if (!closing && name === "style") stylesheet = true;
      if (!closing && name === "g") {
        if (hasAny(tag, CSS_ATTRS) || attr(tag, "transform") !== null) stylesheet = true;
        if (hasAny(tag, EFFECT_ATTRS)) definitionEffects = true;
      }
      if (name === "defs" && !closing && !selfClosing) defsDepth += 1;
      if (name === "defs" && closing) {
        defsDepth -= 1;
        if (!defsDepth) definitions.push(source.slice(defsStart, end));
      }
      continue;
    }
    if (name === "svg") {
      if (!closing && root === null) {
        root = tag;
      } else if (closing && root && !rootClosed && !groups.length) {
        rootClosed = true;
      } else {
        throw new Error("unsupported nested or malformed SVG root");
      }
      continue;
    }
    if (!root || rootClosed) throw new Error("SVG content outside the root element");
    if (name === "defs") {
      if (closing) throw new Error("unexpected closing defs");
      if (selfClosing) {
        definitions.push(tag);
      } else {
        defsDepth = 1;
        defsStart = match.index;
      }
      continue;
    }
    if (name === "g") {
      if (closing) {
        if (!groups.length) throw new Error("unmatched SVG group");
        groups.pop();
      } else if (!selfClosing) {
        const parent = groups.length
          ? groups[groups.length - 1]
          : { matrix: IDENTITY, css: false, effects: false };
        groups.push({
          matrix: multiply(parent.matrix, matrix(attr(tag, "transform"))),
          css: parent.css || hasAny(tag, CSS_ATTRS),
          effects: parent.effects || hasAny(tag, EFFECT_ATTRS),
        });
      }
      scene.push({ raw: tag });
      continue;
    }
    if (name === "use") {
      if (closing || !selfClosing) throw new Error("unsupported non-empty SVG use");
      const parent = groups.length
        ? groups[groups.length - 1]
        : { matrix: IDENTITY, css: false, effects: false };
      const item = {
        raw: tag, index: sourceUses.length, parent: parent.matrix, href,
        css: parent.css || hasAny(tag, CSS_ATTRS),
        effects: parent.effects || hasAny(tag, EFFECT_ATTRS),
      };
      sourceUses.push(item);
      scene.push(item);
      continue;
    }
    // A body image may be referenced by a later <use>; put that definition
    // in <defs> without drawing the original image a second time.
    if ((name === "image" || name === "path") && gid && selfClosing && !closing) {
      bodyDefs[gid] = tag;
      if (name === "path") rememberPath(gid, tag);
    } else if (!selfClosing || closing) {
      throw new Error(`unsupported SVG container <${name}>`);
    }
  }
  if (source.slice(end).includes("<")) throw new Error("malformed SVG markup");
  if (!root || !rootClosed || defsDepth || groups.length) {
    throw new Error("incomplete SVG page");
  }

  const extra = [];
  for (const gid of references) {
    if (defined.has(gid)) continue;
    const raw = bodyDefs[gid];
    if (raw === undefined) {
      throw new Error(`cannot preserve SVG reference #${gid}: definition is missing or unsupported`);
    }
    defined.add(gid);
    extra.push(raw);
  }
  if (extra.length) definitions.push(`<defs>${extra.join("")}</defs>`);

  const uses = [];
  const unframed = [];
  const cache = new Map();
  for (const item of sourceUses) {
    const href = item.href;
    const gid = href && href.startsWith("#") ? href.slice(1) : null;
    const transform = attr(item.raw, "transform");
    const combined = transform === null ? null : multiply(item.parent, matrix(transform));
    let ox = Number(attr(item.raw, "x") ?? 0);
    let oy = Number(attr(item.raw, "y") ?? 0);
    if (Number.isNaN(ox) || Number.isNaN(oy)) { ox = NaN; oy = NaN; }
    if (!gid || !(gid in defs) || combined === null
        || !Number.isFinite(ox) || !Number.isFinite(oy)
        || stylesheet || item.css || pathFlags[gid].css) {
      unframed.push(item.index);
      continue;
    }
    const [a, b, c, d, tx, ty] = combined;
    const e = tx + a * ox + c * oy;
    const f = ty + b * ox + d * oy;
    const size = Number(fixed(Math.hypot(a, b)));
    // The four rules are horizontal. Keep rotated glyphs on the full page
    // rather than guessing which horizontal line they belong to.
    if (!size || Math.abs(b) > size * 1e-6) {
      unframed.push(item.index);
      continue;
    }
    const bb = bboxOf(defs[gid], cache);
    let ink = null;
    if (bb) {
      const [x0, y0, x1, y1] = bb;
      const xs = [a * x0 + c * y0 + e, a * x1 + c * y0 + e, a * x0 + c * y1 + e, a * x1 + c * y1 + e];
      const ys = [b * x0 + d * y0 + f, b * x1 + d * y0 + f, b * x0 + d * y1 + f, b * x1 + d * y1 + f];
      ink = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    uses.push({
      href: gid, x: e, y: f, ink, size,
      raw: item.raw, index: item.index,
      fullPage: item.effects || pathFlags[gid].effects || definitionEffects,
    });
  }

  const widthAttr = attr(root, "width");
  const heightAttr = attr(root, "height");
  const width = widthAttr === null ? NaN : Number(widthAttr);
  const height = heightAttr === null ? NaN : Number(heightAttr);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("SVG page needs numeric width and height");
  }
  if (attr(root, "xmlns") !== "http://www.w3.org/2000/svg"
      || ![null, "http://www.w3.org/1999/xlink"].includes(attr(root, "xmlns:xlink"))) {
    throw new Error("unsupported SVG root namespace");
  }
  const viewBox = attr(root, "viewBox");
  if (viewBox !== null) {
    const parts = viewBox.trim() ? viewBox.trim().split(/[\s,]+/).map(Number) : [];
    const expected = [0, 0, width, height];
    if (parts.length !== 4 || parts.some((v, i) => !Number.isFinite(v)
        || Math.abs(v - expected[i]) > Math.max(width, height, 1) * 1e-6)) {
      throw new Error("unsupported SVG root viewBox; the page was not emitted");
    }
  }
  for (const name of ["style", "class", "transform", "fill", "stroke", "opacity", "color",
    "clip-path", "mask", "filter", "display", "visibility", "overflow"]) {
    if (attr(root, name) !== null) {
      throw new Error(`unsupported SVG root ${name}; the page was not emitted`);
    }
  }
  const namespaces = [...root.matchAll(/\s+xmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([\s\S]*?)\2/g)]
    .filter((ns) => ns[1] !== "xlink")
    .map((ns) => ns[0])
    .join("");
  let clipId = "__svg_page_clip";
  while (allIds.has(clipId)) clipId += "_";
  return {
    width, height, defs,
    definitions: definitions.join(""), namespaces, scene,
    uses, unframed, clipId,
  };
}

export function renderScene(scene, selected = null) {
  return scene
    .filter((item) => !("index" in item) || selected === null || selected.has(item.index))
    .map((item) => item.raw)
    .join("");
}

export function modal(values) {
  // Most common value; ties break towards the smaller one.
  const tally = new Map();
  for (const k of values) tally.set(k, (tally.get(k) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
}

export function parseLines(spec, n) {
  // Same contract as parse_lines() in make_line.py. Empty spec -> null.
  if (!spec) return null;
  const out = new Set();
  for (const chunk of String(spec).split(",")) {
    const t = chunk.trim();
    if (!t) continue;
    if (t.includes("-")) {
      const [a, b] = t.split("-", 2).map(Number);
      for (let v = a; v <= b; v += 1) out.add(v);
    } else {
      out.add(Number(t));
    }
  }
  return new Set([...out].filter((v) => 1 <= v && v <= n));
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  };
}

// Group a page export's glyph uses into framed lines. `pageLines` is the
// PDF's own text-layer line metadata ([x, y, size, text] rows, svg-page
// coordinates) when available; without it, rows are inferred from glyph
// baselines and the caller hears about it on stderr in the CLI runner.
export function analysePage(source, { pageLines = null } = {}) {
  const pageScene = readScene(source);
  const { width: W, height: H, defs, uses } = pageScene;
  const unframed = [...pageScene.unframed];
  if (!uses.length) return { pageScene, rows: [], frames: [], pitch: 0, unframed };

  const tol = modal(uses.map((u) => u.size)) * UNITS;

  const inferredRow = (glyphs) => ({
    x: Math.min(...glyphs.map((u) => (u.ink ? u.ink[0] : u.x))),
    y: modal(glyphs.map((u) => Number(fixed(u.y)))),
    size: modal(glyphs.map((u) => u.size)),
    text: "",
    glyphs,
  });
  const nearestRow = (u, candidates) => {
    let best = null;
    let distance = Infinity;
    for (const r of candidates) {
      const d = Math.abs(r.y - u.y);
      if (d < distance) {
        best = r;
        distance = d;
      }
    }
    return distance <= tol ? best : null;
  };

  const unmatchedInk = [];
  let rows;
  if (pageLines) {
    rows = pageLines.map(([x, y, size, text]) => ({ x, y, size, text, glyphs: [] }));
    for (const u of uses) {
      const row = nearestRow(u, rows);
      if (row !== null) row.glyphs.push(u);
      else if (u.ink) unmatchedInk.push(u);
      else unframed.push(u.index);
    }
  } else {
    const buckets = new Map();
    for (const u of uses) {
      if (!u.ink) continue;
      let key = null;
      for (const k of buckets.keys()) {
        if (Math.abs(k - u.y) <= tol) {
          key = k;
          break;
        }
      }
      if (key === null) {
        key = u.y;
        buckets.set(key, []);
      }
      buckets.get(key).push(u);
    }
    rows = [...buckets.values()].map((g) => inferredRow(g));
    for (const u of uses) {
      if (u.ink) continue;
      const row = nearestRow(u, rows);
      if (row !== null) row.glyphs.push(u);
      else unframed.push(u.index);
    }
  }

  let inferredFromUnmatched = 0;
  if (unmatchedInk.length) {
    const buckets = new Map();
    for (const u of unmatchedInk) {
      const key = fixed(u.y);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(u);
    }
    inferredFromUnmatched = buckets.size;
    rows.push(...[...buckets.values()].map((g) => inferredRow(g)));
  }
  rows.sort((a, b) => (a.y - b.y) || (a.x - b.x));

  for (const r of rows) r.band = bandFor(r.y, r.size, r.glyphs);
  const lines = rows.map((r) => [r.x, r.y, r.size, r.text, r.band]);
  const frames = framesOf(lines);
  const pitch = pitchOf(frames);
  return {
    pageScene, rows, frames, pitch, unframed,
    width: W, height: H, defs,
    unmatchedInk: unmatchedInk.length, inferredFromUnmatched,
  };
}

export function lineSvgFor(analysis, index, { label = null } = {}) {
  const { pageScene, frames, rows, pitch } = analysis;
  const frame = frames[index - 1];
  if (!frame) throw new Error(`line ${index} is out of range 1..${frames.length}`);
  const uses = rows[index - 1].glyphs;
  const lineIds = new Set(uses.map((u) => u.index));
  return lineSvg(analysis.width, frame, uses, analysis.defs, {
    pitch,
    label: label ?? `line ${index}`,
    definitions: pageScene.definitions,
    namespaces: pageScene.namespaces,
    sourceHeight: analysis.height,
    clipId: pageScene.clipId,
    fullPage: uses.some((u) => u.fullPage),
    scene: renderScene(pageScene.scene, lineIds),
  });
}

export function sheetSvgFor(analysis, { only = null } = {}) {
  const { pageScene, frames, rows, pitch } = analysis;
  const keep = parseLines(only, frames.length);
  const selected = keep === null ? frames : frames.filter((f) => keep.has(f.index));
  if (!selected.length) {
    throw new Error("the line selector matched nothing; the page was not emitted");
  }
  const allRows = selected.map((f) => ({ frame: f, uses: rows[f.index - 1].glyphs }));
  const allLines = selected.length === frames.length;
  const selectedIds = allLines
    ? null
    : new Set(allRows.flatMap((row) => row.uses.map((u) => u.index)));
  const sheetFullPage = allLines
    || allRows.some((row) => row.uses.some((u) => u.fullPage));
  return sheetSvg(analysis.width, allRows, analysis.defs, pitch, {
    definitions: pageScene.definitions,
    namespaces: pageScene.namespaces,
    scene: renderScene(pageScene.scene, selectedIds),
    sourceHeight: analysis.height,
    clipId: pageScene.clipId,
    pageHeight: sheetFullPage ? analysis.height : null,
  });
}

// ---------------------------------------------------------------------------
// CLI runner — mirrors make_line.py's main(): page export -> a random
// framed line sample plus the full sheet under known/.
// ---------------------------------------------------------------------------

function main(argv) {
  const src = argv[2] ?? "../parser/svg/representative-p14.svg";
  const seed = argv[3] !== undefined ? parseInt(argv[3], 10) : 14;
  const suffix = argv[4] ?? "";
  const only = argv[5] ?? "";
  const page = src.replaceAll("\\", "/").split("/").pop().replace(/\.[^.]*$/, "");

  const svg = fs.readFileSync(src, "utf8");
  const linesPath = src.replace(/\.svg$/, ".lines.json");
  let pageLines = null;
  try {
    const metadata = JSON.parse(fs.readFileSync(linesPath, "utf8"));
    if (metadata.coordinates === "svg-page") {
      pageLines = metadata.lines;
    } else {
      console.error(`unverified coordinates in ${linesPath} — falling back to a baseline tolerance; re-export the page with pdf2svg.py`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    console.error(`no ${linesPath} — falling back to a baseline tolerance; run pdf2svg.py to get exact line boundaries`);
  }
  if (pageLines !== null && !Array.isArray(pageLines)) {
    throw new Error("invalid page line metadata");
  }
  if (Array.isArray(pageLines) && !pageLines.length) {
    console.error(`no text lines in ${linesPath} — falling back to a baseline tolerance`);
    pageLines = null;
  }

  const analysis = analysePage(svg, { pageLines });
  const { pageScene, frames, rows, pitch, unframed } = analysis;
  const W = analysis.width;
  const H = analysis.height;
  const uses = pageScene.uses;
  if (!uses.length) {
    console.error(`no frameable glyph uses in ${src} — the page was not emitted`);
    return 1;
  }
  if (!rows.length) {
    throw new Error("no text rows or visible glyphs; the page was not emitted");
  }
  if (analysis.unmatchedInk) {
    console.error(`${analysis.unmatchedInk} unmatched glyph uses retained in ${analysis.inferredFromUnmatched} inferred row(s)`);
  }
  if (unframed.length) {
    console.error(`${unframed.length} uses could not be assigned to a line; retained at their original positions on the full sheet`);
  }

  const rnd = mulberry32(seed);
  const pick = 1 + Math.floor(rnd() * frames.length);
  const frame = frames[pick - 1];
  const lineUses = rows[pick - 1].glyphs;

  console.log(`${page}   width ${num(W)}   ${uses.length} glyph uses   ${frames.length} lines`);
  console.log(`assigned ${rows.reduce((n, r) => n + r.glyphs.length, 0)}/${uses.length} glyph uses; ${unframed.length} uses retained unframed on the full sheet`);
  console.log(`sizes ${[...new Set(frames.map((f) => f.size))].sort((a, b) => a - b).map(num).join(", ")}`);
  const blank = blankOf(frame, pitch);
  console.log(`pitch ${pitch ? num(pitch) : "— (not uniform)"}   slot ${fixed(frame.slot)}   blank ${blank === null ? "—" : fixed(blank)}`);
  console.log(`band ${fixed(frame.band, 3)}  E ${fixed(frame.E)}  rules ${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => fixed(v)).join(" / ")}`);
  console.log(`random line ${pick} of ${frames.length}   baseline ${fixed(frame.baseline)}   ${lineUses.length} glyphs`);

  let bad = 0;
  let unchecked = 0;
  for (const f of frames) {
    const glyphs = rows[f.index - 1].glyphs;
    if (glyphs.some((u) => u.fullPage)) {
      unchecked += 1;
      continue;
    }
    const o = overflow(f, glyphs);
    if (!o.ok) {
      bad += 1;
      console.log(`  ! line ${f.index} (size ${num(f.size)}, band ${fixed(f.band, 3)}) ink ${fixed(o.above)} above / ${fixed(o.below)} below`);
    }
  }
  const fitNote = unchecked ? `; ${unchecked} not assessed for strokes or effects` : "";
  console.log(`fit: ${frames.length - bad - unchecked}/${frames.length} lines inside the rules${fitNote}`);

  const lineFullPage = lineUses.some((u) => u.fullPage);
  const keep = parseLines(only, frames.length);
  const selected = keep === null ? frames : frames.filter((f) => keep.has(f.index));
  const sheetFullPage = (keep === null || selected.length === frames.length)
    || selected.some((f) => rows[f.index - 1].glyphs.some((u) => u.fullPage));
  if (lineFullPage || (keep !== null && selected.length !== frames.length && sheetFullPage)) {
    console.error("stroke or effects present; retained the source page viewport to avoid clipping a selected use");
  }

  const lineOutput = lineSvgFor(analysis, pick, { label: `${page} line ${pick}` });
  const sheetOutput = sheetSvgFor(analysis, { only });
  fs.mkdirSync("known", { recursive: true });
  fs.writeFileSync(path.join("known", `line-sample${suffix}.svg`), lineOutput, "utf8");
  fs.writeFileSync(path.join("known", `frame-sheet${suffix}.svg`), sheetOutput, "utf8");
  console.log(`-> known/line-sample${suffix}.svg`);
  console.log(`-> known/frame-sheet${suffix}.svg`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exit(main(process.argv) ?? 0);
}


// FILE: beautify/repair/svg/scan-frame.js
/*
(Repair 7) Repair branch, position 7 in the chain - the line-frame scanner inside the line builder (Repair 6).
This module scans a page's glyph positions and decides the text lines (the four-rule frame: rules, baseline, pitch). It is the JS twin of the Python scan_frame.py.
*/
// JS twin of B.Parser/main/Python/scan_frame.py — same API, same bytes.
//
// The parser exists in two languages by design, so this module does not
// shell out to Python and the Python module does not shell out to Node.
// Each is standalone.
//
// THE CONTRACT THAT KEEPS THEM 1:1
//   The two implementations must emit byte-identical SVG for the same
//   input. That is only possible if number formatting is pinned, because
//   the standard formatters disagree:
//
//       JS   (2.5).toFixed(0)      -> "3"      half away from zero
//       Py   f"{2.5:.0f}"          -> "2"      half to even
//       JS   String(12.0)          -> "12"
//       Py   str(12.0)             -> "12.0"
//
//   So both sides use fixed() and num() below and nowhere else.
//
// WHAT THIS FILE IS
//   frameOf / framesOf / pitchOf / blankOf / overflow / brokenByLine /
//   lineSvg / sheetSvg, and the four-rule frame: E = size / 2, rules at
//   b-2E, b-E, b, b+E, canvas locked to the page width.
//
//   The reasoning behind E, and the measurement that rejected per-font
//   coordinates, are in AGENT-NOTE-vector-svg.md.

export const BAND = 0.5;        // E as a fraction of size, calibrated on Myanmar3
export const MIN_PITCH = 2;     // below this, a gap is not between text lines
export const RULE_W = 0.5;      // stroke width of the three rules
export const BASE_W = 0.7;      // stroke width of the baseline rule

// ---------------------------------------------------------------------------
// number formatting — the parity contract, see the module header
// ---------------------------------------------------------------------------

export function fixed(v, digits = 2) {
  // Integer hundredths, rounded half away from zero. Matches Python fixed().
  const scale = 10 ** digits;
  const s = v < 0 ? -1 : 1;
  const n = Math.floor(Math.abs(v) * scale + 0.5);
  const i = Math.floor(n / scale);
  const f = n % scale;
  const sign = s < 0 && n !== 0 ? "-" : "";
  return `${sign}${i}.${String(f).padStart(digits, "0")}`;
}

export function num(v) {
  // Integral floats print without a decimal part. Matches Python num().
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Number.isInteger(v)) return String(v);
  return String(v);
}

export function jsRound(v) {
  // Math.round: halves go towards +inf, so -2.5 -> -2.
  return Math.floor(v + 0.5);
}

function esc(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

// ---------------------------------------------------------------------------
// the frame
// ---------------------------------------------------------------------------

export function frameOf(baseline, size, band = BAND) {
  // The four rules for one line.
  const E = size * band;
  return {
    baseline,
    size,
    E,
    band,
    r1: baseline - 2 * E,
    r2: baseline - E,
    r3: baseline,
    r4: baseline + E,
    top: baseline - 2 * E,
    bottom: baseline + E,
    slot: 3 * E,
  };
}

export function needOf(baseline, size, uses) {
  // The band a line's own outlines need, as a fraction of size.
  //
  // E must clear 2E of ink above the baseline and E below, so a glyph
  // rising `above` points needs E >= above/2 and one dropping `below`
  // needs E >= below.
  let above = 0.0;
  let below = 0.0;
  for (const u of uses) {
    if (!u.ink) continue;
    const a = baseline - u.ink[1];
    const b = u.ink[3] - baseline;
    if (a > above) above = a;
    if (b > below) below = b;
  }
  if (!size) return 0.0;
  return Math.max(above / (2 * size), below / size);
}

export function bandFor(baseline, size, uses, floor = BAND) {
  // BAND is the floor, the page is the ceiling.
  //
  // Ceiling, not the raw quotient: size * (above / (2 * size)) can land a
  // rounding error below above / 2, which would put the rule a hair inside
  // the ink it was computed to clear. A 3-decimal ceiling is also the
  // precision the frame is written at.
  const need = Math.ceil(needOf(baseline, size, uses) * 1000) / 1000;
  return Math.max(floor, need);
}

export function baseInset(width, strokeWidth) {
  // Half a stroke, so a round cap fits inside the canvas instead of being cut.
  const half = strokeWidth / 2;
  return width > 2 * half ? half : 0.0;
}

export function ruleLine(y, width, strokeWidth) {
  const d = baseInset(width, strokeWidth);
  return `<line x1="${fixed(d)}" y1="${fixed(y)}" `
    + `x2="${fixed(width - d)}" y2="${fixed(y)}"/>`;
}

export function framesOf(lines, band = BAND) {
  // Frames for a page from the parser's own line boundaries.
  //
  // lines yields [x, y, size, text], i.e. PdfPagePieces.lines(). A 5th
  // element overrides the band for that line, which is how the runner
  // feeds in a band raised to fit the line's own ink.
  const out = [];
  lines.forEach((row, i) => {
    const [x, y, size, text] = row;
    const own = row.length > 4 ? row[4] : null;
    const f = frameOf(y, size, own === null || own === undefined ? band : own);
    out.push({ index: i + 1, x, y, size, text, ...f });
  });
  return out;
}

export function pitchOf(frames) {
  // Modal consecutive baseline gap, rounded the way JS rounds it.
  //
  // Returns 0 when the page has no spacing to report, and callers treat 0
  // as "not uniform" rather than as a number: a signature block stacks
  // names on baselines 0.4 to 1.9 pt apart, and reporting 1.87 pt there
  // invents a spacing nobody set.
  const gaps = [];
  for (let i = 1; i < frames.length; i += 1) {
    const d = frames[i].baseline - frames[i - 1].baseline;
    if (d >= MIN_PITCH) gaps.push(jsRound(d * 100) / 100);
  }
  if (!gaps.length) return 0;
  const tally = new Map();
  for (const g of gaps) tally.set(g, (tally.get(g) ?? 0) + 1);
  // count desc, then value asc, stable over insertion order
  const [gap, count] = [...tally.entries()].sort((a, b) => (-a[1] + b[1]) || (a[0] - b[0]))[0];
  return count >= 2 ? gap : 0;
}

export function blankOf(frame, pitch) {
  // What is left between one slot and the next, or null when there is no pitch.
  return pitch ? pitch - frame.slot : null;
}

export function inkOf(use) {
  return use.ink ?? null;
}

export function overflow(frame, uses) {
  // Does this row's ink stay inside its four rules? Needs no font file.
  let lo = Infinity;
  let hi = -Infinity;
  for (const u of uses) {
    const ink = u.ink;
    if (!ink) continue;
    if (ink[1] < lo) lo = ink[1];
    if (ink[3] > hi) hi = ink[3];
  }
  if (lo === Infinity) return { ok: true, above: 0, below: 0 };
  const above = frame.baseline - lo;
  const below = hi - frame.baseline;
  // EPS absorbs floating-point noise only, exactly as in scan_frame.py
  const EPS = 1e-9;
  const ok = above <= 2 * frame.E * (1 + EPS) && below <= frame.E * (1 + EPS);
  return { ok, above, below };
}

export function brokenByLine(frames, scan) {
  // Attach scanBrokenSpans results to the lines they fall on.
  return frames.map((f) => {
    const spans = scan(String(f.text ?? "")) || [];
    return { ...f, spans, broken: spans.length > 0 };
  });
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

export const DEFAULT_PAINT = {
  slot: "#D6EAF8", rule: "#FF6EAE", base: "#FFC300", ink: "#000000",
};

export function sourceClip(width, height, clipId, scene) {
  // Keep source ink within the original page viewport.
  if (height === null || height === undefined || clipId === null || clipId === undefined
      || scene === null || scene === undefined) {
    return ["", ""];
  }
  const safeId = esc(clipId);
  return [
    `<defs><clipPath id="${safeId}"><rect x="0" y="0" `
      + `width="${fixed(width)}" height="${fixed(height)}"/></clipPath></defs>`,
    ` clip-path="url(#${safeId})"`,
  ];
}

export function lineSvg(width, frame, uses, defs, {
  pitch = null, label = null, paint = null, definitions = null,
  namespaces = "", scene = null, sourceHeight = null, clipId = null,
  fullPage = false,
} = {}) {
  // One line as a standalone SVG on the page-width canvas.
  const c = { ...DEFAULT_PAINT, ...(paint ?? {}) };
  const pad = frame.size * 0.6;
  const top = fullPage && sourceHeight !== null && sourceHeight !== undefined
    ? Math.min(0, frame.r1 - pad) : frame.r1 - pad;
  const bot = fullPage && sourceHeight !== null && sourceHeight !== undefined
    ? Math.max(sourceHeight, frame.r4 + pad) : frame.r4 + pad;
  const h = bot - top;

  const used = new Set(uses.map((u) => u.href));
  const defsXml = Object.keys(defs).filter((i) => used.has(i))
    .map((i) => `<path id="${esc(i)}" d="${defs[i]}"/>`).join("");

  const ink = scene === null || scene === undefined
    ? uses.map((u) => u.raw).join("") : scene;
  const [clipDef, clipAttr] = sourceClip(width, sourceHeight, clipId, scene);
  const defsBlock = (definitions === null || definitions === undefined
    ? `<defs>${defsXml}</defs>` : definitions) + clipDef;
  const sourceAttr = scene === null || scene === undefined
    ? "" : ` data-source-uses="true"${clipAttr}`;

  const rules = [frame.r1, frame.r2, frame.r4]
    .map((y) => ruleLine(y, width, RULE_W)).join("");
  const bd = baseInset(width, BASE_W);

  const idx = frame.index ?? "";
  const title = label !== null && label !== undefined ? label : `line ${idx !== "" ? idx : "?"}`;
  let pitchAttr = "";
  if (pitch) {
    pitchAttr = ` data-pitch="${fixed(pitch)}" data-blank="${fixed(blankOf(frame, pitch))}"`;
  }

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + `${namespaces} version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" `
    + `viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-line="${idx}" data-baseline="${fixed(frame.baseline)}" `
    + `data-size="${num(frame.size)}" data-E="${fixed(frame.E, 3)}" `
    + `data-rules="${[frame.r1, frame.r2, frame.r3, frame.r4].map((v) => fixed(v)).join(",")}"`
    + pitchAttr
    + ` data-glyphs="${uses.length}">\n`
    + `<title>${esc(title)}</title>\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<rect x="0" y="${fixed(frame.r1)}" width="${fixed(width)}" `
    + `height="${fixed(frame.slot)}" fill="${c.slot}"/>\n`
    + `${defsBlock}\n`
    + `<g fill="${c.ink}"${sourceAttr}>${ink}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="${RULE_W}" fill="none" `
    + `stroke-linecap="round" stroke-linejoin="round">${rules}</g>\n`
    + `<line x1="${fixed(bd)}" y1="${fixed(frame.r3)}" `
    + `x2="${fixed(width - bd)}" `
    + `y2="${fixed(frame.r3)}" stroke="${c.base}" stroke-width="${BASE_W}" `
    + 'stroke-linecap="round"/>\n'
    + "</svg>\n";
}

function shiftMatrix(raw, shift) {
  // Translate the glyph's own matrix down by `shift`.
  const m = /transform="matrix\(([^)]*)\)"/.exec(raw);
  if (!m) return raw;
  const p = m[1].split(",").map(Number);
  const repl = `transform="matrix(${num(p[0])},${num(p[1])},${num(p[2])},${num(p[3])},`
    + `${num(p[4])},${fixed(p[5] + shift)})"`;
  return raw.slice(0, m.index) + repl + raw.slice(m.index + m[0].length);
}

export function sheetSvg(width, rows, defs, pitch, {
  mode = "page", paint = null, definitions = null, namespaces = "",
  scene = null, pageHeight = null, sourceHeight = null, clipId = null,
} = {}) {
  // A page-space sheet; full-page height can retain unframed source uses.
  if (!rows.length) {
    throw new Error("sheetSvg: no rows — the line selector matched nothing");
  }
  if (scene !== null && scene !== undefined && mode !== "page") {
    throw new Error("source scene requires page mode");
  }
  const c = { ...DEFAULT_PAINT, ...(paint ?? {}) };

  const used = new Set();
  const body = [];
  const slots = [];
  const slotRules = [];
  const baseRules = [];

  let cursor = 0.0;
  for (const row of rows) {
    const { frame, uses } = row;
    let shift = 0.0;
    if (mode === "stack") {
      shift = cursor - frame.r1;
      cursor += frame.slot + (pitch - frame.slot);
    }

    const g = [];
    for (const u of uses) {
      used.add(u.href);
      g.push(shift === 0 ? u.raw : shiftMatrix(u.raw, shift));
    }
    body.push(g.join(""));

    const b = frame.baseline + shift;
    slots.push(`<rect x="0" y="${fixed(b - 2 * frame.E)}" width="${fixed(width)}" `
      + `height="${fixed(frame.slot)}" fill="${c.slot}"/>`);
    for (const y of [b - 2 * frame.E, b - frame.E, b + frame.E]) {
      slotRules.push(ruleLine(y, width, RULE_W));
    }
    baseRules.push(ruleLine(b, width, BASE_W));
  }

  // one band per line, so the sheet reports the set rather than a single value
  const bandList = [...new Set(rows.map((r) => fixed(r.frame.band, 3)))].sort().join(",");

  let top;
  let h;
  if (mode === "stack") {
    top = 0.0;
    h = cursor + 8;
  } else {
    const rowTop = Math.min(...rows.map((r) => r.frame.r1));
    top = pageHeight === null || pageHeight === undefined ? rowTop : Math.min(0, rowTop);
    const rowBottom = Math.max(...rows.map((r) => r.frame.r4)) + 8;
    h = Math.max(rowBottom, pageHeight === null || pageHeight === undefined ? rowBottom : pageHeight) - top;
  }

  const defsXml = Object.keys(defs).filter((i) => used.has(i))
    .map((i) => `<path id="${esc(i)}" d="${defs[i]}"/>`).join("");
  const [clipDef, clipAttr] = sourceClip(width, sourceHeight, clipId, scene);
  const defsBlock = (definitions === null || definitions === undefined
    ? `<defs>${defsXml}</defs>` : definitions) + clipDef;
  const sourceAttr = scene === null || scene === undefined
    ? "" : ` data-source-uses="true"${clipAttr}`;
  const ink = scene === null || scene === undefined ? body.join("") : scene;

  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
    + `${namespaces} version="1.1" `
    + `width="${fixed(width)}" height="${fixed(h)}" `
    + `viewBox="0 ${fixed(top)} ${fixed(width)} ${fixed(h)}" `
    + `data-lines="${rows.length}"`
    + (pitch ? ` data-pitch="${fixed(pitch)}"` : "")
    + ` data-band="${bandList}">\n`
    + `<rect x="0" y="${fixed(top)}" width="${fixed(width)}" height="${fixed(h)}" fill="#FFFFFF"/>\n`
    + `<g fill="${c.slot}">${slots.join("")}</g>\n`
    + `${defsBlock}\n`
    + `<g fill="${c.ink}"${sourceAttr}>${ink}</g>\n`
    + `<g stroke="${c.rule}" stroke-width="${RULE_W}" fill="none" `
    + `stroke-linecap="round" stroke-linejoin="round">${slotRules.join("")}</g>\n`
    + `<g stroke="${c.base}" stroke-width="${BASE_W}" fill="none" `
    + `stroke-linecap="round" stroke-linejoin="round">${baseRules.join("")}</g>\n`
    + "</svg>\n";
}


// FILE: beautify/repair/vote.js
/*
(Support 38) Shared support, no chain position - a minimal vote stub.
This module provides the pixel/image-to-vector match exports other modules import; the real matching lives in the repair branch (Repair 11).
*/
// Minimal vote stub.
// Original vote.js was never in the JS repo; this provides the
// matchPixelsToVector and matchImageToVector exports so text/repair.js
// can dynamically import it.
export function matchPixelsToVector(source, options = {}) {
  return null;
}

export function matchImageToVector(source, options = {}) {
  return null;
}


// FILE: beautify/scan.js
/*
(Repair 1) Repair branch, position 1 in the chain - the first repair step after Parser output is written.
This module scans finished text for broken spans (impossible Myanmar pairs and similar damage) using the Engine's POS verdicts, and reports the broken lines with their page references.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { bindEngine as engineBind, MAX_LINE_BYTES } from "../../extend/bind-engine.js";
import { textLines } from "../decoding/finalized-cmap.js";
import { INDEX_BASES, MARKS as MM_MARKS } from "../decoding/judgement.js";

// Do not read the Engine master or build a dictionary matcher to validate
// words. Hand the text object to the extend bind-engine and keep the
// Engine's actual tagged output; segmentation happens inside the Engine.












// Structural-scan data stays in code: POS tagging is not done here at all.
// BindEngine (via extend/bind-engine) returns the Engine's tagged output;
// this file only keeps the small structural rules used to spot damage.

const SPLIT = /[\s\u104a\u104b()\x5b\x5d"‘’“”,\x2e:;?!/=+_—-]+/u;
const DIGIT = /^[\u1040-\u1049]$/u;

const BASES = new Set(INDEX_BASES);
for (const ch of ["\u1022", "\u1025"]) BASES.add(ch);
const EXTRA_BASES = new Set(["\u1022", "\u1023", "\u1024", "\u1026", "\u1028", "\u1029", "\u102a", "\u103f"]);
const PLACEHOLDER_BASES = new Set(["-", "_", "\u2013", "\u2014"]);
const STRAY_MARKS = new Set([..."\u102b\u102c\u102d\u102e\u102f\u1030\u1031\u1032\u1036\u1037\u1038\u1039\u103a\u103b\u103c\u103d\u103e"]);
const LETTER_OR_MARK_SET = new Set([...BASES, ...STRAY_MARKS]);
const LETTER_OR_MARK = (ch) => LETTER_OR_MARK_SET.has(ch);







const MARKS = new Set([...MM_MARKS, ...STRAY_MARKS]);

const IMPOSSIBLE = [
  [/\u1036\u103a/gu, "\u1036 + \u103a"],
  [/\u1032[\u102c\u102b]/gu, "\u1032 + \u102c/\u102b"],
  [/\u1032[\u102f\u1030]/gu, "\u1032 + \u102f/\u1030"],
  [/[\u102d\u102e][\u102c\u102b]/gu, "\u102d/\u102e + \u102c/\u102b"],
  [/[\u102c\u102b][\u102c\u102b]/gu, "doubled \u102c/\u102b"],
  [/\u103a[\u103b\u103c\u103d\u103e]/gu, "\u103a + medial"],
  [/\u1004\u103a\u1039(?![\u1000-\u1021])/gu, "kinzi with nothing to sit on"],
];

// Stray or lone marks can be technically misspelled yet used intentionally to
// capture specific pronunciations across languages and names. Dictionary-based
// matching alone cannot distinguish loanwords or names from parsing errors;
// consider the density and sequence of error tags instead.
export function countImpossiblePairs(text) {
  const input = String(text ?? "");
  let total = 0;
  for (const [pattern] of IMPOSSIBLE) {
    pattern.lastIndex = 0;
    for (const _match of input.matchAll(pattern)) total += 1;
  }
  return total;
}

function isBase(ch) {
  return BASES.has(ch) || EXTRA_BASES.has(ch) || PLACEHOLDER_BASES.has(ch);
}

function words(text) {
  const result = [];
  let offset = 0;
  for (const token of text.split(SPLIT)) {
    if (!token) continue;
    const start = text.indexOf(token, offset);
    result.push([token, start < 0 ? offset : start]);
    offset = (start < 0 ? offset : start) + token.length;
  }
  return result;
}

function clusterAt(text, index, span = 9) {
  let start = index;
  while (start > 0 && !SPLIT.test(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !SPLIT.test(text[end])) end += 1;
  return text.slice(start, end).slice(0, span * 3) || text[index];
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function findOrphans(text) {
  const hits = [];
  let attached = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (isBase(ch)) attached = true;
    else if (MARKS.has(ch)) { if (!attached) hits.push(i); }
    else attached = false;
  }
  return hits;
}

function findStray(text) {
  return words(text).filter(([token]) => [...token].every((ch) => STRAY_MARKS.has(ch))).map(([, i]) => i);
}

function findRepeat(text) {
  const hits = [];
  const re = /([\u1000-\u109f]{2,4})\1{2,}/gu;
  for (const match of text.matchAll(re)) hits.push(match.index);
  return hits;
}

function findDigits(text) {
  const hits = [];
  for (let i = 1; i < text.length - 1; i += 1) {
    if (DIGIT.test(text[i]) && LETTER_OR_MARK(text[i - 1]) && LETTER_OR_MARK(text[i + 1])) hits.push(i);
  }
  return hits;
}

function findVirama(text) {
  const hits = [];
  for (const match of text.matchAll(/္(?![က-ဧ])/gu)) hits.push(match.index);
  return hits;
}

const RULES = [
  ["orphan", "a dependent mark with no base in front of it", findOrphans],
  ["impossible", "a pair Burmese cannot write in one syllable", (text) => IMPOSSIBLE.flatMap(([re]) => [...text.matchAll(re)].map((m) => m.index))],
  ["stray", "a token made only of marks", findStray],
  ["repeat", "the same syllable printed 3+ times", findRepeat],
  ["digit", "a digit with Myanmar letters on both sides", findDigits],
  ["virama", "U+1039 with nothing stacked after it", findVirama],
];

function reportClusters(text, hits, limit) {
  const grouped = new Map();
  for (const index of hits) {
    const cluster = clusterAt(text, index);
    const item = grouped.get(cluster) || { count: 0, index };
    item.count += 1;
    grouped.set(cluster, item);
  }
  return [...grouped.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, limit)
    .map(([cluster, item]) => {
      const lineStart = text.lastIndexOf("\n", item.index - 1) + 1;
      const nextBreak = text.indexOf("\n", item.index);
      const lineEnd = nextBreak < 0 ? text.length : nextBreak;
      const fullLine = text.slice(lineStart, lineEnd).trim();
      return {
        cluster,
        count: item.count,
        line: lineNumber(text, item.index),
        context: fullLine.length > 160 ? `${fullLine.slice(0, 157)}...` : fullLine,
      };
    });
}

export function scanText(text, { perRule = 25 } = {}) {
  const report = {};
  for (const [key, title, finder] of RULES) {
    const hits = finder(text);
    report[key] = { total: hits.length, distinct: new Set(hits.map((i) => clusterAt(text, i))).size, title, clusters: reportClusters(text, hits, perRule) };
  }
  return report;
}



function tokenSpanAt(text, index) {
  let start = index;
  while (start > 0 && !SPLIT.test(text[start - 1])) start -= 1;
  let end = index;
  while (end < text.length && !SPLIT.test(text[end])) end += 1;
  return [start, end];
}













export function scanBrokenSpans(text, {
  rules = ["orphan", "impossible", "stray", "virama"],
} = {}) {
  const wanted = new Set(rules);
  const hits = [];
  for (const [key, , finder] of RULES) {
    if (!wanted.has(key)) continue;
    for (const index of finder(text)) hits.push([key, index]);
  }
  const bySpan = new Map();
  for (const [rule, index] of hits) {
    const [start, end] = tokenSpanAt(text, index);
    const key = `${start}:${end}`;
    const item = bySpan.get(key) || { start, end, token: text.slice(start, end), rules: new Set() };
    item.rules.add(rule);
    bySpan.set(key, item);
  }
  return [...bySpan.values()]
    .map(({ rules: rs, ...rest }) => ({ ...rest, rules: [...rs] }))
    .sort((a, b) => a.start - b.start);
}

export function formatScanReport(report, { source = "", totalChars = 0 } = {}) {
  const out = ["=".repeat(78), `parser scan${source ? `  ${source}` : ""}`, ...(totalChars ? [`${totalChars.toLocaleString()} characters`] : []), "=".repeat(78), "", "rule              hits  distinct   what it means"];
  for (const [key, value] of Object.entries(report)) out.push(`${key.padEnd(16)}${String(value.total).padStart(6)}${String(value.distinct).padStart(10)}   ${value.title}`);
  for (const [key, value] of Object.entries(report)) {
    if (!value.clusters.length) continue;
    out.push("", `[${key}]`);
    for (const item of value.clusters) {
      out.push(`  cluster: ${item.cluster}  (${item.count} hit(s), line ${item.line})`);
      if (item.context) out.push(`    context: ${item.context}`);
    }
  }
  return `${out.join("\n")}\n`;
}









export { RULES };

// Change this one value if a book needs a shorter page-number heuristic.
export const MAX_PAGE_NUMBER_DIGITS = 4;
const NON_WORD_TAGS = new Set(['pan', 'eos', 'en', 'count', 'phone', 'addr', 'year', 'exactdate', 'page number', 'page marker']);
const TAGGED_TOKEN = /^(.*?)\{([^{}]+)\}$/u;
const PAGE_MARKER = /^\s*(?:-{2,}\s*)?page\s*[-:]?\s*([0-9၀-၉]+)\s*(?:-{2,})?\s*$/iu;

function pageNumber(value) {
  const digits = String(value).replace(/[၀-၉]/gu, (ch) => String('၀၁၂၃၄၅၆၇၈၉'.indexOf(ch)));
  const result = Number(digits);
  return Number.isSafeInteger(result) && result > 0 ? result : null;
}

export function isPageNumberLine(value) {
  const line = String(value ?? '').trim();
  return /^[0-9၀-၉]+$/u.test(line) && line.length <= MAX_PAGE_NUMBER_DIGITS;
}

function posSourceLine(source) {
  // The Engine mapper also treats Latin letters as internal syllable codes.
  // Do not misreport English as Burmese unknowns; retain the untouched source
  // line in the report and let the Engine classify the remaining text.
  if (!/\p{Script=Myanmar}/u.test(source) && !/^[\s0-9.,/+\-]+$/u.test(source)) return '';
  return source.replace(/\p{Script=Latin}+/gu, ' ');
}

export function parseTaggedLine(raw) {
  return raw.split('  ').map((part) => part.trim()).filter(Boolean).map((formatted) => {
    const match = TAGGED_TOKEN.exec(formatted);
    if (!match) return { formatted, word: formatted, tags: [], kind: 'other' };
    const tags = match[2].split(',').map((tag) => tag.trim()).filter(Boolean);
    const unknown = tags.length === 1 && tags[0] === 'F';
    const word = tags.some((tag) => tag !== 'F' && !NON_WORD_TAGS.has(tag));
    return { formatted, word: match[1], tags, kind: unknown ? 'unknown' : word ? 'known' : 'other' };
  });
}

export async function tagPosLine(sourceText, bindEngine = null) {
  const bind = bindEngine ?? engineBind;
  const tagged = bind({ flag: 'pos', sourceText, log: false });
  let rawPos = '';
  for await (const unit of tagged) {
    if (typeof unit?.rawPos !== 'string') throw new TypeError('Engine POS output must include rawPos');
    if (rawPos) rawPos += '  ';
    rawPos += unit.rawPos;
  }
  return rawPos;
}

// Scan owns the BindEngine call: callers hand it one source line and consume
// the parsed POS tokens back. Page furniture and lines with no POS input are
// classified here so repair can scan per line without re-deciding them.
export async function scanLineWithPos(source, { bindEngine = null } = {}) {
  const line = String(source ?? '');
  if (isPageNumberLine(line)) {
    const rawPos = `${line.trim()}{page number}`;
    return { rawPos, tokens: parseTaggedLine(rawPos), skipped: 'page-number' };
  }
  if (PAGE_MARKER.test(line)) {
    const rawPos = `${line.trim()}{page marker}`;
    return { rawPos, tokens: parseTaggedLine(rawPos), skipped: 'page-marker' };
  }
  const input = posSourceLine(line);
  if (!input.trim()) return { rawPos: '', tokens: [], skipped: 'no-pos-input' };
  const rawPos = await tagPosLine(input, bindEngine);
  return { rawPos, tokens: parseTaggedLine(rawPos), skipped: null };
}

function unknownContexts(tokens) {
  const results = [];
  for (let i = 0; i < tokens.length;) {
    if (tokens[i].kind !== 'unknown') { i += 1; continue; }
    let end = i + 1;
    while (end < tokens.length && tokens[end].kind === 'unknown') end += 1;
    const before = [];
    for (let p = i - 1; p >= 0 && before.length < 2; p -= 1) {
      if (tokens[p].kind === 'known') before.unshift(tokens[p]);
    }
    const after = [];
    const wantedAfter = end - i > 1 ? 2 : 1;
    for (let p = end; p < tokens.length && after.length < wantedAfter; p += 1) {
      if (tokens[p].kind === 'known') after.push(tokens[p]);
    }
    results.push({
      count: end - i,
      context: [...before, ...tokens.slice(i, end), ...after].map((token) => token.formatted).join('  '),
    });
    i = end;
  }
  return results;
}

function writeAll(fd, value) {
  const bytes = Buffer.from(value, 'utf8');
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error('Could not write the POS scan file');
    offset += count;
  }
}

async function* readRecords(file) {
  const input = fs.createReadStream(file, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

// The normalized output is written to this private spool while the real
// output writer runs. Only after that writer finishes does scan read the
// spool back and send each line through the hash-free POS bridge.
export class PosScanner {
  constructor({ directory = os.tmpdir(), bindEngine = null } = {}) {
    this.directory = fs.mkdtempSync(path.join(directory, 'linga-pos-scan-'));
    fs.chmodSync(this.directory, 0o700);
    this.file = path.join(this.directory, 'pages.txt');
    try {
      this.fd = fs.openSync(this.file, 'wx', 0o600);
    } catch (error) {
      fs.rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
    this.binding = bindEngine;
    this.closed = false;
    this.complete = false;
    this.unpagedStarted = false;
    // Only broken scan results are retained: one entry per unknown-token
    // context, with its page and line. Tagged lines are consumed and dropped.
    this.memory = [];
  }

  async writePage(page, chunks) {
    if (this.closed || this.complete) throw new Error('POS scanner is closed');
    if (page !== null && (!Number.isInteger(page) || page < 1)) throw new TypeError('Expected a positive page number or null');
    if (page !== null || !this.unpagedStarted) {
      writeAll(this.fd, `${JSON.stringify({ type: 'page', page, marker: page === null ? null : `--- Page ${page} ---` })}\n`);
      this.unpagedStarted = page === null;
    }
    for (const line of textLines(chunks)) {
      writeAll(this.fd, `${JSON.stringify({ type: 'line', text: line })}\n`);
    }
  }

  // Read the normalized-output spool back, hand each line to BindEngine,
  // consume its tagged output, and scan that output immediately. Only the
  // broken unknown-token contexts survive, in this.memory as
  // { page, line, context, count }; all other tagged lines are dropped.
  async finish() {
    if (this.complete || this.closed) throw new Error('POS scanner is closed');
    this.complete = true;
    try {
      fs.closeSync(this.fd);
      this.fd = null;
      this.memory = [];
      const longLines = [];
      const ranges = [];
      let physicalPage = false;
      let page = null;
      let lineNumber = 0;
      let sequence = 0;
      let unpagedFirst = null;
      let unknownCount = 0;

      for await (const record of readRecords(this.file)) {
        if (record.type === 'page') {
          page = record.page;
          physicalPage = page !== null;
          lineNumber = 0;
          unpagedFirst = null;
          continue;
        }
        const source = record.text;
        const marker = PAGE_MARKER.exec(source);
        if (marker && !physicalPage) {
          page = pageNumber(marker[1]);
          lineNumber = 0;
          continue;
        }
        lineNumber += 1;
        sequence += 1;
        const numericPage = isPageNumberLine(source);
        const numericValue = numericPage ? pageNumber(source.trim()) : null;
        // In unpaged text, a short numeric footer names the lines before
        // it. Remember that range while streaming; only the retained
        // broken entries are resolved against it afterwards.
        if (!physicalPage && page === null) {
          unpagedFirst ??= sequence;
          if (numericValue !== null) {
            ranges.push({ first: unpagedFirst, last: sequence, page: numericValue });
            unpagedFirst = null;
          }
        }
        const needsFallback = !physicalPage && page === null;
        if (Buffer.byteLength(source, 'utf8') > MAX_LINE_BYTES) {
          longLines.push({ page, line: lineNumber, sequence, needsFallback });
        }
        let rawPos = '';
        if (numericPage) {
          rawPos = `${source.trim()}{page number}`;
        } else if (marker) {
          rawPos = `${source.trim()}{page marker}`;
        } else {
          const input = posSourceLine(source);
          if (input.trim()) {
            this.binding ??= engineBind;
            rawPos = await tagPosLine(input, this.binding);
          }
        }
        for (const hit of unknownContexts(parseTaggedLine(rawPos))) {
          unknownCount += hit.count;
          this.memory.push({
            page, line: lineNumber, sequence, needsFallback,
            context: hit.context, count: hit.count,
          });
        }
      }

      const resolveFallback = (entry) => {
        if (!entry.needsFallback) return;
        const range = ranges.find((r) => entry.sequence >= r.first && entry.sequence <= r.last);
        if (range) {
          entry.page = range.page;
          entry.line = entry.sequence - range.first + 1;
        }
      };
      for (const entry of this.memory) resolveFallback(entry);
      for (const entry of longLines) resolveFallback(entry);
      for (const entry of [...this.memory, ...longLines]) {
        delete entry.sequence;
        delete entry.needsFallback;
      }
      return {
        memory: this.memory,
        unknownCount,
        contextCount: this.memory.length,
        longLines,
      };
    } finally {
      await this.close();
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.fd !== null) fs.closeSync(this.fd);
    this.fd = null;
    fs.rmSync(this.directory, { recursive: true, force: true });
  }
}

export async function scanTextWithPos(text, { page = null, directory, bindEngine } = {}) {
  const scanner = new PosScanner({ directory, bindEngine });
  try {
    await scanner.writePage(page, [String(text ?? '')]);
    return await scanner.finish();
  } finally {
    await scanner.close();
  }
}


// FILE: bundler.js
#!/usr/bin/env node
/**
 * bundler.js (prepare-map-bundle)
 * Category: build
 *
 * Flattens the sensitive Myanmar mapping modules into a single self-contained
 * `bundle.js` (the payload that build.js later obfuscates + encrypts into
 * actual.mjs). The flattened bundle:
 *   - strips ESM `import` / `export` so it can be eval'd after decryption,
 *   - neutralises the logen DEBUG hooks (no-ops) so the sensitive normalize
 *     path never logs, even if DEBUG_MODE is on,
 *   - registers every public export on `globalThis.__modules`.
 *
 * Modules bundled (order matters for hoisting):
 *   sourceMap -> _function -> sourceMapper -> _encode -> _decode
 *
 * Usage:
 *   node Tools/build/bundler.js [--src <readable-map-dir>] [--out bundle.js]
 *
 * Both flags are optional. Defaults keep everything inside the map dir:
 *   --src  Private/Syllable/mapper/map   (the in-repo map dir)
 *   --out  <map-dir>/bundle.js           (written next to the sources)
 * Pass --src only to build from a different readable map dir.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// The in-repo map dir. Build inputs AND outputs live here, so every rebuild
// lands in the map dir automatically.
const MAP_DIR = path.join(REPO_ROOT,  "mymap");

const argValue = (name) => {
	const i = process.argv.indexOf(name);
	return i === -1 ? undefined : process.argv[i + 1];
};
const srcDir = argValue("--src") || MAP_DIR;
const outFile = argValue("--out") || path.join(MAP_DIR, "bundle.js");

// Order in which the modules are emitted (dependencies first).
const ORDER = ["sourceMap", "_function", "sourceMapper", "_encode", "_decode"];
const FILES = ["sourceMap.js", "sourceMapper.js", "_encode.js", "_decode.js"];

if (!fs.existsSync(srcDir)) {
	console.error(`Source dir not found: ${srcDir}`);
	process.exit(1);
}

/** Remove ESM import declarations. */
function stripImports(src) {
	return src.replace(
		/^\s*import[\s\S]*?from\s*['"][^'"]+['"]\s*;?/gm,
		"",
	);
}

/** Remove ESM export keywords so declarations stay in the flat scope. */
function stripExports(src) {
	return src
		.replace(/^export\s*\{[^}]*\}\s*;?$/gm, "")
		.replace(/\bexport\s+default\b/g, "")
		.replace(/^export\s+(async\s+function)\s+/gm, "$1 ")
		.replace(/^export\s+function\s+/gm, "function ")
		.replace(/^export\s+const\s+/gm, "const ")
		.replace(/^export\s+let\s+/gm, "let ")
		.replace(/^export\s+var\s+/gm, "var ");
}

/** Read + flatten one module, guarding against missing files. */
function readModule(name) {
	const p = path.join(srcDir, `${name}.js`);
	if (!fs.existsSync(p)) {
		console.warn(`  ! missing ${name}.js in ${srcDir}`);
		return null;
	}
	const src = fs.readFileSync(p, "utf8");
	return stripExports(stripImports(src));
}

const modules = {};
for (const name of ORDER) {
	modules[name] = readModule(name);
}

const registry = `
// ── REGISTRY: public exports (kept stable, only names, no source) ──
globalThis.__modules = {
	sourceMap:     { MMap, NewMap, newClause, PUNCTUATION, Glue, IMPOSTER, Priority, ENGLISH_DIGITS, BURMESE_DIGITS, ALL_DIGITS },
	sourceMapper:  { mapperStr, toBurmeseStr, isTail, isBase, isNum, isStick, isStandalone },
	_function:     { isLowerOrUpperAZ, isLowercaseAZ, isUppercaseAZ, compose, decompose, burmeseTokenToAscii, asciiTokenToBurmese, withBraceBypass },
	_encode:       { normalize, MyNormalize },
	_decode:       { formatResolvedLine, writeResolved, makeReadable, getBatchSize },
};
`;

const shims = `// ── logen DEBUG hooks neutralised: the sensitive normalize path never logs ──
var normalizeStart = function(){};
var normalizeEnd   = function(){};
var normFixImposter = function(){};
var normComposeNormal = function(){};
var normComposeNgaasat = function(){};
var debugLogInit   = function(){};
var debugLogPass   = function(){};

// fs shim for _decode.getBatchSize (provided by the actual.mjs runtime)
var fs = globalThis.__fs;
`;

const header = `/* bundle.js — FLATTENED Myanmar map layer (generated by Tools/build/bundler.js)
   Do not edit by hand. Regenerate with:
     node Tools/build/bundler.js
   This is the payload Tools/build/build.js obfuscates + encrypts. */
`;

const bundle =
	header +
	shims +
	`\n// ── FILE: sourceMap.js ──\n${modules.sourceMap}\n` +
	`\n// ── FILE: _function.js ──\n${modules._function}\n` +
	`\n// ── FILE: sourceMapper.js ──\n${modules.sourceMapper}\n` +
	`\n// ── FILE: _encode.js ──\n${modules._encode}\n` +
	`\n// ── FILE: _decode.js ──\n${modules._decode}\n` +
	registry;

fs.writeFileSync(outFile, bundle, "utf8");

// Quick sanity: eval it and check exports resolve.
globalThis.__fs = fs;
(0, eval)(bundle);
const m = globalThis.__modules;
const names = {
	sourceMap: Object.keys(m.sourceMap),
	sourceMapper: Object.keys(m.sourceMapper),
	_function: Object.keys(m._function),
	_encode: Object.keys(m._encode),
	_decode: Object.keys(m._decode),
};
console.log(`Wrote ${outFile} (${(Buffer.byteLength(bundle) / 1024).toFixed(2)} KB)`);
for (const k of Object.keys(names)) console.log(`  ${k}: ${names[k].join(", ")}`);


// FILE: codepage/cmap.js
/*
(Support 29) Shared support, no chain position - TrueType cmap parsing.
This module reads a TrueType font's tables and parses its cmap, the map from character codes to glyphs that embedded-font decoding relies on.
*/
import { ValueError } from "../pylib.js";


function readU16PythonSlice(buf, a) {
  let start = a < 0 ? buf.length + a : a;
  let stop = a + 2;
  if (stop < 0) stop = buf.length + stop;
  start = Math.min(Math.max(start, 0), buf.length);
  stop = Math.min(Math.max(stop, 0), buf.length);
  if (stop - start !== 2) throw new ValueError("unpack requires a buffer of 2 bytes");
  return buf.readUInt16BE(start);
}

























const SUBTABLE_RANK = [
  [3, 10, 100],
  [0, 4, 95],
  [0, 6, 90],
  [3, 1, 85],
  [0, 3, 80],
  [0, 0, 70],
  [0, 1, 70],
  [0, 2, 70],
  [3, 0, 60],
  [1, 0, 30],
];

function subtableRank(plat, enc) {
  for (const [p, e, rank] of SUBTABLE_RANK) {
    if (p === plat && e === enc) return rank;
  }
  return 10;
}


function readSubtable(sub, out) {
  if (sub.length < 2) return 0;
  const fmt = sub.readUInt16BE(0);
  if (fmt === 4) {
    if (sub.length < 14) return 0;
    const segCount = sub.readUInt16BE(6) >> 1;
    if (sub.length < 14 + segCount * 8) return 0;
    const ends = [];
    for (let i = 0; i < segCount; i += 1) ends.push(sub.readUInt16BE(14 + i * 2));
    const so = 14 + segCount * 2 + 2;
    const starts = [];
    for (let i = 0; i < segCount; i += 1) starts.push(sub.readUInt16BE(so + i * 2));
    const doff = so + segCount * 2;
    const deltas = [];
    for (let i = 0; i < segCount; i += 1) deltas.push(sub.readInt16BE(doff + i * 2));
    const ro = doff + segCount * 2;
    const ranges = [];
    for (let i = 0; i < segCount; i += 1) ranges.push(sub.readUInt16BE(ro + i * 2));
    for (let j = 0; j < segCount; j += 1) {
      if (starts[j] === 0xffff) continue;
      for (let c = starts[j]; c <= ends[j]; c += 1) {
        let gid;
        if (ranges[j] === 0) {
          gid = (c + deltas[j]) & 0xffff;
        } else {

















          const idx = ((ranges[j] / 2) | 0) + (c - starts[j]) + j;
          const addr = ro + idx * 2;
          if (addr + 2 > sub.length) continue;
          gid = readU16PythonSlice(sub, addr);
          if (gid) gid = (gid + deltas[j]) & 0xffff;
        }
        if (gid) out.set(c, gid);
      }
    }
  } else if (fmt === 0) {





    const count = Math.min(256, sub.length - 6);
    if (count < 8) return 0;
    for (let c = 0; c < count; c += 1) {
      const gid = sub[6 + c];
      if (gid) out.set(c, gid);
    }
  } else if (fmt === 6) {
    if (sub.length < 10) return 0;
    const firstCode = sub.readUInt16BE(6);
    const entryCount = sub.readUInt16BE(8);
    for (let j = 0; j < entryCount; j += 1) {
      if (10 + j * 2 + 2 > sub.length) break;
      const gid = sub.readUInt16BE(10 + j * 2);
      if (gid) out.set(firstCode + j, gid);
    }
  } else if (fmt === 12) {
    if (sub.length < 16) return 0;
    const numGroups = sub.readUInt32BE(12);
    let go = 16;
    for (let g = 0; g < numGroups; g += 1) {
      if (go + 12 > sub.length) break;
      const sc = sub.readUInt32BE(go);
      const ec = sub.readUInt32BE(go + 4);
      const sg = sub.readUInt32BE(go + 8);
      go += 12;
      for (let c = sc; c <= ec; c += 1) out.set(c, sg + (c - sc));
    }
  }
  return out.size;
}



export function ttfTables(data) {
  const out = new Map();
  if (!data || data.length < 12) return out;
  const numTables = data.readUInt16BE(4);
  let off = 12;
  for (let t = 0; t < numTables; t += 1) {
    if (off + 16 > data.length) break;
    const tag = data.toString("latin1", off, off + 4);
    out.set(tag, [data.readUInt32BE(off + 8), data.readUInt32BE(off + 12)]);
    off += 16;
  }
  return out;
}

export function parseTtfCmap(data) {
  if (!data || data.length < 12) return new Map();
  const tbls = ttfTables(data);
  if (!tbls.has("cmap")) return new Map();
  const cmapOff = tbls.get("cmap")[0];
  if (cmapOff + 4 > data.length) return new Map();
  const cmap = data.subarray(cmapOff);
  const numSub = cmap.readUInt16BE(2);

  const subs = [];
  let off = 4;
  for (let s = 0; s < numSub; s += 1) {
    if (off + 8 > cmap.length) break;
    const plat = cmap.readUInt16BE(off);
    const enc = cmap.readUInt16BE(off + 2);
    const subOff = cmap.readUInt32BE(off + 4);
    off += 8;
    if (subOff + 2 > cmap.length) continue;
    subs.push({ plat, enc, subOff, rank: subtableRank(plat, enc), order: s });
  }


  subs.sort((a, b) => (b.rank - a.rank) || (a.order - b.order));

  for (const entry of subs) {
    const mappings = new Map();
    if (readSubtable(cmap.subarray(entry.subOff), mappings) > 0) return mappings;
  }
  return new Map();
}


// FILE: codepage/codepage-confirmed.js
/*
(Support 35) Shared support, no chain position - confirmed-run matching.
This module checks whether a confirmed byte run from a selected resource profile occurs at a position. It does not select profiles or route anything.
*/
// Match only runs supplied by the selected resource profile. This helper
// does not select profiles or route by PDF/document hash.
export function confirmedRunAt(profile, data, index) {
  for (const run of profile.runs) {
    if (run.bytes.every((byte, offset) => data.charCodeAt(index + offset) === byte)) return run;
  }
  return null;
}


// FILE: codepage/codepage-names.js
/*
(Support 27) Shared support, no chain position - the legacy font-name registry.
This module holds the curated set of known legacy font names and answers: is this font name a registered legacy face, and what is its normalized form.
*/
export const LEGACY_FONT_NAMES = new Set([
  "anonymouspro",
  "anonymousprobold",
  "anonymousprobolditalic",
  "anonymousproitalic",
  "anonymousproregular",
  "arkamm001tt",
  "arkaoriginal",
  "atypewriternormal",
  "cetitle",
  "msheavy",
  "msmoom",
  "nyicircle",
  "nyidesigner",
  "nyidesigner1",
  "nyidesigner2",
  "nyielephant",
  "nyihorizonal",
  "nyioval",
  "nyit",
  "nyithit1",
  "nyithit2",
  "nyithitf3",
  "nyithitfontfour",
  "nyithitfontone",
  "nyithitfonttwo",
  "nyitwice",
  "robin",
  "sakart",
  "sakmahura",
  "sakpadamya",
  "sakpeacock",
  "sakryoal",
  "sakseinarka",
  "sakthick",
  "saktwoline",
  "sakwide",
  "sakyatana",
  "softcrack",
  "u4ahlone",
  "u4bahan",
  "u4botataung",
  "u4dagonmyothit",
  "u4pazundaung",
  "u4thaketa",
  "w01arthouse",
  "w01arthouse2009",
  "w01arthousewin",
  "w02arthouse",
  "w02arthouse2009",
  "w02arthousewin",
  "w03arthouse",
  "w03arthouse2009",
  "w03arthousewin",
  "w04arthouse",
  "w04arthouse2009",
  "w04arthousewin",
  "w05arthouse",
  "w05arthouse2009",
  "w05arthousewin",
  "w06arthouse",
  "w06arthouse2009",
  "w06arthousewin",
  "w07arthouse",
  "w07arthouse2009",
  "w07arthousewin",
  "w08arthouse",
  "w08arthouse2009",
  "w08arthousewin",
  "w09arthouse",
  "w09arthouse2009",
  "w09arthousewin",
  "w10arthouse",
  "w10arthouse2009",
  "w10arthousewin",
  "w11arthouse",
  "w11arthouse2009",
  "w11arthousewin",
  "w12arthouse",
  "w12arthouse2009",
  "w12arthousewin",
  "w13arthouse",
  "w13arthouse2009",
  "w13arthousewin",
  "w14arthouse",
  "w14arthouse2009",
  "w14arthousewin",
  "w15arthouse",
  "w15arthouse2009",
  "w15arthousewin",
  "w16arthouse",
  "w16arthouse2009",
  "w16arthousewin",
  "w17arthouse",
  "w17arthouse2009",
  "w17arthousewin",
  "w18arthouse",
  "w18arthouse2009",
  "w18arthousewin",
  "w19arthouse",
  "w19arthouse2009",
  "w19arthousewin",
  "w20arthouse",
  "w20arthouse2009",
  "w20arthousewin",
  "w21arthouse",
  "w21arthouse2009",
  "w21arthousebold",
  "w22arthouse",
  "w22arthouse2009",
  "w23arthouse",
  "w23arthouse2009",
  "w24arthouse",
  "w24arthouse2009",
  "w25arthouse",
  "w25arthouse2009",
  "w26arthouse",
  "w26arthouse2009",
  "w27arthouse",
  "w27arthouse2009",
  "w28arthouse",
  "w28arthouse2009",
  "w29arthouse",
  "w29arthouse2009",
  "w30arthouse",
  "w30arthouse2009",
  "w31arthouse",
  "w31arthouse2009",
  "w31arthousebold",
  "w32arthouse",
  "w32arthouse2009",
  "w33arthouse",
  "w33arthouse2009",
  "w34arthouse",
  "w34arthouse2009",
  "w35arthouse",
  "w35arthouse2009",
  "w36arthouse",
  "w36arthouse2009",
  "w37arthouse",
  "w37arthouse2009",
  "w37arthousebold",
  "w38arthouse",
  "w38arthouse2009",
  "w39arthouse",
  "w39arthouse2009",
  "w40arthouse",
  "w40arthouse2009",
  "w41arthouse",
  "w41arthouse2009",
  "w42arthouse",
  "w42arthouse2009",
  "w43arthouse",
  "w43arthouse2009",
  "w44arthouse",
  "w44arthouse2009",
  "w45arthouse",
  "w45arthouse2009",
  "w46arthouse",
  "w46arthouse2009",
  "w47arthouse",
  "w47arthouse2009",
  "w48arthouse",
  "w48arthouse2009",
  "w49arthouse",
  "w49arthouse2009",
  "w50arthouse",
  "w50arthouse2009",
  "w51arthouse",
  "w51arthouse2009",
  "w52arthouse2009",
  "w53arthouse",
  "w53arthouse2009",
  "w54arthouse",
  "w54arthouse2009",
  "w55arthouse",
  "w55arthouse2009",
  "w56arthouse",
  "w56arthouse2009",
  "w57arthouse",
  "w57arthouse2009",
  "w58arthouse",
  "w58arthouse2009",
  "w59arthouse",
  "w59arthouse2009",
  "w60arthouse",
  "w60arthouse2009",
  "w61arthouse",
  "w61arthousebold",
  "w61arthousebolditalic",
  "w61arthouseextrabold",
  "w61arthouseitalic",
  "w62arthouse",
  "w62arthousebold",
  "w63arthouse",
  "w64arthouse",
  "w65arthouse",
  "w66arthouse",
  "w67arthouse",
  "w68arthouse",
  "w69arthouse",
  "w70arthouse",
  "whponnya",
  "whponnyabold",
  "winhaka",
  "wininnlay",
  "wininnlaya",
  "wininnwa",
  "wininnwa070",
  "wininnwa070a",
  "wininnwa080",
  "wininnwa080a",
  "wininnwa090",
  "wininnwa090a",
  "wininnwabold",
  "winkalaw",
  "winphaan",
  "winphaana",
  "winresearcher",
  "winresearchera",
  "wintaungyi",
  "wintaungyia",
  "winthanlyin",
  "winthanlyina",
  "winyadanapon",
  "winyadanapona",
  "winyangon",
  "winyangona",
  "wthawka",
  "wwinburmese",
  "wwinhanpagan",
  "wwinhanpagana",
  "wwinhanponnyacond",
  "wwinhlaing",
  "wwinhlaingmedium",
  "wwinponnyacond",
  "wwinponnyacondbold",
  "wwinponnyacondextrabold",
  "yadanabon",
]);

export function normaliseFontName(baseFont) {
  return String(baseFont || "")
    .replace(/#([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/^[A-Z]{6}\+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

// These are legacy faces, but neither registered Ayar nor WinInnwa is a
// verified decoder for them. A font name is evidence of a gap, not a map.
export function isUnresolvedLegacyFont(baseFont) {
  const n = normaliseFontName(baseFont);
  return n.startsWith("wwin") || n.startsWith("msheavy") || n.startsWith("msmoom");
}

export function isLegacyFontName(baseFont) {
  const n = normaliseFontName(baseFont);
  if (!n) return false;
  if (LEGACY_FONT_NAMES.has(n)) return true;
  for (const known of LEGACY_FONT_NAMES) {
    if (known.length >= 6 && (n.startsWith(known) || known.startsWith(n))) return true;
  }
  return false;
}


// FILE: codepage/codepage-pooled.js
/*
(Support 36) Shared support, no chain position - pooled keyboard and font evidence.
This module serves candidate evidence for repair: beautify candidates for a font's bytes, and physical-key candidates for typed text. Evidence only - it makes no repair decisions.
*/
import { loadMapJson } from "../json-map.js";
import { normaliseFontName } from "./codepage-names.js";

// Candidate evidence is intentionally separate from repair decisions. A key
// typed on a keyboard is not a PDF byte; neither kind identifies a keyboard.
let evidence = null;
let keystrokesByOutput = null;

function pool() {
  if (evidence === null) evidence = loadMapJson("pooled-keyboard-font-evidence.json");
  return evidence;
}

export function pdfBeautifyCandidates(font, bytes) {
  if (!font || typeof font.fontSha256 !== "string" || typeof font.toUnicodeSha256 !== "string"
      || typeof font.baseFont !== "string" || !Number.isInteger(font.firstChar)
      || !Number.isInteger(font.lastChar) || typeof font.hasEncoding !== "boolean") {
    throw new TypeError("Expected the embedded font, ToUnicode, code range and explicit encoding evidence");
  }
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    throw new TypeError("Expected non-empty raw PDF bytes");
  }
  const scope = pool().pdf_font_scopes.find(({ scope: s }) =>
    s.font_sha256 === font.fontSha256.toLowerCase()
    && s.tounicode_sha256 === font.toUnicodeSha256.toLowerCase()
    && s.base_font === normaliseFontName(font.baseFont)
    && s.first_char === font.firstChar && s.last_char === font.lastChar
    && s.encoding === "absent" && !font.hasEncoding);
  if (!scope) return { status: "unmatched-font-resource", candidates: [] };
  const hex = Buffer.from(bytes).toString("hex").toUpperCase();
  // Runs are exact, observed contexts; do not invent a universal byte grouping.
  const entry = (bytes.length === 1 ? scope.bytes[hex] : scope.runs[hex] || scope.unresolved_runs[hex]);
  if (!entry) return { status: "unmapped", candidates: [] };
  return {
    status: entry.status,
    candidates: [...entry.candidates],
    requiresContext: entry.requires_context,
    sourcePdfSha256: scope.source_pdf_sha256,
    ...(entry.source_page ? { sourcePage: entry.source_page } : {}),
    ...(entry.source_pages ? { sourcePages: [...entry.source_pages] } : {}),
    ...(entry.reason ? { reason: entry.reason } : {}),
  };
}

export function physicalKeyCandidates(keys) {
  if (typeof keys !== "string" || !keys.length) throw new TypeError("Expected a physical key sequence");
  // This lookup is for replay evidence, NEVER for decoding a PDF character code.
  const data = pool();
  const list = Object.hasOwn(data.physical_keystrokes, keys) ? data.physical_keystrokes[keys]
    : Object.hasOwn(data.parser_exact_full_line_replays, keys) ? data.parser_exact_full_line_replays[keys] : [];
  return structuredClone(list);
}

export function evidenceForOutput(text) {
  if (typeof text !== "string" || !text.length) throw new TypeError("Expected a non-empty output string");
  const data = pool();
  if (keystrokesByOutput === null) {
    keystrokesByOutput = new Map();
    for (const [keys, candidates] of Object.entries(data.physical_keystrokes)) {
      for (const candidate of candidates) {
        const list = keystrokesByOutput.get(candidate.output) || [];
        list.push({ keys, artifactObservations: candidate.artifact_observations,
          eventStatusCounts: candidate.event_status_counts });
        keystrokesByOutput.set(candidate.output, list);
      }
    }
  }
  return {
    pdfSlots: structuredClone(Object.hasOwn(data.by_output, text) ? data.by_output[text] : []),
    physicalKeys: structuredClone(keystrokesByOutput.get(text) || []),
    sampleReplays: structuredClone(Object.hasOwn(data.parser_exact_sample_replays_by_output, text)
      ? data.parser_exact_sample_replays_by_output[text] : []),
  };
}


// FILE: codepage/codepage-registry.js
/*
(Support 28) Shared support, no chain position - the legacy code pages themselves.
This module holds the Ayar and WinInnwa code-page tables (byte to Unicode maps) the legacy font lane (PDF 16) decodes with.
*/

export const AYAR_LEGACY_CODE_PAGE = new Map([
  [32, ' '], [33, '\u100b'], [34, '\u104b'], [35, '\u100d'],
  [36, '\u100e'], [38, '\u104e'], [39, '\u104a'], [40, '('],
  [41, ')'], [42, '\u100f'], [43, '+'], [45, '\u2014'],
  [46, '\u1037'], [47, '/'], [48, '\u1040'], [49, '\u1041'],
  [50, '\u1042'], [51, '\u1043'], [52, '\u1044'], [53, '\u1045'],
  [54, '\u1046'], [55, '\u101b'], [56, '\u1048'], [57, '\u1049'],
  [59, '\u1038'], [60, '\u2018'], [61, '='], [62, '\u1037'],
  [64, '\u100c'], [65, '\u1021'], [66, '\u1018'], [68, '\u1013'],
  [69, '\u1027'], [70, '\u100b'], [71, '\u1003'], [72, '\u103e'],
  [73, '\u1023'], [74, '\u1039\u1015'], [75, '\u1001'], [76, '\u1020'],
  [77, '\u1036'], [78, '\u1014'], [79, '\u103e\u102f'], [80, '\u1016'],
  [81, '\u103f'], [82, '\u101b'], [83, '\u1006'], [84, '\u1011'],
  [85, '\u1025'], [87, '\u103d\u103e'], [88, '\u103d'], [89, '\u103b\u103e'],
  [90, '\u1008'], [92, '\u103a'], [94, '\u102e'], [95, ''],
  [96, '\u1039\u1017'], [97, '\u102c'], [98, '\u1017'], [99, '\u1004'],
  [100, '\u1012'], [101, '\u1031'], [102, '\u104f'], [103, '\u1002'],
  [104, '\u101f'], [105, '\u102d'], [106, '\u104d'], [107, '\u1000'],
  [108, '\u101c'], [109, '\u1019'], [110, '\u1014'], [111, '\u102f'],
  [112, '\u1015'], [113, '\u101e'], [114, '\u101b'], [115, '\u1005'],
  [116, '\u1010'], [117, '\u102f'], [118, '\u100a'], [119, '\u1040'],
  [120, '\u103e'], [121, '\u101a'], [122, '\u1007'], [123, '\u2018'],
  [124, '\u1039\u1010'], [125, '\u2019'], [126, '\u1039\u1014'], [161, '\u100b\u1039\u100b'],
  [162, '\u100d\u1039\u100e'], [163, '\u100d\u1039\u100d'], [164, '\u100f\u1039\u100c'], [165, '\u103b'],
  [167, '\u100f\u1039\u100c'], [168, '\u1030'], [169, '\u1039\u1002'], [171, '\u1039\u1007'],
  [172, '\u1039\u101c'], [174, '\u103c'], [177, '\u1039\u1018'], [180, '\u1032'],
  [181, '\u1039\u1019'], [182, '\u1039\u1000'], [187, '\u1039\u1012'], [193, '\u103b\u103d'],
  [194, '\u103c'], [196, '\u1039\u1016'], [197, '\u102b\u103a'], [199, '\u1004\u103a\u1039\u102e'],
  [200, '\u1024'], [201, '_'], [202, '\u1039\u1011'], [204, '\u1039\u1003'],
  [205, '\u1039\u1006'], [206, '\u1039\u1013'], [207, '\u1037'], [210, '\u104c'],
  [211, '\u1037'], [219, '\u1039\u1008'], [223, '\u1039\u1005'], [229, '\u102b'],
  [231, '\u1004\u103a\u1039'], [238, '\u1039\u1010'], [241, '\u1029'], [248, '\u1030'],
  [339, '\u103f'], [402, '\u1039\u1001'], [710, '\u1009'], [732, '\u102d\u1036'],
  [8220, '\u103c'], [8221, '\u103c'], [8226, '\u100f\u1039\u100f'], [8240, '\u2019'],
  [8249, '\u100f\u1039\u100d'], [8482, '\u100b\u1039\u100c'],
]);

// These are WinInnwa legacy character slots, not PDF-local bytes or keys.
// TODO: Verify the original version-specific WinInnwa keyboard layout, modifier
// layers, and output slots against vendor materials when they become available.
// Do not assume this converter map is the original keyboard layout.
// The W, A6, BF, C9, D8, E7 and F0 entries are supported by a recorded
// keyboard and converter witnesses, but were not seen in the surveyed PDFs.
// Ambiguous or conflicting, unobserved slots remain outside the mapping.
export const WININNWA_LEGACY_CODE_PAGE = new Map([
  [32, " "], [33, "\u100d"], [34, "\u1013"], [35, "\u100b"],
  [38, "\u101b"], [39, "\u1012"],
  [40, "("], [41, ")"], [42, "\u1002"], [43, "+"],
  [44, "\u101a"], [45, "\u2014"], [46, "."], [47, "\u104b"],
  [48, "\u1040"], [49, "\u1041"], [50, "\u1042"], [51, "\u1043"],
  [52, "\u1044"], [53, "\u1045"], [54, "\u1046"], [55, "\u1047"],
  [56, "\u1048"], [57, "\u1049"], [58, "\u102b\u103a"], [59, "\u1038"],
  [60, "\u103c\u103d"], [61, "="], [62, "\u103c\u103d"], [63, "\u104a"],
  [64, "\u100f\u1039\u100d"], [65, "\u1017"], [66, "\u103c"], [67, "\u1003"],
  [68, "\u102e"], [69, "\u1014"], [70, "\u1004\u103a\u1039"], [71, "\u103d"],
  [72, "\u1036"], [73, "\u103e\u102f"], [74, "\u1032"], [75, "\u102f"],
  [76, "\u1030"], [77, "\u103c"], [78, "\u103c"], [79, "\u1025"],
  [80, "\u100f"], [81, "\u103b\u103e"], [82, "\u103b\u103d"], [83, "\u103e"],
  [84, "\u103d\u103e"], [85, "\u1037"], [86, "\u1020"], [87, "\u103b\u103d\u103e"],
  [88, "\u100c"], [89, "\u1037"], [90, "\u1007"], [91, "\u101f"],
  [92, "\u104f"], [93, "\u2018"], [94, "/"], [95, "\u00d7"],
  [96, "\u103c"], [97, "\u1031"], [98, "\u1018"], [99, "\u1001"],
  [100, "\u102d"], [101, "\u1014"], [102, "\u103a"], [103, "\u102b"],
  [104, "\u1037"], [105, "\u1004"], [106, "\u103c"], [107, "\u102f"],
  [108, "\u1030"], [109, "\u102c"], [110, "\u100a"], [111, "\u101e"],
  [112, "\u1005"], [113, "\u1006"], [114, "\u1019"], [115, "\u103b"],
  [116, "\u1021"], [117, "\u1000"], [118, "\u101c"], [119, "\u1010"],
  [120, "\u1011"], [121, "\u1015"], [122, "\u1016"], [123, "\u1027"],
  [125, "\u2019"], [126, "\u103c"], [161, "\u100e"], [162, "\u1039\u1003"],
  [163, "\u1023"], [164, "\u104e"], [165, "\u100b\u1039\u100b"], [166, "\u1039\u1011"], [167, "\u103e"],
  [168, "\u1039\u1013"], [169, "\u1039\u1001"], [170, "\u103e\u1030"], [172, "\u1039\u1011"],
  [174, "\u1039\u1019"], [177, "\u101b"], [178, "\u1039\u100c"], [179, "\u1039\u100b"],
  [180, "\u1039\u1012"], [182, "\u101b"], [183, "*"],
  [184, "\u103d\u103e"], [185, "\u100d\u1039\u100e"], [186, "\u103c"], [189, "\u101b"],
  [190, "\u1039\u1002"], [191, "?"],
  // The earlier WinInnwa table maps C0 to the complete stack.
  [192, "\u100f\u1039\u100f"], [193, "\u1039\u1017"],
  [197, "\u1039\u1010"], [198, "\u1039\u1007"], [199, "\u1039\u1018"],
  [201, "\u1039\u1010\u103d"], [205, "\u1009"],
  [208, "\u1004\u103a\u1039\u102e"], [209, "\u1039\u1008"], [211, "\u1009\u102c"], [214, "\u1039\u100f"],
  [215, "\u100d\u1039\u100d"], [216, "\u1004\u103a\u1039\u102d"], [218, "\u1009"], [220, "\u1039\u1015"],
  [228, "\u1039\u1006"], [229, "\u1039\u1010"], [230, "\u1039\u1016"],
  [231, ","], [233, "\u1039\u1014"], [235, "\u103d"], [236, "\u103d\u103e"], [237, "\u104d"],
  [238, "\u103b\u103d\u103e"], [239, "\u103d\u103e"], [240, "\u102d\u1036"], [241, "\u100a"],
  [242, "\u103c\u102f"], [243, "\u103f"], [244, "\u1004\u103a\u1039\u102e"], [245, "\u1004\u103a\u1039\u102d"],
  [246, "\u1039\u1005"], [248, "\u1004\u103a\u1039\u1036"], [250, "\u1039\u1000"], [252, "\u104c"],
  [254, "\u1024"], [8217, "\u1039\u101c"],
]);

// U+0025 was questioned and was not observed in the surveyed editions.
// U+007C has conflicting source contexts; the other entries have conflicting,
// unobserved candidates.
export const WININNWA_UNRESOLVED_SLOTS = new Set([0x24, 0x25, 0x7c, 0xb5, 0xea]);

export const SHARED_LEGACY_CODE_PAGE = new Map(
  [...AYAR_LEGACY_CODE_PAGE].filter(([code, value]) =>
    WININNWA_LEGACY_CODE_PAGE.has(code) && WININNWA_LEGACY_CODE_PAGE.get(code) === value),
);

// Shared values are consulted once for the two supplied layout tables. Other
// maps retain their own key domain and must not inherit this shared table.
export function lookupLegacyCode(code, codePage) {
  if ((codePage === AYAR_LEGACY_CODE_PAGE || codePage === WININNWA_LEGACY_CODE_PAGE)
      && SHARED_LEGACY_CODE_PAGE.has(code)) {
    return SHARED_LEGACY_CODE_PAGE.get(code);
  }
  return codePage.get(code);
}

export const LEGACY_CODE_PAGES = new Map([
  ['ayar', AYAR_LEGACY_CODE_PAGE],
  ['wininnwa', WININNWA_LEGACY_CODE_PAGE],
]);























export const UNICODE_PATH = 'unicode';








export const ZawCODE_PATH = 'zawcode';


// FILE: codepage/codepage-subset.js
/*
(Support 34) Shared support, no chain position - known subset-font profiles.
This module holds per-resource profiles of specific subsetted legacy fonts and builds the bridge that decodes them; a program hash alone is never trusted.
*/
import { AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE } from "./codepage-registry.js";

// These are the original simple-font resources, not keyboard layouts or
// family-wide PDF-byte maps. A program hash alone is insufficient: a PDF can
// reuse the same font with a different encoding or ToUnicode bridge.
const PROFILES = new Map([
  ["9b3622c34d21de53fb2a6dacd19e698f05dc46e2d32091ddefe42e23ab7916f2", {
    baseFont: "wininnwa",
    toUnicodeSha256: "fcc371c79280827bc1ef9ab5f9f8f0b4fb6913055cd80e208067b2ccd94950d1",
    firstChar: 0,
    lastChar: 105,
    codePage: WININNWA_LEGACY_CODE_PAGE,
    // These are confirmed PDF codes for this subset, not universal keys.
    // The resource's ToUnicode bridge separately identifies its lower slots.
    rawRuns: {
      bytes: new Map([[0x0e, " "], [0x17, "က"]]),
      runs: [
        { bytes: [0x17, 0x25], text: "က္က" },
        { bytes: [0x07, 0x08], text: "ဒ္ဒ" },
        { bytes: [0x0B, 0x5C], text: "တ္တ" },
        { bytes: [0x2B, 0x5F], text: "န္တ" },
      ],
      // The lower glyphs now have source-supported legacy-slot mappings;
      // reading them is not restricted to the previously recorded heads.
      unresolved: new Set(),
    },
  }],
  ["31e1447e813a2b15bee4bc4b1be515764554378cfd254ee45d9f9c0a7eda686b", {
    baseFont: "wininnwa",
    toUnicodeSha256: "b27b2c3cbb7d4bfd83766079109b5f52cd7ed0faef761c13d63e10ac74885099",
    firstChar: 0,
    lastChar: 113,
    codePage: WININNWA_LEGACY_CODE_PAGE,
    rawRuns: {
      // This resource's 12 is its PDF-local space. Raw 23 2F is the
      // observed က္က pair, not a universal keyboard byte sequence.
      bytes: new Map([[0x07, "ဒ"], [0x08, "္ဒ"], [0x12, " "]]),
      runs: [
        { bytes: [0x06, 0x07, 0x08, 0x09], text: "သဒ္ဒါ" },
        { bytes: [0x07, 0x08], text: "ဒ္ဒ" },
        { bytes: [0x0B, 0x64], text: "တ္တ" },
        { bytes: [0x1D, 0x6C], text: "န္တ" },
        // The same 30 glyph occurs in ဥက္ကဋ္ဌ (p2) and ပါဠိ (pp6/10).
        // Keep both interpretations tied to the observed full contexts.
        { bytes: [0x2E, 0x23, 0x2F, 0x30], text: "ဥက္ကဋ္ဌ" },
        { bytes: [0x16, 0x09, 0x30, 0x1E], text: "ပါဠိ" },
        { bytes: [0x23, 0x2F], text: "က္က" },
      ],
      // Raw 30 remains ambiguous, unlike the now-mapped lower consonants.
      unresolved: new Set([0x30]),
    },
  }],
  // These resources were compared with their rendered pages. They use the
  // existing Ayar converter via their own ToUnicode maps, not new raw-code
  // mappings or a family-wide assumption. Other subsets keep the default.
  ["3e4ded8b484ebbee99b171f838c34feccab7b5d64d80c6be8d7762bc62decf5b", {
    baseFont: "amyanmar",
    toUnicodeSha256: "991906b6fc159d60b1254dc471bce6070cbe1196e6155ef199246354a35f3cbc",
    firstChar: 33,
    lastChar: 48,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["d194872a20d4ff557d6d1ce4b56aa627e97337fa933b87a3f0493245b8158d4f", {
    baseFont: "amyanmar",
    toUnicodeSha256: "1230aca5e1bcb1edcc0651d729ad8cce5b8d110a55af081ffa4c181a849e22e5",
    firstChar: 33,
    lastChar: 46,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["e612eea60822c6ff2f54bedc7c796f33c83ddc3065e43295f854545a9190086e", {
    baseFont: "amyanmar",
    toUnicodeSha256: "4fcdfa9ad74dd85730e10c7332af6f4b3f475e340e39d7fcca2cf2ecf33382b0",
    firstChar: 33,
    lastChar: 48,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["e0dbbbdae4992916c9dd8e169daa3d9ff0b4af3ac5e49cb0c44ba5485693260c", {
    baseFont: "amyanmar",
    toUnicodeSha256: "049014f73488443d0a1943aaf9866389ab77f6d7789fae5742ceaf5984e47ac0",
    firstChar: 33,
    lastChar: 45,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["5ae40cd07325483a2ccf011f583c185d330ca0eeb6b5119730a8f9bb198ba39d", {
    baseFont: "amyanmar",
    toUnicodeSha256: "1e641816e4a556944bfb864061626c83fd65867aa8529a937c005a9a452b0847",
    firstChar: 33,
    lastChar: 149,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  // Further source-local Amyanmar comparisons: /TT8 p9 and /TT51 p283
  // have readable examples; /TT22's three used marks have the same outlines
  // and ToUnicode values as /TT15; /TT43 p216 supplies punctuation/space.
  ["f07054869cfd47522501716cd5a97fcede7d94ca168982dc30981058f440f4b4", {
    baseFont: "amyanmar",
    toUnicodeSha256: "39fe8ed4cffddedd1338a1538a6f2bde0b4103998e6a0bc696919a1984bc9fe8",
    firstChar: 33, lastChar: 45,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["8e1de260b78eda0c3e730fc00c66ee74d381517af765694bbf6b2de29bb6bf43", {
    baseFont: "amyanmar",
    toUnicodeSha256: "563a7c218778c50a904ef003f890da446bbf4be68e2c26899d6e5c41307f6df2",
    firstChar: 33, lastChar: 35,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["ecc7f1b3201510172ba28dfc97a17104fc71d1aa014b86d0b071fd6083df7ce7", {
    baseFont: "amyanmar",
    toUnicodeSha256: "e0946e0e279e40d027a2cbb1313235f04718d88c86534064205fdcedf88446f2",
    firstChar: 33, lastChar: 36,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["5820563de6a3ea2720f9c754563b47b302d63606b937ab64e37f189a4f3b8264", {
    baseFont: "amyanmar",
    toUnicodeSha256: "355abfd8e2b45b5e4bfeff0db1191c5f7e057bac775760f85c09ebcf6666d848",
    firstChar: 33, lastChar: 90,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["4d6aa345dd1b88e650c0b700cd51b336bf0d0ba7016b559ca9f5f562b1ab46ea", {
    baseFont: "arlarwade",
    toUnicodeSha256: "f598de0e4a176739e8e3c447480bd322fd0b01a4c80fb1d97b7bffd1750b27c1",
    firstChar: 33,
    lastChar: 140,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["ab7518c9f0347ee639244fe89fce37115fb9f4fd0fa5b7b065c08ff104bb4c25", {
    baseFont: "arlarwade",
    toUnicodeSha256: "bd52660177ecf1c893d399c2337ce2b22f6da146495d0c00762209d03a7dfca3",
    firstChar: 33,
    lastChar: 160,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["f7e6dc277e5783f5dfbddc1b023ed3bf98e0a0ab60a17d1a446c6c143c29d924", {
    baseFont: "arlarwade",
    toUnicodeSha256: "08e548c15cf5bb59ce17f8187aca6f79e95b9281c3788322a03be8d7c01bf5ff",
    firstChar: 33,
    lastChar: 129,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["3a59ab947871b19d1eaaebc827995f2eb13177771af040c03436e5425392350f", {
    baseFont: "arlarwade",
    toUnicodeSha256: "c02bbe18522c2beb049b59bdd629a2e7de7eaace2cc7a0688b67f01dec39c184",
    firstChar: 33,
    lastChar: 121,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  // Further source-local comparisons against the rendered grammar pages:
  // /TT6 p9, /TT20 p112, /TT59 p412 and /TT62 p417. The table outputs
  // still need their usual contextual and Unicode-order handling.
  ["164ab2dc98515900ba126fe7043f0fa455ed0472f32a68fbce5d41a6565584fb", {
    baseFont: "arlarwade",
    toUnicodeSha256: "e79d2648ec9c0f7d7c232c7688a001cf7d7a996a44073bf45368717eb03035be",
    firstChar: 33, lastChar: 140,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["4c50ba818d91e8762ea8217586e7a2440747c464b433964e49e3af5dee970db6", {
    baseFont: "arlarwade",
    toUnicodeSha256: "c85288ebecad12b06e1b601eb42891225eb9339359b9f89a978f94fc08d9484c",
    firstChar: 33, lastChar: 101,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["b353b9e2e602b1a65ec182154e49d8d71d9ec9d613718f0dbf01ba02918b4a55", {
    baseFont: "arlarwade",
    toUnicodeSha256: "d2924887b20e94564271618032bd9772d2e941618ac12897a1d9133547b191f3",
    firstChar: 33, lastChar: 96,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["286c99574ea17ff9806328746e5d56fa4f3399863d44978413ba5ffc458eed59", {
    baseFont: "arlarwade",
    toUnicodeSha256: "fca550553495f3d7c95b4add9618b72475b2929242680fddb9fd72ec9ac961e7",
    firstChar: 33, lastChar: 130,
    codePage: AYAR_LEGACY_CODE_PAGE, rawRuns: null,
  }],
  ["b89b5fe3daba90ad860720610d39142ea965ac5a83ce889084c6c75afa9858e3", {
    baseFont: "arlarwade",
    toUnicodeSha256: "28f39c1845d59dbe3cab976efbcbf32a790916ba2a3f3200686d521397177f2a",
    firstChar: 33,
    lastChar: 142,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["a7c9e0380ddaa992b8544130db21696438cbe6ec1b0afd8f262c9fc699623437", {
    baseFont: "arlarwade",
    toUnicodeSha256: "c155b0d0b2f4c55d5bdaa686e9c7b0f4a40e49cc349510a4e6e40d405438cc9b",
    firstChar: 33,
    lastChar: 136,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
  ["3da8a08e4a4bf0a6629f4efa1e5c0af7ce1d1349edf6580e2c74a33b56eea0ec", {
    baseFont: "arlarwade",
    toUnicodeSha256: "59ec84bfabcd4c3db31921b81e989e54587a3357d426c8e97a313fda29c9ebf3",
    firstChar: 33,
    lastChar: 146,
    codePage: AYAR_LEGACY_CODE_PAGE,
    rawRuns: null,
  }],
]);

export function subsetFontBridge({ fontSha256, toUnicodeSha256, baseFont, firstChar, lastChar, hasEncoding }) {
  const profile = PROFILES.get(fontSha256);
  if (!profile || hasEncoding || profile.toUnicodeSha256 !== toUnicodeSha256
      || profile.baseFont !== baseFont || profile.firstChar !== firstChar || profile.lastChar !== lastChar) return null;
  const names = { wininnwa: "WinInnwa", arlarwade: "Arlarwade", amyanmar: "Amyanmar" };
  return {
    ...profile,
    fontFamily: names[profile.baseFont] || profile.baseFont,
    // This is the table used for this matched resource, not a statement that
    // all fonts sharing its family name use the same encoding.
    layoutTable: profile.codePage === AYAR_LEGACY_CODE_PAGE ? "ayar" : "wininnwa",
  };
}


// FILE: codepage/codepage-visual.js
/*
(Support 33) Shared support, no chain position - visual Unicode glyph matching.
This module matches a font's glyphs against visual-Unicode evidence to decode fonts whose text is stored as visual-order glyph runs.
*/
import { createHash } from "node:crypto";
import evidence from "../jason-map/visual-unicode-glyph-evidence.json" with { type: "json" };
import { ttfTables } from "./cmap.js";

const PREFIX_MARKS = new Set(["ေ", "ြ"]);
const MARK_TEXT = { e: "ေ", ra: "ြ", raWa: "ြွ", ya: "ျ", wa: "ွ", kinzi: "င်္" };
const isConsonant = (cp) => cp >= 0x1000 && cp <= 0x1021;
const isBase = (cp) => isConsonant(cp) || (cp >= 0x1023 && cp <= 0x1027)
  || cp === 0x1029 || cp === 0x102a || cp === 0x103f || cp === 0x104e;

// These conflicts are independent of the witness outlines: a direct cmap
// says a glyph is a consonant, but this PDF maps its code to a prefix mark,
// or its ToUnicode is already known to contain many contradictory spaces.
export function hasVisualUnicodeConflicts(decoder) {
  if (!decoder?.isCid || !decoder.toUnicode || !decoder.ownGids?.direct?.size) return false;
  const contradictions = new Set();
  const groups = decoder.toUnicode.byWidth || new Map([[2, decoder.toUnicode]]);
  for (const [width, entries] of groups) {
    for (const [code, text] of entries) {
      if (!PREFIX_MARKS.has(text) && !(decoder._conflictingSpaceMap && text === " ")) continue;
      const cid = decoder.cmap.cidFor(code, width);
      const gid = decoder.gidFor(cid);
      const cp = decoder.ownGids.direct.get(gid);
      if (isConsonant(cp)) contradictions.add(gid);
    }
  }
  return contradictions.size >= 2;
}

function simpleGlyphDigests(data) {
  if (!Buffer.isBuffer(data)) return null;
  const tables = ttfTables(data);
  const table = (name, min) => {
    const entry = tables.get(name);
    if (!entry || entry[1] < min || entry[0] > data.length || entry[1] > data.length - entry[0]) return null;
    return entry;
  };
  const head = table("head", 54);
  const maxp = table("maxp", 6);
  const loca = table("loca", 4);
  const glyf = table("glyf", 0);
  if (!head || !maxp || !loca || !glyf) return null;
  const format = data.readInt16BE(head[0] + 50);
  const count = data.readUInt16BE(maxp[0] + 4);
  if (![0, 1].includes(format) || loca[1] < (count + 1) * (format ? 4 : 2)) return null;
  const memo = new Map();
  const offset = (i) => format
    ? data.readUInt32BE(loca[0] + i * 4) : data.readUInt16BE(loca[0] + i * 2) * 2;
  return (gid) => {
    if (!Number.isInteger(gid) || gid < 0 || gid >= count) return null;
    if (memo.has(gid)) return memo.get(gid);
    const start = offset(gid);
    const end = offset(gid + 1);
    let hash = null;
    if (start <= end && end <= glyf[1] && end - start >= 10) {
      const bytes = data.subarray(glyf[0] + start, glyf[0] + end);
      // Empty and composite glyphs cannot be compared this way.
      if (bytes.readInt16BE(0) > 0) hash = createHash("sha256").update(bytes).digest("hex");
    }
    memo.set(gid, hash);
    return hash;
  };
}

// The full layout fonts are witnesses for glyph roles, not keyboard profiles.
// Require several matching direct-cmap consonants AND independent /ToUnicode
// contradictions. Names, subset hashes and PDF-local GIDs do not select a lane.
export function matchVisualUnicodeGlyphs(decoder, fontProgram) {
  if (!hasVisualUnicodeConflicts(decoder)) return null;
  const digest = simpleGlyphDigests(fontProgram);
  if (!digest) return null;
  const gidByCodepoint = new Map();
  for (const [gid, cp] of decoder.ownGids.direct) gidByCodepoint.set(cp, gid);
  const matching = [];
  for (const witness of evidence.witnesses) {
    let compared = 0;
    let agreed = 0;
    for (const [hex, expected] of Object.entries(witness.anchors)) {
      const gid = gidByCodepoint.get(Number(hex));
      const actual = digest(gid);
      if (!actual) continue;
      compared += 1;
      if (actual === expected) agreed += 1;
    }
    if (compared >= 8 && agreed === compared) matching.push(witness);
  }
  if (matching.length !== 1) return null;
  const roles = new Map();
  roles.baseConflicts = matching[0].baseConflicts || {};
  const groups = decoder.toUnicode.byWidth || new Map([[2, decoder.toUnicode]]);
  for (const [width, entries] of groups) {
    for (const [code] of entries) {
      const gid = decoder.gidFor(decoder.cmap.cidFor(code, width));
      const glyphDigest = digest(gid);
      const role = matching[0].marks[glyphDigest];
      const suffix = matching[0].clusterSuffixes?.[glyphDigest];
      if (role || suffix) roles.set(gid, {
        role, suffix,
        yaPlusEConflict: matching[0].yaPlusEConflict === true,
        spaceMappedMark: matching[0].spaceMarkRoles?.includes(role) === true,
      });
    }
  }
  return roles.size ? roles : null;
}

function tokensFor(decoder, parts) {
  const tokens = [];
  for (const data of parts) {
    for (const [code, cid, width, invalid] of decoder.cmap.iterCodes(data)) {
      const old = invalid ? null : decoder.decodeCode(code, cid, width);
      const original = old ?? `[${code.toString(16).toUpperCase().padStart(width * 2, "0")}]`;
      if (invalid) { tokens.push({ original }); continue; }
      const gid = decoder.gidFor(cid);
      const witness = decoder.visualUnicodeGlyphs.get(gid);
      const role = witness?.role;
      const scalar = [...original].length === 1 && /[\u1000-\u109f]/u.test(original);
      // Some witnessed resources map the ya glyph to ya+e. Preserve that
      // multi-output unless this cluster also draws a separate e glyph.
      const yaPlusE = role === "ya" && witness.yaPlusEConflict && original === "ျေ";
      // When this resource's space-dominated map has already been rejected,
      // the existing cmap fallback can return an empty string for a visible
      // mark. Retain that glyph only if its full-font outline was witnessed.
      const missingMark = role && decoder._conflictingSpaceMap && original === ""
        && decoder._toUnicodeForCode(decoder.toUnicode, code, width) === " ";
      // Witnessed ra and ra+wa glyphs can also be mapped to a space. Treat
      // them as marks only when the following glyph completes a visual cluster.
      const spaceMappedMark = ["ra", "raWa"].includes(role) && witness.spaceMappedMark && original === " ";
      if (role && (scalar || yaPlusE || missingMark || spaceMappedMark)) {
        tokens.push({ role, original, text: MARK_TEXT[role], missingMark, yaPlusE });
        continue;
      }
      const cp = decoder.ownGids.direct?.get(gid);
      if (isBase(cp)) {
        const direct = String.fromCodePoint(cp);
        const witnessedConflict = decoder.visualUnicodeGlyphs.baseConflicts?.[direct]?.includes(original);
        if (original === direct || (isConsonant(cp) && (PREFIX_MARKS.has(original) || witnessedConflict))) {
          tokens.push({ role: "base", original, text: direct,
            multiConflict: witnessedConflict && [...original].length > 1 });
          continue;
        }
      }
      // A suffix can prove the end of a specific source-witnessed cluster,
      // but it must already decode to the exact text the full font shaped.
      tokens.push({ original, suffix: witness?.suffix === original ? original : null,
        realSpace: [0x20, 0xa0].includes(cp) && /^\s$/u.test(original) });
    }
  }
  return tokens;
}

// A matching suffix is only evidence for the specific shaped clusters below;
// it is not a new mapping for the suffix glyph itself.
const suffixAt = (tokens, index, text) => tokens[index]?.suffix === text;
function hasClearLeftEdge(tokens, baseIndex, startsAtBoundary) {
  if (baseIndex === 0) return startsAtBoundary;
  const previous = tokens[baseIndex - 1];
  return ["base", "ya", "wa"].includes(previous.role) || Boolean(previous.suffix) || previous.realSpace === true;
}

function completedBareBase(tokens, index, startsAtBoundary) {
  if (!hasClearLeftEdge(tokens, index, startsAtBoundary)) return false;
  // Rendered part 2 page 1315: ရက်, ကို and စကား. The suffixes are
  // respectively asat, i+u, or aa+tone; no e or ra is drawn in those clusters.
  return suffixAt(tokens, index + 1, "်")
    || (suffixAt(tokens, index + 1, "ိ") && suffixAt(tokens, index + 2, "ု"))
    || (suffixAt(tokens, index + 1, "ာ") && suffixAt(tokens, index + 2, "း"));
}

function completedBareYa(tokens, index, startsAtBoundary) {
  const baseIndex = index - 1;
  if (tokens[baseIndex]?.role !== "base" || !hasClearLeftEdge(tokens, baseIndex, startsAtBoundary)) return false;
  // Rendered part 2 pages 252/341/1315: များ, မျိုး, ချက် and ချုပ်.
  // A witnessed final base+asat or a vowel/tone pair closes the cluster.
  return (suffixAt(tokens, index + 1, "ာ") && suffixAt(tokens, index + 2, "း"))
    || (suffixAt(tokens, index + 1, "ိ") && suffixAt(tokens, index + 2, "ု")
      && suffixAt(tokens, index + 3, "း"))
    || (tokens[index + 1]?.role === "base" && suffixAt(tokens, index + 2, "်"))
    || (suffixAt(tokens, index + 1, "ု") && tokens[index + 2]?.role === "base"
      && suffixAt(tokens, index + 3, "်"));
}

// Reconstruct only marks whose own glyphs and cluster boundaries were
// witnessed. Untagged Unicode text is never rearranged.
export function decodeVisualUnicodeRun(decoder, parts, { onUnresolved = null, startsAtBoundary = false } = {}) {
  const tokens = tokensFor(decoder, parts);
  for (let i = 1; i < tokens.length; i += 1) {
    if (tokens[i].role === "kinzi" && tokens[i - 1].role === "base" && !tokens[i - 1].multiConflict) {
      [tokens[i - 1], tokens[i]] = [tokens[i], tokens[i - 1]];
      tokens[i - 1].confirmed = true;
    }
  }
  let output = "";
  for (let i = 0; i < tokens.length;) {
    let j = i;
    const e = tokens[j]?.role === "e";
    if (e) j += 1;
    const raRole = ["ra", "raWa"].includes(tokens[j]?.role) ? tokens[j++].role : "";
    const ra = MARK_TEXT[raRole] || "";
    const kinzi = tokens[j]?.role === "kinzi" && tokens[j].confirmed ? tokens[j++].text : "";
    if ((e || ra) && tokens[j]?.role === "base") {
      const base = tokens[j++];
      let tail = "";
      let yaPlusE = 0;
      while (j < tokens.length && (["ya", "wa"].includes(tokens[j].role)
          || (!tokens[j].role && /^(?:ွ|ှ|ျှ|ွှ)$/u.test(tokens[j].original)))) {
        tail += tokens[j].text ?? tokens[j].original;
        if (tokens[j].yaPlusE) yaPlusE += 1;
        j += 1;
      }
      // Part 2 page 1315 also witnesses ကျော်, ကြီး, ကော် and ကောက်.
      // Their extra prefix marks are absent, not taken from conflicting mappings.
      const witnessedYaBase = base.original === "ြွေ" && e && !ra && yaPlusE === 1
        && tail === "ျ" && suffixAt(tokens, j, "ာ") && suffixAt(tokens, j + 1, "်");
      const witnessedRaBase = base.original === "ြွေ" && !e && raRole === "ra" && !tail
        && suffixAt(tokens, j, "ီ") && suffixAt(tokens, j + 1, "း");
      const witnessedEBase = base.original === "ြွေ" && e && !ra && !tail
        && suffixAt(tokens, j, "ာ") && (suffixAt(tokens, j + 1, "်")
          || (tokens[j + 1]?.role === "base" && suffixAt(tokens, j + 2, "်")));
      const baseComplete = !base.multiConflict || (base.original === "ြွေ" && e && raRole === "raWa")
        || witnessedYaBase || witnessedRaBase || witnessedEBase;
      const yaComplete = !yaPlusE || (yaPlusE === 1 && e && (!base.multiConflict || witnessedYaBase));
      if (baseComplete && yaComplete && !(ra && tail.includes("ျ"))) {
        output += kinzi + base.text + ra + tail + (e ? "ေ" : "");
        i = j;
        continue;
      }
    }
    const token = tokens[i];
    const followsBase = tokens[i - 1]?.role === "base" || (token.role === "wa"
      && tokens[i - 1]?.role === "ya" && tokens[i - 2]?.role === "base");
    const bareBase = token.multiConflict && token.original === "ြွေ"
      && completedBareBase(tokens, i, startsAtBoundary);
    const bareYa = token.yaPlusE && completedBareYa(tokens, i, startsAtBoundary);
    if ((token.multiConflict && !bareBase) || (token.yaPlusE && !bareYa)) onUnresolved?.();
    if ((token.role === "base" && (!token.multiConflict || bareBase)) || (token.role === "kinzi" && token.confirmed)
        || (["ya", "wa"].includes(token.role) && followsBase && (!token.yaPlusE || bareYa))
        || token.missingMark) output += token.text;
    else output += token.original;
    i += 1;
  }
  return output;
}


// FILE: codepage/fonts.js
/*
(Support 37) Shared support, no chain position - the output font registry.
This module lists the Burmese fonts available for writing output documents (PDF 32) and classifies text lines into font roles.
*/
import path from "node:path";
import fs from "node:fs";
import { OUTPUT_FONT_DIR } from "../../_path.js";
import { pyLen } from "../pylib.js";

export const ANONYMOUS_PRO_FILES = {
  "": path.join(OUTPUT_FONT_DIR, "AnonymousPro-Regular.ttf"),
  B: path.join(OUTPUT_FONT_DIR, "AnonymousPro-Bold.ttf"),
  I: path.join(OUTPUT_FONT_DIR, "AnonymousPro-Italic.ttf"),
  BI: path.join(OUTPUT_FONT_DIR, "AnonymousPro-BoldItalic.ttf"),
};





export const BURMESE_FONTS = {
  MyanmarSagar: {
    files: { "": "MyanmarSagar.ttf" },
    docx: "Myanmar Sagar",
  },
};

export const DEFAULT_BURMESE_KEY = "MyanmarSagar";
export const FONT_ROLES = {
  title: {
    english_style: "B", burmese: DEFAULT_BURMESE_KEY,
    bold: true, size: 14, char_spacing: 0.2, line_spacing: 1.4,
    color: [40, 40, 40], align: "L",
  },
  heading: {
    english_style: "B", burmese: DEFAULT_BURMESE_KEY,
    bold: true, size: 12, char_spacing: 0.15, line_spacing: 1.5,
    color: [60, 60, 60], align: "L",
  },
  paragraph: {
    english_style: "", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 11, char_spacing: 0.35, line_spacing: 1.7,
    color: [0, 0, 0], align: "L",
  },
  bold: {
    english_style: "B", burmese: DEFAULT_BURMESE_KEY, bold: true,
    size: 11, char_spacing: 0.3, line_spacing: 1.7,
    color: [0, 0, 0], align: "L",
  },
  italic: {
    english_style: "I", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 11, char_spacing: 0.3, line_spacing: 1.7,
    color: [0, 0, 0], align: "L",
  },
  page_number: {
    english_style: "", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 9, char_spacing: 0.2, line_spacing: 1.4,
    color: [120, 120, 120], align: "C",
  },
  meta: {
    english_style: "", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 8, char_spacing: 0.15, line_spacing: 1.4,
    color: [100, 100, 100], align: "L",
  },
};

const PAGE_MARKER_RE = /^\s*---\s*Page\s+\d+\s*---\s*$/;
const TRAILING_PUNCT_RE = /[.!?\u104a\u104b,;:]+$/;


export function classifyTextRole(line, prevBlank = true) {
  const s = String(line).trim();
  if (!s) return "blank";
  if (PAGE_MARKER_RE.test(s)) return "page_number";
  const noPunct = !TRAILING_PUNCT_RE.test(s);
  const len = pyLen(s); 
  if (prevBlank && len >= 2 && len <= 60 && noPunct) return "heading";
  return "paragraph";
}

export function burmeseFontKey(role) {
  void role;
  return DEFAULT_BURMESE_KEY;
}


export function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}


export function registerPdfFonts(pdf) {
  for (const [style, file] of Object.entries(ANONYMOUS_PRO_FILES)) {
    if (isFile(file)) pdf.addFont("AnonymousPro", style, file);
  }
  for (const [key, spec] of Object.entries(BURMESE_FONTS)) {
    for (const [style, fname] of Object.entries(spec.files)) {
      const file = path.join(OUTPUT_FONT_DIR, fname);
      if (isFile(file)) pdf.addFont(key, style, file);
    }
  }
}

export function applyPdfRole(pdf, role, useEnglish = true) {
  const cfg = FONT_ROLES[role];
  if (useEnglish) pdf.setFont("AnonymousPro", cfg.english_style, cfg.size);
  else pdf.setFont(DEFAULT_BURMESE_KEY, "", cfg.size);
  pdf.setFallbackFonts([DEFAULT_BURMESE_KEY]);
  pdf.setCharSpacing(cfg.char_spacing);
  if (cfg.color) pdf.setTextColor(...cfg.color);
}


// FILE: codepage/ttf-gsub.js
/*
(Support 32) Shared support, no chain position - TrueType GSUB parsing.
This module parses a font's GSUB table for reverse-chaining and variant-slot information used to understand legacy font glyph substitution.
*/
import { ttfTables } from "./cmap.js";

































const u16 = (d, o) => (o + 2 <= d.length ? d.readUInt16BE(o) : 0);
const i16 = (d, o) => (o + 2 <= d.length ? d.readInt16BE(o) : 0);
const u32 = (d, o) => (o + 4 <= d.length ? d.readUInt32BE(o) : 0);


function coverage(d, off) {
  const out = [];
  const fmt = u16(d, off);
  if (fmt === 1) {
    const count = u16(d, off + 2);
    for (let i = 0; i < count; i += 1) {
      const at = off + 4 + i * 2;
      if (at + 2 > d.length) break;
      out.push(u16(d, at));
    }
  } else if (fmt === 2) {
    const count = u16(d, off + 2);
    for (let i = 0; i < count; i += 1) {
      const at = off + 4 + i * 6;
      if (at + 6 > d.length) break;
      const start = u16(d, at);
      const end = u16(d, at + 2);
      for (let g = start; g <= end && g <= 0xffff; g += 1) out.push(g);
    }
  }
  return out;
}








const MAX_STEPS = 2_000_000;

export function parseTtfGsubReverse(data) {
  const out = new Map();
  let budget = MAX_STEPS;
  const spend = (n) => { budget -= n; return budget > 0; };
  if (!data || data.length < 12) return out;

  const tables = ttfTables(data);







  if (!tables.has("GSUB")) return out;
  const d = data;
  const gsubOff = tables.get("GSUB")[0];
  if (gsubOff + 10 > d.length) return out;
  const version = u32(d, gsubOff);
  if (version !== 0x00010000 && version !== 0x00010001) return out;

  const lookupList = gsubOff + u16(d, gsubOff + 8);
  const lookupCount = u16(d, lookupList);
  const singles = new Map();

  for (let i = 0; i < lookupCount; i += 1) {
    if (!spend(1)) break;
    const lo = lookupList + u16(d, lookupList + 2 + i * 2);
    if (lo + 6 > d.length) break;
    let lookupType = u16(d, lo);
    const subCount = u16(d, lo + 4);
    for (let s = 0; s < subCount; s += 1) {
      if (!spend(1)) break;
      let so = lo + u16(d, lo + 6 + s * 2);
      let type = lookupType;

      if (lookupType === 7) {
        if (so + 8 > d.length) continue;
        type = u16(d, so + 2);
        so += u32(d, so + 4);
      }
      if (so + 6 > d.length) continue;

      if (type === 1) {


        const fmt = u16(d, so);
        const cov = coverage(d, so + u16(d, so + 2));
        if (!spend(cov.length)) break;
        if (fmt === 1) {
          const delta = i16(d, so + 4);
          for (const gi of cov) {
            const outG = (gi + delta) & 0xffff;
            if (outG !== gi && !singles.has(outG)) singles.set(outG, gi);
          }
        } else if (fmt === 2) {
          const count = u16(d, so + 4);
          for (let k = 0; k < count && k < cov.length; k += 1) {
            const outG = u16(d, so + 6 + k * 2);
            if (outG !== cov[k] && !singles.has(outG)) singles.set(outG, cov[k]);
          }
        }
      } else if (type === 4) {




        const cov = coverage(d, so + u16(d, so + 2));
        const setCount = u16(d, so + 4);





        const sets = Math.min(cov.length, setCount);
        if (!spend(sets)) break;
        for (let k = 0; k < sets; k += 1) {
          const first = cov[k];
          if (!first) continue;
          const lso = so + u16(d, so + 6 + k * 2);
          if (lso + 2 > d.length) break;
          const ligCount = u16(d, lso);
          if (!spend(ligCount)) break;
          for (let l = 0; l < ligCount; l += 1) {
            const lig = lso + u16(d, lso + 2 + l * 2);
            if (lig + 4 > d.length) break;
            const outG = u16(d, lig);
            const compCount = u16(d, lig + 2);
            if (!outG || outG === first || singles.has(outG) || out.has(outG)) continue;
            const comps = [cov[k]];
            let bad = false;
            for (let c = 1; c < compCount; c += 1) {
              const at = lig + 2 + c * 2;
              if (at + 2 > d.length) { bad = true; break; }
              const g = u16(d, at);
              if (!g || g === outG) { bad = true; break; }
              comps.push(g);
            }
            if (!bad) out.set(outG, comps);
          }
        }
      }




    }
  }

  for (const [outG, inG] of singles) if (!out.has(outG)) out.set(outG, [inG]);
  return out;
}




























export function parseTtfVariantSlots(data) {
  const groups = new Map();
  if (!data || data.length < 12) return [];
  let budget = MAX_STEPS;

  const tables = ttfTables(data);
  if (!tables.has("GSUB")) return [];
  const gsubOff = tables.get("GSUB")[0];
  if (gsubOff + 10 > data.length) return [];
  const version = u32(data, gsubOff);
  if (version !== 0x00010000 && version !== 0x00010001) return [];

  const d = data;
  const lookupList = gsubOff + u16(d, gsubOff + 8);
  const lookupCount = u16(d, lookupList);
  const sequences = [];

  for (let i = 0; i < lookupCount; i += 1) {
    if (budget <= 0) break;
    const lo = lookupList + u16(d, lookupList + 2 + i * 2);
    if (lo + 6 > d.length) break;
    let lookupType = u16(d, lo);
    const subCount = u16(d, lo + 4);
    for (let s = 0; s < subCount; s += 1) {
      budget -= 1;
      if (budget <= 0) break;
      let so = lo + u16(d, lo + 6 + s * 2);
      if (lookupType === 7) {
        if (so + 8 > d.length) continue;
        so += u32(d, so + 4);
        if (u16(d, so) !== 2) continue;
      } else if (lookupType !== 2) {
        continue;
      }
      if (u16(d, so) !== 1) continue;
      const cov = coverage(d, so + u16(d, so + 2));
      const count = u16(d, so + 4);
      for (let k = 0; k < count && k < cov.length; k += 1) {
        const sqo = so + u16(d, so + 6 + k * 2);
        if (sqo + 2 > d.length) break;
        const glyphCount = u16(d, sqo);
        budget -= glyphCount;
        if (budget <= 0) break;
        if (sqo + 2 + glyphCount * 2 > d.length) continue;
        const members = [];
        for (let q = 0; q < glyphCount; q += 1) members.push(u16(d, sqo + 2 + q * 2));
        const base = cov[k];
        const baseAt = members.indexOf(base);
        if (baseAt === -1 || members.length < 2) continue;
        sequences.push({ members, baseAt });
      }
    }
  }







  const together = new Set();
  for (const { members, baseAt } of sequences) {
    for (let i = 0; i < members.length; i += 1) {
      if (i === baseAt) continue;
      for (let j = i + 1; j < members.length; j += 1) {
        if (j === baseAt) continue;
        const a = members[i];
        const b = members[j];
        if (a && b) together.add(a < b ? `${a},${b}` : `${b},${a}`);
      }
    }
  }



  for (const { members, baseAt } of sequences) {
    for (let p = 0; p < members.length; p += 1) {
      if (p === baseAt) continue;
      const gid = members[p];
      if (!gid) continue;
      const key = `${members.length}:${baseAt}:${p}:`
        + members.map((g, i) => (i === p ? "*" : String(g))).join(",");
      let set = groups.get(key);
      if (set === undefined) { set = new Set(); groups.set(key, set); }
      set.add(gid);
    }
  }

  const out = [];
  for (const set of groups.values()) {
    const members = [...set];
    if (members.length < 2) continue;
    let split = false;
    for (let i = 0; i < members.length && !split; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const a = members[i];
        const b = members[j];
        if (together.has(a < b ? `${a},${b}` : `${b},${a}`)) { split = true; break; }
      }
    }
    if (!split) out.push(members);
  }
  return out;
}


// FILE: codepage/ttf.js
/*
(Support 30) Shared support, no chain position - a small TrueType font reader.
This module loads a TTF file, exposes its tables and cmap, and answers glyph lookups for the font tools.
*/
import fs from "node:fs";
import { parseTtfCmap } from "./cmap.js";

function readTableDirectory(data) {
  const numTables = data.readUInt16BE(4);
  const tables = new Map();
  let off = 12;
  for (let i = 0; i < numTables; i += 1) {
    if (off + 16 > data.length) break;
    const tag = data.toString("latin1", off, off + 4);
    tables.set(tag, { offset: data.readUInt32BE(off + 8), length: data.readUInt32BE(off + 12) });
    off += 16;
  }
  return tables;
}

export class TtfFont {



  constructor(source) {
    const isBytes = Buffer.isBuffer(source) || source instanceof Uint8Array;
    this.path = isBytes ? "<embedded>" : source;
    this.data = isBytes ? Buffer.from(source) : fs.readFileSync(source);
    const tables = readTableDirectory(this.data);
    this.tables = tables;

    const head = tables.get("head");
    if (!head) throw new Error(`${this.path} is not a TrueType font (no head table)`);
    this.unitsPerEm = this.data.readUInt16BE(head.offset + 18);
    this.indexToLocFormat = this.data.readInt16BE(head.offset + 50);

    this.bbox = [
      this.data.readInt16BE(head.offset + 36),
      this.data.readInt16BE(head.offset + 38),
      this.data.readInt16BE(head.offset + 40),
      this.data.readInt16BE(head.offset + 42),
    ];

    const hhea = tables.get("hhea");
    this.ascent = hhea ? this.data.readInt16BE(hhea.offset + 4) : this.unitsPerEm;
    this.descent = hhea ? this.data.readInt16BE(hhea.offset + 6) : -this.unitsPerEm;
    this.numberOfHMetrics = hhea ? this.data.readUInt16BE(hhea.offset + 34) : 0;

    const maxp = tables.get("maxp");
    this.numGlyphs = maxp ? this.data.readUInt16BE(maxp.offset + 4) : 0;



    this.advanceWidths = new Uint16Array(this.numGlyphs);
    const hmtx = tables.get("hmtx");
    if (hmtx && this.numGlyphs) {
      let p = hmtx.offset;
      let last = 600;
      for (let g = 0; g < this.numGlyphs; g += 1) {
        if (g < this.numberOfHMetrics) {
          if (p + 2 > this.data.length) break;
          last = this.data.readUInt16BE(p);
          p += 4;
        }
        this.advanceWidths[g] = last;
      }
    }



    this.cmap = parseTtfCmap(this.data);


    this.scale = 1000 / this.unitsPerEm;
    this.cw = new Map();
    for (const [cp, gid] of this.cmap) {
      const w = this.advanceWidths[gid] ?? 0;
      this.cw.set(cp, roundHalfUp(this.scale * (w === 65535 ? 0 : w) + 0.001));
    }

    this.name = sanitizeName(this.path);
    this.usedCps = new Set();
    this.notdefWidth = roundHalfUp(this.scale * (this.advanceWidths[0] ?? 0) + 0.001);
  }
  hasCodepoint(cp) {
    return this.cmap.has(cp);
  }

  glyphId(cp) {
    const gid = this.cmap.get(cp);
    return gid === undefined ? 0 : gid;
  }
  widthOf(cp) {
    const w = this.cw.get(cp);
    return w === undefined ? this.notdefWidth : w;
  }


  textWidthPt(text, sizePt) {
    let total = 0;
    for (const ch of text) total += this.widthOf(ch.codePointAt(0));
    return total * sizePt * 0.001;
  }
}


function roundHalfUp(x) {
  return Math.round(x);
}

function sanitizeName(filePath) {
  const base = filePath.split(/[\\/]/).pop() || "Font";
  return base.replace(/\.ttf$/i, "").replace(/[^A-Za-z0-9-]/g, "");
}

export function loadFont(filePath) {
  return new TtfFont(filePath);
}

// FILE: combine.js
import fs from 'fs';
import path from 'path';
const SRC_DIR = process.argv[2] || "./src"; const OUT_FILE = process.argv[3] || "./bundle.js";
const ROOT = process.cwd(); const SRC_PATH = path.resolve(ROOT, SRC_DIR); const OUT_PATH = path.resolve(ROOT, OUT_FILE);
if (!fs.existsSync(SRC_PATH)) { console.error("ERROR: directory not found:", SRC_PATH); process.exit(1); }
function collectJS(dir) { const out = []; const items = fs.readdirSync(dir, { withFileTypes: true });
for (const item of items) { const full = path.join(dir, item.name);
if (item.isDirectory()) {
out.push(...collectJS(full));
continue;
}
if (item.isFile() && item.name.endsWith(".js")) {
out.push(full);
}
}
return out.sort(); }
const files = collectJS(SRC_PATH);
if (files.length === 0) { console.error("ERROR: no .js files found"); process.exit(1); }
const requireSet = new Set(); const bodies = [];
for (const filePath of files) { const rel = path.relative(SRC_PATH, filePath); const content = fs.readFileSync(filePath, "utf8");
const lines = content.split(/\r?\n/); const body = [];
for (const l of lines) { const line = l.trim();
if (
(line.startsWith("const ") || line.startsWith("let ") || line.startsWith("var ")) &&
line.includes("require(")
) {
requireSet.add(line.replace(/;$/, "") + ";");
continue;
}
body.push(l);
}
bodies.push("// FILE: " + rel + "\n" + body.join("\n")); }
let out = "";
for (const r of requireSet) out += r + "\n";
out += "\n"; out += bodies.join("\n\n");
fs.writeFileSync(OUT_PATH, out, "utf8");

// FILE: decoding/pdf/decoding.js
/*
(PDF 13) PDF branch, position 13 in the chain - after the instructions (PDF 11), before the page text is finished (PDF 19).
This module extracts one page's text lines: it spools the content (PDF 14), runs the font decoders (PDF 16) over the shown strings, tracks positions, and collects the page's images.
*/
import { parseTtfCmap } from "../codepage/cmap.js";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ValueError, pyTruthy, pyInt, fromHexStrict } from "../pylib.js";
import { loadMapJson, mapNameForPath } from "../json-map.js";
import { OWNER_PARSER_WORKER, resourceLimit } from "../limits/local.js";
import { AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE } from "../codepage/codepage-registry.js";
import { containsMyanmar } from "../detect.js";
import { decodeVisualUnicodeRun } from "../codepage/codepage-visual.js";
import {
  Lexer, PdfName, PdfHexBytes, isNumeric, toNumber,
  asDocumentDecoding, DocumentDecoding, FontResourceLoader, LegacyAyarMap, UnsetFontDecoder,
  pageFontDecoders, PDF_PARSING_PATHS,
} from "../pdf/pdf-fonts.js";
import { spoolPageContent } from "../pdf/pdf-content.js";
import { PdfFileLexer } from "../pdf/pdf-lexer.js";
import { PdfPagePieces } from "../pdf/pdf-pages.js";
import { PageImageCollector } from "../pdf/pdf-image-coverage.js";


export const MAX_STREAM_MB = resourceLimit("PRASER_MAX_STREAM_MB", 128, 512);
export const MAX_PDF_OBJECTS = resourceLimit("PRASER_MAX_OBJECTS", 250_000, 10_000_000);


export function zlibDecompressCapped(buf, limitMb = null) {
  const limit = (limitMb === null ? MAX_STREAM_MB : limitMb) * 1024 * 1024;
  if (buf.length === 0) return Buffer.alloc(0);
  try {
    const options = Number.isFinite(limit) ? { maxOutputLength: limit + (1 << 20) } : undefined;
    const out = zlib.inflateSync(buf, options);
    if (out.length > limit) {
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }
    return out;
  } catch (e) {
    if (e instanceof ValueError) throw e;
    if (e && (e.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|buffer too large/i.test(String(e.message)))) {
      if (!Number.isFinite(limit)) throw e;
      throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
    }

    const salvaged = inflateTolerant(buf, limit);
    if (salvaged !== null) return salvaged;
    throw e;
  }
}

function inflateTolerant(buf, limit) {
  const infl = new zlib.Inflate();
  const chunks = [];
  let size = 0;
  let failed = false;
  infl.on("error", () => { failed = true; });
  try {
    infl.write(buf);
    for (const c of infl.read(null)) {
      size += c.length;
      if (size > limit) {
        throw new ValueError(`decompressed stream exceeds ${MAX_STREAM_MB} MB cap (decompression bomb?)`);
      }
      chunks.push(c);
    }
  } catch (e) {
    if (e instanceof ValueError) throw e;

    if (!chunks.length) return null;
  }
  if (failed && !chunks.length) return null;
  if (!chunks.length) return null;
  return Buffer.concat(chunks);
}





const B_STREAM = Buffer.from("stream");
const B_ENDSTREAM = Buffer.from("endstream");
const B_FLAKE = Buffer.from("/FlateDecode");

export function getStream(objects, num, gen = 0) {
  const d = objects.get(`${num},${gen}`);
  if (d === undefined) return null;
  const i = d.indexOf(B_STREAM);
  if (i === -1) return null;
  let j = i + 6;
  if (j < d.length && d[j] === 0x0d) j += 1;
  if (j < d.length && d[j] === 0x0a) j += 1;
  const k = d.lastIndexOf(B_ENDSTREAM);
  if (k === -1) return null;
  const b = d.subarray(j, k);
  if (d.subarray(0, i).includes(B_FLAKE)) {
    try {
      return zlibDecompressCapped(b);
    } catch (e) {
      if (e instanceof ValueError || e?.code === "ERR_BUFFER_TOO_LARGE") throw e;
      return null;
    }
  }
  return b;
}



















export function extractMetadata(objects, raw = null) {
  const infoRef = findInfoRef(objects, raw);
  if (infoRef === null) return {};
  const body = objects.get(infoRef);
  if (body === undefined) return {};
  return parseInfoDict(body.toString("latin1"));
}


function findInfoRef(objects, raw) {
  if (raw) {
    const text = Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw);

    let found = null;
    const re = /trailer[\s\S]{0,2048}?\/Info\s+(\d+)\s+(\d+)\s*R/g;
    let m;
    while ((m = re.exec(text)) !== null) found = `${pyInt(m[1])},${pyInt(m[2])}`;
    if (found !== null) return found;
  }
  for (const [, d] of objects) {
    const dStr = d.toString("latin1");
    if (!/\/Type\s*\/Catalog/.test(dStr)) continue;
    const m = /\/Info\s+(\d+)\s+(\d+)\s*R/.exec(dStr);
    return m ? `${pyInt(m[1])},${pyInt(m[2])}` : null;
  }
  return null;
}


function parseInfoDict(text) {
  const out = {};
  const re = /\/([^\s/[\]<>(){}]+)\s*(?:\(((?:[^\\)]|\\[\s\S])*)\)|<([0-9A-Fa-f\s]*)>)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    const value = m[2] !== undefined ? decodeLiteral(m[2]) : decodeHex(m[3]);
    if (value !== "") out[key] = value;
  }
  return out;
}

const ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" };

function decodeLiteral(body) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    if (body[i] !== "\\") { out += body[i]; continue; }
    const next = body[i + 1];
    if (next === undefined) break;
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) { out += String.fromCharCode(parseInt(octal[0], 8)); i += octal[0].length; continue; }
    if (next === "\n") { i += 1; continue; }
    out += ESCAPES[next] ?? next;
    i += 1;
  }
  return decodeTextString(Buffer.from(out, "latin1"));
}

function decodeHex(body) {
  let hex = (body || "").replace(/\s+/g, "");
  if (hex.length % 2 === 1) hex += "0";
  if (!hex) return "";
  return decodeTextString(Buffer.from(hex, "hex"));
}


function decodeTextString(buf) {
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return buf.subarray(2).swap16().toString("utf16le").replace(/\0+$/u, "");
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return buf.subarray(2).toString("utf16le").replace(/\0+$/u, "");
  }
  return buf.toString("latin1");
}


const FONT_STREAM_RE = /\/FontFile(?:2|3)?\s+(\d+)\s+(\d+)\s+R/g;

export function findFontStreams(objects) {
  const refs = [];
  const seen = new Set();
  for (const d of objects.values()) {
    const dStr = d.toString("latin1");
    FONT_STREAM_RE.lastIndex = 0;
    let m;
    while ((m = FONT_STREAM_RE.exec(dStr)) !== null) {
      const ref = [pyInt(m[1]), pyInt(m[2])];
      const k = ref.join(",");
      if (!seen.has(k)) { seen.add(k); refs.push(ref); }
    }
  }
  return refs;
}

export const findFontFiles2 = findFontStreams;


export function utf16beToStr(hexStr) {



  const padded = hexStr.length % 2 === 0 ? hexStr : `${hexStr}0`;
  return utf16beBytesToStr(fromHexStrict(padded));
}

function utf16beBytesToStr(raw) {
  if (raw.length % 2 !== 0) {
    return swapUtf16BE(raw.subarray(0, raw.length - 1)) + "\uFFFD";
  }
  return swapUtf16BE(raw);
}

function swapUtf16BE(raw) {
  const swapped = Buffer.allocUnsafe(raw.length);
  for (let i = 0; i + 1 < raw.length; i += 2) {
    swapped[i] = raw[i + 1];
    swapped[i + 1] = raw[i];
  }


  const s = swapped.toString("utf16le");
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const lo = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (lo >= 0xdc00 && lo <= 0xdfff) { out += s[i] + s[i + 1]; i += 1; continue; }
      out += "\uFFFD";
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      out += "\uFFFD";
    } else out += s[i];
  }
  return out;
}

const BFCHAR_RE = /beginbfchar([\s\S]*?)endbfchar/g;
const BFCHAR_PAIR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const BFRANGE_RE = /beginbfrange([\s\S]*?)endbfrange/g;
const BFRANGE_SCALAR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const BFRANGE_ARRAY_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g;
const HEX_TOKEN_RE = /<([0-9A-Fa-f]+)>/g;
const BRACKET_SPAN_RE = /\[[\s\S]*?\]/g;




















const CMAP_TOKEN_RE = /<([0-9A-Fa-f]*)>|\[([\s\S]*?)\]/g;

function* cmapTokens(body) {
  CMAP_TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = CMAP_TOKEN_RE.exec(body)) !== null) {
    yield m[1] !== undefined ? { hex: m[1] } : { array: m[2] };
  }
}



const MAX_BFRANGE_CODES = OWNER_PARSER_WORKER ? Infinity : 0x10000;




const MAX_TOUNICODE_ENTRIES = OWNER_PARSER_WORKER ? Infinity : (1 << 20);

function incrementBigEndian(bytes) {
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    if (bytes[i] < 0xff) {
      bytes[i] += 1;
      return true;
    }
    bytes[i] = 0;
  }
  return false;
}

export function parseToUnicodeStream(data) {
  let text;
  try {
    text = data.toString("latin1");
  } catch {
    return new Map();
  }
  const mapping = new Map();
  // The same numeric value can occur at different source widths (<01> and
  // <0001>). Keep them distinct for resource-local PDF decoding.
  mapping.byWidth = new Map();
  mapping.codeSpaces = [];
  const spaces = /begincodespacerange([\s\S]*?)endcodespacerange/g;
  for (const block of text.matchAll(spaces)) {
    for (const match of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const width = match[1].length / 2;
      if (Number.isInteger(width) && width >= 1 && width <= 4 && match[2].length === match[1].length) {
        mapping.codeSpaces.push([width, parseInt(match[1], 16), parseInt(match[2], 16)]);
      }
    }
  }
  const put = (code, value, width) => {
    if (mapping.size >= MAX_TOUNICODE_ENTRIES) return false;
    if (!mapping.byWidth.has(width)) mapping.byWidth.set(width, new Map());
    mapping.byWidth.get(width).set(code, value);
    mapping.set(code, value);
    return true;
  };


  BFCHAR_RE.lastIndex = 0;
  let m;
  while ((m = BFCHAR_RE.exec(text)) !== null) {
    let src = null;
    for (const tok of cmapTokens(m[1])) {
      if (src === null) {
        if (tok.hex && tok.hex.length <= 8 && tok.hex.length % 2 === 0) {
          src = { code: parseInt(tok.hex, 16), width: tok.hex.length / 2 };
        }
        continue;
      }
      if (tok.hex !== undefined && !put(src.code, utf16beToStr(tok.hex), src.width)) return mapping;
      src = null;
    }
  }


  BFRANGE_RE.lastIndex = 0;
  while ((m = BFRANGE_RE.exec(text)) !== null) {
    let lo = null;
    let hi = null;
    let width = null;
    for (const tok of cmapTokens(m[1])) {
      if (lo === null) {
        if (tok.hex && tok.hex.length <= 8 && tok.hex.length % 2 === 0) {
          lo = parseInt(tok.hex, 16);
          width = tok.hex.length / 2;
        }
        continue;
      }
      if (hi === null) {
        if (tok.hex && tok.hex.length === width * 2) hi = parseInt(tok.hex, 16);
        else lo = null;
        continue;
      }
      if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo
          || hi - lo + 1 > MAX_BFRANGE_CODES) {
        lo = null;
        hi = null;
        continue;
      }
      if (tok.array !== undefined) {
        const items = [];
        HEX_TOKEN_RE.lastIndex = 0;
        let q;
        while ((q = HEX_TOKEN_RE.exec(tok.array)) !== null) items.push(q[1]);
        let i = 0;
        for (let code = lo; code <= hi; code += 1, i += 1) {
          if (i >= items.length) break;
          if (!put(code, utf16beToStr(items[i]), width)) return mapping;
        }
      } else {
        if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi < lo
            || hi - lo + 1 > MAX_BFRANGE_CODES) {
          lo = null;
          hi = null;
          continue;
        }






        const raw = tok.hex.length % 2 === 0 ? tok.hex : `${tok.hex}0`;
        const destination = fromHexStrict(raw);
        for (let code = lo; code <= hi; code += 1) {
          if (!put(code, utf16beBytesToStr(destination), width)) return mapping;
          if (code < hi && !incrementBigEndian(destination)) break;
        }
      }
      lo = null;
      hi = null;
    }
  }
  return mapping;
}

const TOUNICODE_RE = /\/ToUnicode\s+(\d+)\s+\d+\s+R/g;


export function findToUnicodeMaps(objects) {
  const codeToUni = new Map();
  const seen = new Set();
  for (const d of objects.values()) {
    const dStr = d.toString("latin1");
    if (!dStr.includes("/ToUnicode")) continue;
    TOUNICODE_RE.lastIndex = 0;
    let m;
    while ((m = TOUNICODE_RE.exec(dStr)) !== null) {
      const tn = pyInt(m[1]);
      if (seen.has(tn)) continue;
      seen.add(tn);
      const s = getStream(objects, tn);
      if (!pyTruthy(s)) continue;
      const mp = parseToUnicodeStream(s);
      if (mp.size === 0) continue;
      let spaces = 0;
      for (const v of mp.values()) if (v === " ") spaces += 1;
      if (spaces / mp.size > 0.9) {
        for (const [k, v] of [...mp]) if (v === " ") mp.delete(k);
      }
      for (const [code, uni] of mp) if (!codeToUni.has(code)) codeToUni.set(code, uni);
    }
  }
  return codeToUni;
}


export function loadSidecarMap(p = null) {
  try {
    const name = p ? mapNameForPath(p) : "cipher-map.json";
    const json = name ? loadMapJson(name) : JSON.parse(fs.readFileSync(p, "utf8"));
    const out = new Map();
    for (const [k, v] of Object.entries(json)) {
      let key = k.trim();
      if (/^0[xX]/.test(key)) key = key.slice(2);
      out.set(Number(BigInt("0x" + key.replace(/_/g, ""))), String(v));
    }
    return out;
  } catch {
    return new Map();
  }
}


const MEDIABOX_RE = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/;
const PARENT_RE = /\/Parent\s+(\d+)\s+(\d+)\s+R/;

function objectDictionary(objects, key) {
  return objects.dictionary ? objects.dictionary(key) : objects.get(key);
}

export function getPageMediabox(objects, pageNum, pageGen) {
  let d = objectDictionary(objects, `${pageNum},${pageGen}`);
  if (d === undefined) d = Buffer.alloc(0);
  let text = d.toString("latin1");
  for (let hop = 0; hop < 8; hop += 1) {
    const m = MEDIABOX_RE.exec(text);
    if (m) {

      const [x0, y0, x1, y1] = [m[1], m[2], m[3], m[4]].map(Number);
      if ([x0, y0, x1, y1].every(Number.isFinite) && x0 !== x1 && y0 !== y1) {
        return [Math.abs(x1 - x0), Math.abs(y1 - y0)];
      }
    }
    const pm = PARENT_RE.exec(text);
    if (!pm) break;
    const parent = objectDictionary(objects, `${pyInt(pm[1])},${pyInt(pm[2])}`);
    text = parent === undefined ? "" : parent.toString("latin1");
  }
  return [612.0, 792.0];
}

const RES_REF_RE = /\/Resources\s+(\d+)\s+\d+\s+R/;
const XOBJECT_REF_RE = /\/XObject\s+(\d+)\s+\d+\s+R/;
const SUBTYPE_IMAGE_RE = /\/Subtype\s*\/Image/;
const ANY_REF_RE = /(\d+)\s+\d+\s+R/g;

export function pageHasImages(objects, pageNum, pageGen) {
  const get = (refNum) => {
    const raw = objectDictionary(objects, `${pyInt(refNum)},0`);
    return raw === undefined ? "" : raw.toString("latin1");
  };
  const pageBuf = objectDictionary(objects, `${pageNum},${pageGen}`);
  const d = pageBuf === undefined ? "" : pageBuf.toString("latin1");
  let res = d;
  const m = RES_REF_RE.exec(d);
  if (m) res = get(m[1]);
  if (SUBTYPE_IMAGE_RE.test(res)) return true;
  const mx = XOBJECT_REF_RE.exec(res);
  const xo = mx ? get(mx[1]) : res;
  if (SUBTYPE_IMAGE_RE.test(xo)) return true;
  ANY_REF_RE.lastIndex = 0;
  let rm;
  while ((rm = ANY_REF_RE.exec(xo)) !== null) {
    if (SUBTYPE_IMAGE_RE.test(get(rm[1]))) return true;
  }
  return false;
}

// Page discovery (catalog -> /Pages -> /Kids leaf order) lives in the
// outside-stream instruction pass: core/pdf/page-instructions.js
// (decodePdfInstructions). This module only extracts what the
// instructions point at.




export { IDENTITY, CmapIdentityMap, LegacyAyarMap, mapCode } from "../pdf/pdf-fonts.js";














export const ARLARWADE_AYAR_MAP = new Map([
  [33, "ြ"], [34, "ပ"], [35, "ည"], [36, "်"], [37, "ေ"], [38, "ထ"],
  [39, "ာ"], [40, "င"], [41, "စ"], [42, "ု"], [43, "သ"], [44, "မ"],
  [45, "္မ"], [46, "တ"], [47, "န"], [48, "န"], [49, "ိ"], [50, "ံ"],
  [51, "ရ"], [52, "း"], [53, "၀"], [54, "ြ"], [55, "က"], [56, "ီ"],
  [57, "ဌ"], [58, "အ"], [59, "ဖ"], [60, "ွ"], [61, "ဲ"], [62, "့"],
  [63, "ဥ"], [64, "ဒ"], [65, "ယ"], [66, "ှ"], [67, "ခ"], [68, "၂"],
  [69, "၀"], [70, "၁"], [71, "၃"], [72, "—"], [73, "၊"], [74, " "],
  [75, "လ"], [76, "ူ"], [77, "။"], [78, "က"], [79, "ျ"], [80, "ါ"],
  [81, "္ဒ"], [82, "ါ"], [83, "၅"], [84, "ဇ"], [85, "ံ"], [86, "့"],
  [87, "ြ"], [88, "ု"], [89, "၂"], [90, "၍"], [91, "ဝ"], [92, ""],
  [93, "ဉ"], [94, "ဏ"], [95, "ဆ"], [96, "၉"], [97, "၈"], [98, "၄"],
  [99, "ဘ"], [100, "၆"], [101, "ဤ"], [102, "ြ"], [103, "ခ"], [104, "ဂ"],
  [105, ""], [106, "ဗ"], [107, "ရ"], [108, "("], [109, ")"], [110, "ဃ"],
  [111, "၌"], [112, "ဈ"], [113, "ဍ"], [114, "ဎ"], [115, "၊"], [116, "ဝ"],
  [117, "စ"], [118, "ဗ"], [119, "ဝ"], [120, "ၺ"], [121, "ပ"],
]);
const DEP_MARKS = new Set(Array.from(
  "\u103b\u103c\u103d\u103e\u1031\u102d\u102e\u102f"
  + "\u1030\u1032\u102c\u102b\u1036\u103a\u1037\u1038",
).map((c) => c.codePointAt(0)));


export function fixDigitConsonantConfusion(text) {
  const letterOrMark = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027
      || cp === 0x1039 || DEP_MARKS.has(cp);
  };
  const isDigit = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return cp >= 0x1040 && cp <= 0x1049;
  };
  const isBase = (ch) => {
    if (!ch) return false;
    const cp = ch.codePointAt(0);
    return cp >= 0x1000 && cp <= 0x1021;
  };
  let out = Array.from(text);
  const n = out.length;
  for (let i = 0; i < n; i += 1) {
    const after = i + 1 < n ? out[i + 1] : "";
    const before = i > 0 ? out[i - 1] : "";
    if (out[i] === "\u1040") {

      if (DEP_MARKS.has((after || "").codePointAt(0)) || (letterOrMark(before) && letterOrMark(after))) {
        out[i] = "\u101d";
      } else if (!isDigit(before) && !letterOrMark(before) && isBase(after)) {

        out[i] = "\u101d";
      }
    }
  }
  text = out.join("");





  for (let pass = 0; pass < 3; pass += 1) {
    const chars = Array.from(text);
    let changed = false;
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] !== "\u101b") continue;
      const before = i > 0 ? chars[i - 1] : "";
      const after = i + 1 < chars.length ? chars[i + 1] : "";
      if ((isDigit(before) || isDigit(after))
          && (!letterOrMark(after) || isDigit(after) || after === "\u101b")) {
        chars[i] = "\u1047";
        changed = true;
      }
    }
    text = chars.join("");
    if (!changed) break;
  }
  return text;
}


export function collapseOverprint(text) {
  const chars = Array.from(text);
  const n = chars.length;
  if (n < 2 || n > 9) return text;
  for (const size of [1, 2, 3]) {
    if (n % size !== 0 || Math.floor(n / size) < 2) continue;
    const unit = chars.slice(0, size).join("");
    if (unit.repeat(n / size) === text) return unit;
  }
  return text;
}


export function legacyAyarToUnicode(text, { applyAaVowelRule = true } = {}) {
  // Combined kinzi/vowel glyphs may be followed by medials in legacy order.
  // Preserve the vowel, placing the medials before it for Unicode.
  text = text.replace(/([က-အ])(င်္)([ိီံ])([ျြွှ]+)/gu, "$1$2$4$3");
  // Handle ordinary and compound pre-base slots in one pass. A second pass
  // could steal the preceding syllable's ေ when another cluster follows.
  text = text.replace(
    /((?:ေ?ြ[ွှ]+)|[ေြ]+)([က-အ၀၇၈])(င်္)?((?:္[က-အ])*)/gu,
    (_m, vowel, base, kinzi, stacked) => {
      const preposed = vowel.startsWith("ေြ") && /[ွှ]/u.test(vowel)
        ? `${vowel.slice(1)}ေ` : vowel;
      return (kinzi || "") + base + (stacked || "") + preposed;
    },
  );






  text = text.replace(
    /([က-အ][ါ-ှ]*)(င်္)(?![က-အ])/g,
    "$2$1",
  );
  // Pair medials with the base before ေ, including a combined ya/wa/ha.
  text = text.replace(/([က-အ၀၇၈])ေ([ျြ]?)([ွှ]+)/gu, "$1$2$3ေ");
  text = text.replace(/([က-အ၀၇၈])(ေ)([ျြ])/g, "$1$3$2");
  text = text.replace(/([က-အ])([က-အ])(င်္)/g, "$1$3$2");


  text = text.replace(/ဦး/g, "ဦး");





  text = fixDigitConsonantConfusion(text);
  // In these legacy layouts, ya/ra uses ာ rather than ါ. Do this after
  // visual-order conversion and leave all other marks in their original order.
  return applyAaVowelRule ? text.replace(/([က-အ][ျြ][ျြွှ]*ေ?)ါ/g, "$1ာ") : text;
}










const INLINE_IMAGE_END_RE = /[\x00\x09-\x0d\x20]EI(?=[\x00\x09-\x0d\x20[\]<>/%(]|$)/g;

function skipInlineImage(data, pos) {
  INLINE_IMAGE_END_RE.lastIndex = pos;
  const m = INLINE_IMAGE_END_RE.exec(data);
  return m ? INLINE_IMAGE_END_RE.lastIndex : data.length;
}
export function* iterContentOperations(data, { prefix = false } = {}) {
  const lex = typeof data === "string" ? new Lexer(data) : data;
  let operands = [];
  const containers = [];
  for (;;) {
    const tok = lex.nextToken();
    // At a checkpoint the last token may continue in the next byte. Leave it
    // for the full page parse instead of treating a truncated token as text.
    if (tok === null || (prefix && lex.pos === data.length)) break;
    const [kind, value] = tok;
    if (kind === "aopen") { containers.push({ type: "a", mark: operands.length }); continue; }
    if (kind === "dopen") { containers.push({ type: "d", mark: operands.length }); continue; }
    if (kind === "aclose" || kind === "dclose") {
      if (!containers.length) continue;
      const { type, mark } = containers.pop();
      const items = operands.splice(mark);
      if (type === "a") {
        operands.push(items);
      } else {
        const d = new Map();
        for (let i = 0; i < items.length - 1; i += 2) {
          if (items[i] instanceof PdfName) d.set(String(items[i]), items[i + 1]);
        }
        operands.push(d);
      }
      continue;
    }
    if (kind === "kw") {
      if (containers.length) { operands.push(value); continue; }
      const op = String(value);
      if (op === "ID") {
        if (typeof lex.skipInlineImage === "function") lex.skipInlineImage();
        else lex.pos = skipInlineImage(data, lex.pos);
        operands = [];
        continue;
      }
      yield [op, operands];
      operands = [];
      continue;
    }
    operands.push(value);
    if (!containers.length && operands.length > 64) {

      operands.splice(0, operands.length - 16);
    }
  }
  // An unfinished array is not necessarily a TJ operation. Its strings
  // remain buffered for the complete-page parse, not for route selection.
}


function shownStrings(op, operands) {
  if (!operands.length) return [];
  if (op === "Tj" || op === "'" || op === '"') {
    const last = operands[operands.length - 1];
    return (typeof last === "string" || last instanceof PdfHexBytes) ? [last] : [];
  }
  if (op === "TJ") {
    const last = operands[operands.length - 1];
    if (Array.isArray(last)) return last.filter((item) => typeof item === "string" || item instanceof PdfHexBytes);
  }
  return [];
}

function documentLoader(doc, objects) {
  let { loader } = doc;
  if (loader === null || loader.objects !== objects) {
    loader = new FontResourceLoader(objects, getStream, parseTtfCmap, parseToUnicodeStream);
    doc.loader = loader;
    doc.resetFontCache();
  }
  return loader;
}

const CONTENTS_REF_RE = /\/Contents\s+(\d+)\s+\d+\s+R/;
const CONTENTS_ARR_RE = /\/Contents\s*\[([\s\S]*?)\]/;

// Keep adjacent runs of the profiled font together across text operations
// and pieces, but never apply its ordering to another font resource.
function joinDraftRuns(pieces, order) {
  let selected = null;
  let pending = "";
  let out = "";
  const flush = () => { out += selected ? order(pending) : pending; pending = ""; };
  for (const [, , text, runs] of pieces) {
    for (const [isDraft, part] of (runs ?? [[false, text]])) {
      if (!part) continue;
      if (selected !== null && selected !== isDraft) flush();
      selected = isDraft;
      pending += part;
    }
  }
  flush();
  return out;
}

function joinOrderedLine(ordered, doc, onVisualGlyphRecovery = null) {
  if (doc.kind === "font") {
    let decoder = null;
    let pending = "";
    let rawParts = [];
    let hasRaw = true;
    const transformed = [];
    const flushRun = () => {
      let text = pending;
      if (decoder?.visualUnicodeGlyphs && hasRaw && rawParts.length) {
        let unresolved = false;
        text = decodeVisualUnicodeRun(decoder, rawParts, {
          onUnresolved: () => { unresolved = true; }, startsAtBoundary: transformed.length === 0,
        });
        if (text !== pending || unresolved) onVisualGlyphRecovery?.({ changed: text !== pending, unresolved });
      } else if (decoder && doc.transformRun) text = doc.transformRun(decoder, pending);
      if (decoder) transformed.push(text);
      pending = "";
      rawParts = [];
      hasRaw = true;
    };
    for (const [, , text, runs] of ordered) {
      for (const [font, part, , raw] of runs || [[null, text]]) {
        if (font !== decoder) { flushRun(); decoder = font; }
        pending += part;
        if (typeof raw === "string") rawParts.push(raw);
        else hasRaw = false;
      }
    }
    if (decoder) flushRun();
    else if (pending) transformed.push(pending);
    return transformed.join("");
  }
  if (doc.zawcodeOrder) return joinDraftRuns(ordered, doc.zawcodeOrder);
  if (doc.legacyTextFix) {
    const page = doc.legacyCodePage;
    const applyAaVowelRule = (page == null && doc.map instanceof LegacyAyarMap)
      || page === AYAR_LEGACY_CODE_PAGE || page === WININNWA_LEGACY_CODE_PAGE;
    return joinDraftRuns(ordered, (text) => legacyAyarToUnicode(text, { applyAaVowelRule }));
  }
  return ordered.map(([, , text]) => text).join("");
}

// Long, painted vertical rules are evidence of a table rather than facing
// pages. Keep only a bounded set of distinct lines; clipping paths do not
// count. Text inside a table retains the ordinary top-to-bottom order.
function pageGridEvidence(width, height, left = 0) {
  let current = null;
  let pending = [];
  const rules = [];
  let grid = false;
  const add = (target, a, b) => {
    const low = Math.min(a[1], b[1]);
    const high = Math.max(a[1], b[1]);
    const x = (a[0] + b[0]) / 2;
    if (Math.abs(a[0] - b[0]) > 3 || high - low < height * 0.2 || x < left || x > left + width) return;
    if (target.length < 32 && !target.some((rule) => Math.abs(rule.x - x) < 3)) target.push({ x, low, high });
  };
  return {
    consume(op, operands, matrix) {
      if (grid || width < height * 1.25 || height <= 0) return;
      const point = (x, y) => [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
      if (op === "re" && operands.length >= 4 && operands.slice(-4).every(isNumeric)) {
        const [x, y, w, h] = operands.slice(-4).map(toNumber);
        const corners = [point(x, y), point(x + w, y), point(x, y + h), point(x + w, y + h)];
        const xs = corners.map((p) => p[0]);
        const ys = corners.map((p) => p[1]);
        if (Math.max(...xs) - Math.min(...xs) <= 3) {
          add(pending, [Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]);
        }
      } else if (["m", "l"].includes(op) && operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
        const next = point(...operands.slice(-2).map(toNumber));
        if (op === "l" && current) add(pending, current, next);
        current = next;
      } else if (["c", "v", "y"].includes(op)) {
        current = null;
      } else if (["n", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*"].includes(op)) {
        if (op !== "n") {
          for (const line of pending) add(rules, [line.x, line.low], [line.x, line.high]);
          grid = rules.some((line) => rules.filter((other) =>
            Math.min(line.high, other.high) - Math.max(line.low, other.low) >= height * 0.15).length >= 4);
        }
        pending = [];
        current = null;
      }
    },
    get detected() { return grid; },
  };
}

export function extractPageLines(objects, pageNum, pageGen, decoding, {
  pageBox = null, usedMyanmarFonts = null, usedFontKinds = null, usedLegacyFonts = null,
  inspectPrefix = null, onPageContent = null, onConfirmedRepair = null, onVisualGlyphRecovery = null,
  scratchDir = null, pieceStore = null,
} = {}) {
  let doc = asDocumentDecoding(decoding);
  const loader = documentLoader(doc, objects);
  let decoders = pageFontDecoders(loader, pageNum, pageGen, doc);
  let unsetFont = new UnsetFontDecoder("", { doc });
  const imageCollector = new PageImageCollector(loader, pageNum, pageGen, iterContentOperations);
  const contentOptions = {
    maxBytes: MAX_STREAM_MB * 1024 * 1024,
    inspect: (prefix) => {
      const selected = inspectPrefix?.(prefix, decoders, loader, imageCollector.media);
      if (!(selected instanceof DocumentDecoding) || selected === doc) return;
      doc = selected;
      if (doc.loader !== loader) {
        doc.loader = loader;
        doc.resetFontCache();
      }
      decoders = pageFontDecoders(loader, pageNum, pageGen, doc);
      unsetFont = new UnsetFontDecoder("", { doc });
    },
  };
  const spooled = spoolPageContent(loader, pageNum, pageGen, { ...contentOptions, scratchDir });
  const suppliedStore = pieceStore;
  try {
  pieceStore ??= new PdfPagePieces(path.dirname(spooled.file));
  const { streams, references } = spooled;
  const [pageW, pageH] = pageBox ?? getPageMediabox(objects, pageNum, pageGen);
  pieceStore.begin(doc);
  onPageContent?.(streams, references, loader, spooled);
  const pageLeft = imageCollector.media[0];
  const gridEvidence = pageGridEvidence(pageW, pageH, pageLeft);





  let active = null;

  // A /Contents array is one logical sequence of page commands. Keep the
  // original stream boundaries for the writer, but do not reset text or
  // graphics state between them while parsing.
  const sources = spooled.size ? [new PdfFileLexer(spooled.fd, spooled.size)] : [];
  for (const content of sources) {

    let inBlock = false;
    let blockTexts = [];
    let blockRuns = [];
    let blockXy = null;
    let blockSize = null;
    let lineMatrix = [1, 0, 0, 1, 0, 0];
    let leading = 0;
    let fontSize = 12;
    const savedTextStates = [];
    let pendingDecoder = null;
    let pendingBytes = "";
    const position = (matrix = lineMatrix) => {
      const [a, b, c, d, e, f] = imageCollector.state.matrix;
      return [a * matrix[4] + c * matrix[5] + e, b * matrix[4] + d * matrix[5] + f];
    };
    const effectiveSize = () => {
      const [a, b, c, d] = imageCollector.state.matrix;
      return Math.abs(fontSize) * Math.hypot(a * lineMatrix[2] + c * lineMatrix[3],
        b * lineMatrix[2] + d * lineMatrix[3]);
    };
    const flushPiece = () => {
      if (blockTexts.length && blockXy !== null) {
        const text = blockTexts.join("");
        // Repeated glyphs in one text run may be intentional (including
        // U+102F U+102F); do not collapse them without separate evidence.
        pieceStore.add([blockXy[1], blockXy[0], blockSize ?? 12, text,
          doc.kind === "font" || doc.zawcodeOrder || doc.legacyTextFix ? blockRuns : null]);
      }
      blockTexts = [];
      blockRuns = [];
      blockXy = null;
      blockSize = null;
    };
    const moveLine = (next) => {
      // A single BT/ET can contain an entire page. Flush when a text matrix
      // moves to a different baseline, not merely at ET. Small offsets are
      // kept together because they can position Burmese combining glyphs.
      if (blockXy !== null) {
        const nextXy = position(next);
        const changesBaseline = Math.abs(nextXy[1] - blockXy[1]) > 3;
        const middle = pageLeft + pageW / 2;
        const crossesSpread = pageW >= pageH * 1.25 && pageH > 0
          && (blockXy[0] < middle) !== (nextXy[0] < middle);
        if (changesBaseline || crossesSpread) flushPiece();
      }
      lineMatrix = next;
    };
    const translateLine = (dx, dy) => {
      const [a, b, c, d, e, f] = lineMatrix;
      moveLine([a, b, c, d, e + dx * a + dy * c, f + dx * b + dy * d]);
    };
    const recordText = (decoder, text, confirmedText = text, raw = null) => {
      if (blockXy === null) blockXy = position();
      blockSize = Math.max(blockSize ?? 0, effectiveSize());
      if (text && decoder.parsingPath === PDF_PARSING_PATHS.LEGACY) usedLegacyFonts?.add(decoder.baseFont || "");
      if (containsMyanmar(confirmedText) || decoder.fontLegacyCodePage || decoder.confirmedRawRuns) {
        if (usedMyanmarFonts) usedMyanmarFonts.add(decoder.baseFont || "");
        if (usedFontKinds && doc.fontKind) usedFontKinds.add(doc.fontKind(decoder));
      }
      blockTexts.push(text);
      if (doc.kind === "font") blockRuns.push([decoder, text, confirmedText, decoder.visualUnicodeGlyphs ? raw : null]);
      else if (doc.zawcodeOrder) blockRuns.push([decoder.zawcodeGlyphs != null, text, confirmedText]);
      else if (doc.legacyTextFix) blockRuns.push([decoder.needsLegacyTextFix, text, confirmedText]);
    };
    const flushConfirmedRun = () => {
      if (pendingDecoder) {
        const original = pendingDecoder.decode(pendingBytes, { useConfirmed: false });
        const confirmed = pendingDecoder.decode(pendingBytes, { useConfirmed: true });
        recordText(pendingDecoder, original, confirmed);
      }
      pendingDecoder = null;
      pendingBytes = "";
    };

    for (const [op, operands] of iterContentOperations(content)) {
      // Preserve the old graphics matrix until pending text is recorded.
      // Match only adjacent text-show bytes in the same font and positioning run.
      if (["BT", "ET", "Tf", "Tm", "Td", "TD", "T*", "'", '"', "q", "Q", "cm"].includes(op)) flushConfirmedRun();
      if (inBlock && (op === "Q" || op === "cm")) flushPiece();
      gridEvidence.consume(op, operands, imageCollector.state.matrix);
      imageCollector.consume(op, operands);
      // Text state is part of the graphics state. BT/ET reset the text
      // matrices, but do not themselves reset the font, size or leading.
      if (op === "q") { savedTextStates.push({ active, fontSize, leading }); continue; }
      if (op === "Q") {
        const saved = savedTextStates.pop();
        if (saved) ({ active, fontSize, leading } = saved);
        continue;
      }
      if (op === "Tf") {
        if (operands.length >= 2 && operands[operands.length - 2] instanceof PdfName) {
          active = decoders.get(String(operands[operands.length - 2])) ?? null;
        }
        if (operands.length && isNumeric(operands[operands.length - 1])) {
          fontSize = toNumber(operands[operands.length - 1]);
        }
        continue;
      }

      if (op === "BT") {
        if (!inBlock) {
          inBlock = true;
          blockTexts = [];
          blockRuns = [];
          blockXy = null;
          blockSize = null;
          lineMatrix = [1, 0, 0, 1, 0, 0];
        }
        continue;
      }

      if (!inBlock) continue;

      if (op === "Tm") {
        if (operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
          moveLine(operands.slice(-6).map(toNumber));
        }
        continue;
      }

      if (op === "Td" || op === "TD") {
        if (operands.length >= 2 && operands.slice(-2).every(isNumeric)) {
          const dx = toNumber(operands[operands.length - 2]);
          const dy = toNumber(operands[operands.length - 1]);
          if (op === "TD") leading = -dy;
          translateLine(dx, dy);
        }
        continue;
      }

      if (op === "TL") {
        if (operands.length && isNumeric(operands[operands.length - 1])) {
          leading = toNumber(operands[operands.length - 1]);
        }
        continue;
      }

      if (op === "T*") {
        translateLine(0, -leading);
        continue;
      }

      if (op === "ET") {
        inBlock = false;
        flushPiece();
        continue;
      }

      if (op === "Tj" || op === "TJ" || op === "'" || op === '"') {
        // The two quote operators include the same line move as T*.
        if (op === "'" || op === '"') translateLine(0, -leading);
        const decoder = active !== null ? active : unsetFont;
        for (const shown of shownStrings(op, operands)) {




          const arg = decoder instanceof UnsetFontDecoder || !(shown instanceof PdfHexBytes)
            ? shown : shown.s;
          if (decoder.confirmedRawRuns && typeof arg === "string") {
            if (pendingDecoder && pendingDecoder !== decoder) flushConfirmedRun();
            pendingDecoder = decoder;
            pendingBytes += arg;
          } else {
            flushConfirmedRun();
            recordText(decoder, decoder.decode(arg), undefined, typeof arg === "string" ? arg : null);
          }
        }
      }
    }
  }










  pieceStore.finish({ onConfirmedRepair,
    joinRuns: (ordered, selectedDoc) => joinOrderedLine(ordered, selectedDoc, onVisualGlyphRecovery),
    pageLeft, pageWidth: pageW, pageHeight: pageH, hasTableRules: gridEvidence.detected });
  const lines = suppliedStore ? pieceStore : [...pieceStore.lines()];
  return [lines, pageW, pageH, imageCollector.images];
  } finally {
    pieceStore?.abort();
    if (!suppliedStore) pieceStore?.close();
    spooled.close();
  }
}
const isAsciiDigitOrDot = (ch) => (ch >= "0" && ch <= "9") || ch === ".";
export function extractPageTextLayout(objects, pageNum, pageGen, codeToUni) {
  const [lines] = extractPageLines(objects, pageNum, pageGen, codeToUni);
  return lines.map((l) => l[3]).join("\n");
}

const MYA_LO = 0x1000;
const MYA_HI = 0x109f;

function hasMyanmarGlyphs(cmap) {
  for (const cp of cmap.keys()) if (cp >= MYA_LO && cp <= MYA_HI) return true;
  return false;
}
export function pickEmbeddedFont(objects, refs, log = () => {}) {
  let fallback = null;
  for (const ref of refs) {
    const ttf = getStream(objects, ref[0], ref[1]);
    if (!pyTruthy(ttf)) continue;
    const cmap = parseTtfCmap(ttf);
    if (hasMyanmarGlyphs(cmap)) {
      log(`[+] Chosen embedded font obj ${ref[0]} (contains Myanmar glyphs)`);
      return [ref, ttf, cmap];
    }
    if (fallback === null) fallback = [ref, ttf, cmap];
  }
  if (fallback !== null) {
    log(`[i] No Myanmar-glyph font found; using first font stream obj ${fallback[0][0]}`);
    return fallback;
  }
  return [null, null, new Map()];
}

export { hasMyanmarGlyphs };


// FILE: decoding/pdf/emit.js
/*
(PDF 30) PDF branch, position 30 in the chain - spool helper between finishing (PDF 19) and output (PDF 31).
This module writes and reads the on-disk page store: page records and layout lines are spooled to files and streamed back when output is built.
*/
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { StringDecoder } from "node:string_decoder";
import { textLines } from "../decoding/finalized-cmap.js";

function writeAll(fd, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("Could not write the page spool");
    offset += count;
  }
}

export function* textChunks(file, start = 0, length = fs.statSync(file).size) {
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  const decoder = new StringDecoder("utf8");
  let offset = 0;
  try {
    while (offset < length) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, length - offset), start + offset);
      if (!count) throw new Error("Unexpected end of the page spool");
      offset += count;
      const text = decoder.write(buffer.subarray(0, count));
      if (text) yield text;
    }
    const tail = decoder.end();
    if (tail) yield tail;
  } finally {
    fs.closeSync(fd);
  }
}

export async function* pageRecords(file) {
  const input = fs.createReadStream(file, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) if (line) yield JSON.parse(line);
  } finally {
    lines.close();
    input.destroy();
  }
}

export function* layoutLines(store, page) {
  if (!store.layoutPath || !page.layoutLength) return;
  for (const line of textLines(textChunks(store.layoutPath, page.layoutStart, page.layoutLength))) {
    if (line) yield JSON.parse(line);
  }
}

export class PageStoreWriter {
  constructor(directory, prefix = "page") {
    this.store = {
      indexPath: path.join(directory, `${prefix}-index.jsonl`),
      textPath: path.join(directory, `${prefix}-text.bin`),
      layoutPath: path.join(directory, `${prefix}-layout.jsonl`),
    };
    this.indexFd = null;
    this.textFd = null;
    this.layoutFd = null;
    try {
      this.indexFd = fs.openSync(this.store.indexPath, "wx", 0o600);
      this.textFd = fs.openSync(this.store.textPath, "wx", 0o600);
      this.layoutFd = fs.openSync(this.store.layoutPath, "wx", 0o600);
    } catch (error) {
      this.close();
      throw error;
    }
    this.textOffset = 0;
    this.layoutOffset = 0;
    this.pages = 0;
  }

  addPage({ text, lines = [], wh, images = [], hasImg = false }) {
    if (this.indexFd == null) throw new Error("Page spool is closed");
    const start = this.textOffset;
    let hasText = false;
    for (const chunk of text) {
      if (!chunk) continue;
      hasText ||= /\S/u.test(chunk);
      const bytes = Buffer.from(chunk, "utf8");
      writeAll(this.textFd, bytes);
      this.textOffset += bytes.length;
    }
    const layoutStart = this.layoutOffset;
    let lineCount = 0;
    for (const line of lines) {
      const bytes = Buffer.from(`${JSON.stringify(line)}\n`, "utf8");
      writeAll(this.layoutFd, bytes);
      this.layoutOffset += bytes.length;
      lineCount += 1;
    }
    const record = {
      index: this.pages, start, length: this.textOffset - start, hasText,
      layoutStart, layoutLength: this.layoutOffset - layoutStart, lineCount,
      ...(wh ? { wh } : {}), images, hasImg: hasImg === true,
    };
    writeAll(this.indexFd, `${JSON.stringify(record)}\n`);
    this.pages += 1;
    return record;
  }

  close() {
    for (const key of ["indexFd", "textFd", "layoutFd"]) {
      if (this[key] != null) fs.closeSync(this[key]);
      this[key] = null;
    }
  }
}


// FILE: decoding/pdf/finalized-cmap.js
/*
(PDF 19) PDF branch, position 19 in the chain - after the extraction (PDF 13), before records are made (PDF 10).
This module finishes one page's text: it orders the marks, converts Zawgyi text, cleans Unicode text (PDF 20 to 26), and writes the finished page to its text file.
*/
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { containsMyanmar } from "../detect.js";
import { arrangeZawCodeOrder } from "../zawcode-order.js";
import { correctWorldWord, judgePageLines, selectPageDecision } from "./judgement.js";
import { cleanupText, orderText } from "../clean.js";
import { preserveRegionalRuns } from "../unicode-evidence.js";
import { preserveCharacters, protectedCharacters } from "./judgement.js";
import { createRabbitStream } from "../rabbit.js";
import { StreamingReplace } from "../stream-replace.js";

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

function identicalFiles(left, right) {
  if (fs.statSync(left).size !== fs.statSync(right).size) return false;
  const a = fs.openSync(left, "r");
  const b = fs.openSync(right, "r");
  const x = Buffer.allocUnsafe(READ_SIZE);
  const y = Buffer.allocUnsafe(READ_SIZE);
  try {
    while (true) {
      const nx = fs.readSync(a, x, 0, x.length, null);
      const ny = fs.readSync(b, y, 0, y.length, null);
      if (nx !== ny || !x.subarray(0, nx).equals(y.subarray(0, ny))) return false;
      if (!nx) return true;
    }
  } finally { fs.closeSync(a); fs.closeSync(b); }
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
      for (const [x, y, size] of store.lines()) {
        yield [x, y, size, converted.next().value];
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

export const orderUnicodeText = (text) => preserveRegionalRuns(
  text, (part) => preserveCharacters(part, orderText),
);
export const cleanupUnicodeText = (text) => preserveRegionalRuns(
  text, (part) => preserveCharacters(part, cleanupText),
);

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
// converted by finishPageToFile(), so they only need the same ordering here.
export function convertFinalizedPageText(text, page = {}, applyCleanup = true) {
  const raw = String(text ?? "");
  const decision = page?.decision;
  if (decision === "rabbit") return orderUnicodeText(raw);
  const unicodeLane = FINAL_UNICODE_DECISIONS.has(decision)
    || (!decision && page?.category === "UNICODE");
  if (!unicodeLane) return raw;
  const ordered = orderUnicodeText(raw);
  return applyCleanup && decision !== "zawcode" ? cleanupUnicodeText(ordered) : ordered;
}

// Decide once for the entire page, but make the decision in passes over the
// disk-backed lines. No Rabbit rule is applied to a partially repaired page.
export function finishPageToFile(store, {
  directory, parsingPath, sourceEncoding = "auto", fontKinds = new Set(),
} = {}) {
  function* pageTexts() {
    for (const [, , , text] of store.lines()) yield text;
  }
  const judgment = judgePageLines(pageTexts(), arrangeZawCodeOrder);
  const { originalHasText, count } = judgment;
  let decision = selectPageDecision(judgment, parsingPath);
  const worldEvidence = sourceEncoding !== "unicode" && decision === "rabbit";

  const id = randomUUID();
  const file = path.join(directory, `page-text-${id}.txt`);
  const beforeFile = path.join(directory, `protected-before-${id}.txt`);
  const afterFile = path.join(directory, `protected-after-${id}.txt`);
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
    // Legacy pages call nothing behind the layout parse: the WinInnwa or
    // Ayar output is written exactly as decoded.
    const writePlain = () => {
      let first = true;
      for (const [, , , text] of store.lines()) {
        if (!first) write("\n");
        first = false;
        write(text);
      }
    };

    if (decision === "legacy") {
      writePlain();
    } else if (decision === "rabbit") {
      const before = fs.openSync(beforeFile, "wx", 0o600);
      const after = fs.openSync(afterFile, "wx", 0o600);
      try {
        const world = worldEvidence ? new StreamingReplace(/က(?:မၻာ|မ်ဘာ)/u, "ကမ္ဘာ") : null;
        const output = (text) => {
          writeAll(after, protectedCharacters(text));
          const transformed = world ? world.push(text) : text;
          write(transformed);
        };
        const rabbit = createRabbitStream(output, { preserveSpaces: true });
        let first = true;
        for (const [, , , text] of store.lines()) {
          const chunk = first ? text : `\n${text}`;
          first = false;
          writeAll(before, protectedCharacters(chunk));
          rabbit.push(chunk);
        }
        rabbit.push("", true);
        if (world) write(world.push("", true));
      } finally { fs.closeSync(before); fs.closeSync(after); }
      if (!identicalFiles(beforeFile, afterFile)) {
        decision = "unaligned-zawgyi";
        fs.closeSync(fd);
        fd = fs.openSync(file, "w", 0o600);
        chars = 0;
        bytes = 0;
        outputHasMyanmar = false;
        writeOriginal();
      }
    } else if (decision === "zawcode") {
      writeOriginal({ transform: arrangeZawCodeOrder });
    } else {
      writeOriginal();
    }
    fs.closeSync(fd);
    fd = null;
    const category = !outputHasMyanmar ? "UNKNOWN"
      : decision === "rabbit" || decision === "unaligned-zawgyi" ? "ZAWGYI" : "UNICODE";
    return { text: new PageTextFile(file, chars, bytes), decision, category, originalHasText, lineCount: count };
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw error;
  } finally {
    fs.rmSync(beforeFile, { force: true });
    fs.rmSync(afterFile, { force: true });
  }
}


// FILE: decoding/praised/judgement.js
/*
(PDF 28) PDF branch - the lane judgement module: rules, judgement, decision, lane.
This single module holds the four pieces that choose a PDF page's lane, kept apart on purpose:
  1. RULE     - the mark-order tables and mark sets. Data only; no decisions here.
  2. JUDGEMENT - pure functions that judge a piece of text against the rules
                (scoreText, markOrderAligned, englishLikeness). Text in, evidence out.
  3. DECISION - the one who calls the judgement functions to answer for a whole
                page (judgePageLines): it asks, gathers, and returns the evidence pack.
  4. LANE     - the one who actually selects the lane from that judgement
                (selectPageDecision, instructionLane, isUnicodeLaneDecision).
Nothing here writes files or rewrites text; consumers act on what it answers.
*/
import { containsMyanmar, isUnicodeFont } from "../../detect.js";
import { isLegacyFontName, normaliseFontName } from "../../codepage/codepage-names.js";
import { PDF_PARSING_PATHS } from "../../pdf/pdf-fonts.js";

const LATIN_LIKE = /^[\x20-\xff\p{Script=Latin}\p{Number}\p{Punctuation}\p{Symbol}\s]+$/u;
const PAGE_NUMBER = /^(?:[0-9]{1,4}|(?:page\s*[|:#-]?\s*[0-9]{1,4}\s*)+)$/iu;
const SPACE_SEPARATOR = /^\p{Zs}$/u;

// ===========================================================================
// PIECE 1 - RULE
// The tables the judgement functions judge against. Burmese syllable order
// exists here three times on purpose and the three must never be merged:
// MARK_ORDER is the Engine's own slot order (reorder code), SCORE_MARK_ORDER
// is the mm-score order, UNICODE_MARK_ORDER is Unicode 16 table 16-4.
// ===========================================================================

// Burmese index (base consonant) characters — used to identify syllable bases.
export const INDEX_BASES = new Set();
for (let cp = 0x1000; cp <= 0x1021; cp += 1) INDEX_BASES.add(String.fromCodePoint(cp));
for (let cp = 0x1023; cp <= 0x1027; cp += 1) INDEX_BASES.add(String.fromCodePoint(cp));
INDEX_BASES.add("\u1029"); INDEX_BASES.add("\u102a"); INDEX_BASES.add("\u103f"); INDEX_BASES.add("\u104e");

export function isIndex(ch) {
  return INDEX_BASES.has(ch);
}

// Unicode 16, table 16-4: the modern Burmese syllable order. Characters on
// the same row have the same priority; this is not the Engine's own order.
export const MARK_ORDER = new Map([
  ["\u1030", 1], ["\u1031", 2], ["\u102f", 3], ["\u102e", 4],
  ["\u1032", 5], ["\u1033", 6], ["\u1034", 7], ["\u1035", 8],
  ["\u1036", 9], ["\u102d", 10], ["\u102c", 11], ["\u102b", 12],
  ["\u1014", 13], ["\u103a", 14], ["\u102f", 15], ["\u1037", 16],
  ["\u1038", 17], ["\u1019", 18], ["\u103b", 19], ["\u103c", 20],
  ["\u103d", 21], ["\u103e", 22],
]);

export const MARKS = new Set(MARK_ORDER.keys());

const SCORE_MARKS = new Set([
  "\u103b", "\u103c", "\u103d", "\u103e", "\u1031", "\u102d", "\u102e", "\u102f",
  "\u1030", "\u1032", "\u102c", "\u102b", "\u1036", "\u103a", "\u1037", "\u1038",
]);
const SCORE_MARK_ORDER = new Map([
  ["\u103b", 1], ["\u103c", 2], ["\u103d", 3], ["\u103e", 4], ["\u1031", 5],
  ["\u102d", 6], ["\u102e", 7], ["\u102f", 8], ["\u1030", 9], ["\u1032", 10],
  ["\u102c", 11], ["\u102b", 12], ["\u1036", 13], ["\u103a", 14], ["\u1037", 15],
  ["\u1038", 16], [" ", 17], ["\n", 18],
]);

const ASAT = "\u103a";

function isUnicodeBase(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || (cp >= 0x1023 && cp <= 0x1027)
    || cp === 0x1029 || cp === 0x102a || cp === 0x103f || cp === 0x104e;
}

// Unicode 16, table 16-4: the modern Burmese syllable order used to judge
// whether a page's mark order is already aligned. Characters on the same
// row share a priority. This is deliberately separate from MARK_ORDER
// above, which is the Engine's own slot order used by the reorder code.
const UNICODE_MARK_ORDER = new Map([
  ["ျ", 1], ["ြ", 2], ["ွ", 3], ["ှ", 4],
  ["ေ", 5], ["ိ", 6], ["ီ", 6], ["ဲ", 6],
  ["ု", 7], ["ူ", 7], ["ါ", 8], ["ာ", 8],
  ["ံ", 9], ["့", 10], ["း", 11],
]);

// ===========================================================================
// PIECE 2 - JUDGEMENT
// Functions that make a judgement about text: they read, they score, they
// never rewrite. Callers who want an answer for a whole page go through
// PIECE 3; callers who want a lane go through PIECE 4.
// ===========================================================================

// --- mm-score -------------------------------------------------------------
// Port of the Python mm_score.score_text: how much a decoded string reads
// like real Burmese, measured structurally — dependent marks must attach
// to a base, must not repeat on one base, and must follow in a permitted
// order. Only the *relative* score between candidate decodings of the same
// source bytes is meaningful. This never rewrites text.
function scoreIsIndex(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
}

function* scoreWalk(text) {
  let attached = false;
  let run = [];
  for (const ch of text) {
    const mark = SCORE_MARKS.has(ch);
    yield [ch, attached, run];
    if (scoreIsIndex(ch)) { attached = true; run = []; }
    else if (mark) { if (attached) run.push(ch); }
    else { attached = false; run = []; }
  }
}

export function scoreText(text) {
  const sample = String(text ?? "");
  let marks = 0;
  let myanmar = 0;
  for (const ch of sample) {
    if (SCORE_MARKS.has(ch)) marks += 1;
    const cp = ch.codePointAt(0);
    if (cp >= 0x1000 && cp <= 0x109f) myanmar += 1;
  }
  const myanmarRatio = sample.length ? myanmar / sample.length : 0;
  if (!marks) {
    return { score: 0, orphan: 0, disorder: 0, duplicate: 0, marks: 0, myanmarRatio };
  }
  let markTotal = 0;
  let orphans = 0;
  let attachedTotal = 0;
  let duplicates = 0;
  for (const [ch, attached, run] of scoreWalk(sample)) {
    if (!SCORE_MARKS.has(ch)) continue;
    markTotal += 1;
    if (!attached) orphans += 1;
    else {
      attachedTotal += 1;
      if (run.includes(ch)) duplicates += 1;
    }
  }
  let pairs = 0;
  let disordered = 0;
  let run = null;
  for (const ch of sample) {
    if (scoreIsIndex(ch)) { run = []; continue; }
    if (SCORE_MARKS.has(ch)) {
      if (run !== null) {
        run.push(ch);
        if (run.length > 1) {
          pairs += 1;
          if (SCORE_MARK_ORDER.get(run[run.length - 2]) > SCORE_MARK_ORDER.get(run[run.length - 1])) disordered += 1;
        }
      }
      continue;
    }
    run = null;
  }
  const orphan = markTotal ? orphans / markTotal : 0;
  const disorder = pairs ? disordered / pairs : 0;
  const duplicate = attachedTotal ? duplicates / attachedTotal : 0;
  return {
    score: 1 - Math.max(orphan, disorder),
    orphan, disorder, duplicate, marks, myanmarRatio,
  };
}

export function markOrderAligned(text) {
  let attached = false;
  let precedingMarks = false;
  let previous = -1;
  for (const ch of String(text ?? "")) {
    if (ch === " " || SPACE_SEPARATOR.test(ch)) continue;
    if (isUnicodeBase(ch)) {
      if (!attached && precedingMarks) return false;
      attached = true;
      precedingMarks = false;
      previous = -1;
      continue;
    }
    if (ch === ASAT || UNICODE_MARK_ORDER.has(ch)) {
      if (!attached) {
        precedingMarks = true;
        continue;
      }
      // Asat can follow the consonant, medial ya, or aa; NFC can also place
      // it after dot below. It therefore retains the preceding position.
      if (ch === ASAT) {
        if (previous < 0) previous = 0;
        continue;
      }
      const priority = UNICODE_MARK_ORDER.get(ch);
      if (priority < previous) return false;
      previous = priority;
      continue;
    }
    attached = false;
    precedingMarks = false;
    previous = -1;
  }
  return true;
}

// One-sided English check over Latin text: it can confirm that text reads
// as English, and it can flag Latin layout junk (legacy keyboard bytes read
// as Latin), but with too little evidence it abstains (verdict: null).
// A "violation" is a word English does not produce: no vowel in a word of
// 3+ letters, a lower->Upper case seam inside a word, or a 3+ repeated
// letter. Real English prose violates rarely; WinInnwa byte junk violates
// constantly.
export function englishLikeness(text) {
  const sample = String(text ?? "");
  const words = sample.match(/[A-Za-z]+(?:'[A-Za-z]+)?/gu) || [];
  const letters = words.reduce((sum, word) => sum + word.replace(/'/gu, "").length, 0);
  const hasSpaces = /\s/u.test(sample.trim());
  const base = { score: 0, letters, runs: words.length, hasSpaces, violationRate: 0 };
  if (letters < 8 || !words.length) return { verdict: null, ...base };
  let violations = 0;
  for (const word of words) {
    const plain = word.replace(/'/gu, "");
    if (plain.length >= 3 && !/[aeiou]/iu.test(plain)) violations += 1;
    else if (/[a-z][A-Z]/u.test(plain)) violations += 1;
    else if (/([A-Za-z])\1\1/u.test(plain)) violations += 1;
    else if (/[^aeiou\s]{4,}/iu.test(plain)) violations += 1;
  }
  const violationRate = violations / words.length;
  const score = 1 - violationRate;
  // English body text is spaced words. One unbroken Latin run — however
  // dictionary-like — is not body text and must not confirm English.
  if (!hasSpaces) return { verdict: "not-english", score, letters, runs: words.length, hasSpaces, violationRate };
  // Two short words are not enough evidence either way.
  if (words.length < 3) return { verdict: null, score, letters, runs: words.length, hasSpaces, violationRate };
  const verdict = violationRate <= 0.34 ? "english" : "not-english";
  return { verdict, score, letters, runs: words.length, hasSpaces, violationRate };
}

function onlyPageNumbers(text) {
  const lines = text.split(/[\r\n]+/u).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => PAGE_NUMBER.test(line));
}

function onlyNonBodyHeader(text) {
  const compact = text.replace(/\s+/gu, " ").trim();
  if (/^(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2},?\s+\d{4}[\p{P}\s]*$/iu.test(compact)) return true;
  if (/^(?:typing|typed\s+by|scanned\s+by|transcribed\s+by|prepared\s+by|uploaded\s+by)\s*[-:|]\s*[a-z0-9_.-]{1,40}(?:\s+\d{1,4})*[\p{P}\s]*$/iu.test(compact)) return true;
  const address = /\b(?:https?:\/\/)?(?:www\.)?(?:[a-z0-9][a-z0-9-]*\.)+[a-z]{2,24}(?:\/[^()]*)?/giu;
  let found = false;
  const rest = compact.replace(address, () => { found = true; return " "; });
  if (!found || [...rest].some((char) => char.codePointAt(0) > 0x7f) || /[\/\\]|\d{5}/u.test(rest)) return false;
  const words = (rest.match(/[a-z]+/giu) || [])
    .filter((word) => word.length > 1 && word.toLowerCase() !== "page");
  return words.length === 0 || (words.length <= 2
    && words.every((word) => /^[A-Z][a-z]{1,15}$/u.test(word) && /[aeiou]/iu.test(word)));
}

export function correctWorldWord(text, zawgyiEvidence = false) {
  return zawgyiEvidence ? text.replace(/\u1000(?:\u101a\u103c\u103c|\u101a\u103c)/gu, "\u1000\u101a\u103c") : text;
}

// ===========================================================================
// PIECE 3 - DECISION
// The one who calls the judgement functions to answer for a whole page.
// It walks the page's lines once, asks PIECE 2 about the raw reading and
// about the ZawCode-swapped candidate, and returns the evidence pack.
// It selects nothing itself - that is PIECE 4's job.
// ===========================================================================

// mm-score evidence over the decoded output itself: how the page reads
// as emitted by the cmap parse, versus how it reads after the ZawCode
// slot swap. The swap candidate is handed in by the caller (the finisher
// owns the ZawCode order function); this module never imports it.
export function judgePageLines(lines, swapCandidate) {
  let originalHasText = false;
  let hasMyanmar = false;
  let aligned = true;
  let candidateChanged = false;
  let candidateAligned = true;
  let count = 0;
  let rawScoreTotal = 0;
  let rawMarks = 0;
  let candidateScoreTotal = 0;
  let candidateMarks = 0;
  for (const text of lines) {
    count += 1;
    const inspected = String(text ?? "").replace(/\u200b/gu, "");
    originalHasText ||= Boolean(inspected.trim());
    hasMyanmar ||= containsMyanmar(inspected);
    aligned &&= markOrderAligned(inspected);
    const candidate = swapCandidate(inspected);
    candidateChanged ||= candidate !== inspected;
    candidateAligned &&= markOrderAligned(candidate);
    if (inspected) {
      // Mm-score judges the readings exactly as emitted - no reordering
      // first, or a crossed page would score as if already fixed.
      const rawReading = scoreText(inspected);
      rawScoreTotal += rawReading.score * rawReading.marks;
      rawMarks += rawReading.marks;
      const candidateReading = scoreText(candidate);
      candidateScoreTotal += candidateReading.score * candidateReading.marks;
      candidateMarks += candidateReading.marks;
    }
  }
  return {
    originalHasText,
    hasMyanmar,
    aligned,
    candidateChanged,
    candidateAligned,
    count,
    rawScore: rawMarks ? rawScoreTotal / rawMarks : 0,
    candidateScore: candidateMarks ? candidateScoreTotal / candidateMarks : 0,
  };
}


// ===========================================================================
// PIECE 4 - LANE
// The ones who actually select the lane, from the judgement. Given the
// evidence pack from PIECE 3 (or the font evidence off the instructions),
// these pick; they do not judge text themselves.
// ===========================================================================

// The cmap lane parsed the page as Zawgyi-One by default and emitted it;
// the finish checks that output exactly three ways:
//   1. it fits the ZawCode swap rule (swap changes the slots, leaves the
//      page aligned, and mm-score strictly improves) -> ZawCode swap;
//   2. it does not fit, but its mark order is violated -> Rabbit;
//   3. its mark order is aligned and no swap fits -> nothing but the
//      Normalize that runs behind every finish in the stream.
export function selectPageDecision(judgment, parsingPath) {
  const zawcodeFit = judgment.candidateChanged && judgment.candidateAligned
    && judgment.candidateScore > judgment.rawScore;
  if (parsingPath === "legacy") return "legacy";
  if (!judgment.hasMyanmar) return "aligned";
  if (zawcodeFit) return "zawcode";
  if (!judgment.aligned) return "rabbit";
  return "aligned";
}

// Lane decision from the outside-stream instructions alone: a page takes
// the legacy lane iff one of its fonts is a registered legacy face
// (isLegacyFontName - the curated registry, not the layout prefix guess,
// which would also bless the modern Unicode font named "Ayar") and that
// face plausibly carries the page's text (details below). Inside the
// legacy lane a font whose own map marks it Unicode or Zawgyi is still
// read through that map, not the codepage, so a legacy entry rarely
// destroys well-mapped fonts. Guards: a CID Unicode face (Type0 +
// isUnicodeFont) means the page's Burmese is Unicode-typeset even when a
// legacy-named resource is also declared; and a two/three-letter base
// name is not evidence - the registry's prefix rule would otherwise call
// any "MS"-style face legacy. Everything else stays on the font-cmap
// lane. The registry is the same one the legacy lane uses internally as
// its layout guard.
export function instructionLane(pageInstruction, sourceEncoding) {
  if (sourceEncoding === "unicode" || sourceEncoding === "zawgyi-one") {
    return { parser: PDF_PARSING_PATHS.FONT_CMAP, reason: "source-encoding" };
  }
  const fonts = pageInstruction?.fonts ?? [];
  const cidUnicodeFace = fonts.some((font) => font.subtype === "Type0"
    && (isUnicodeFont(font.baseFont) || /^myanmar[0-9]/u.test(normaliseFontName(font.baseFont))));
  if (cidUnicodeFace) {
    return { parser: PDF_PARSING_PATHS.FONT_CMAP, reason: "unicode-font" };
  }
  // A CID-keyed Zawgyi face is the modern Zawgyi toolchain: the page is
  // read through its own maps even when a legacy-named resource is present.
  if (fonts.some((font) => font.subtype === "Type0" && normaliseFontName(font.baseFont).startsWith("zawgyi"))) {
    return { parser: PDF_PARSING_PATHS.FONT_CMAP, reason: "cid-zawgyi-font" };
  }
  const legacyFonts = fonts.filter((font) => normaliseFontName(font.baseFont).length >= 4
    && isLegacyFontName(font.baseFont));
  // A legacy-named font that ships no ToUnicode while a mapped font on
  // the page does is not the page's text carrier (it typesets
  // headers/Latin); the legacy reading only applies when the legacy font
  // carries its own map, or no mapped non-Zawgyi font is present. A
  // mapped Zawgyi companion does not count: legacy books mix both.
  const legacyApplies = legacyFonts.some((font) => font.toUnicode)
    || !fonts.some((font) => font.toUnicode && !normaliseFontName(font.baseFont).startsWith("zawgyi"));
  if (legacyFonts.length > 0 && legacyApplies) {
    return {
      parser: PDF_PARSING_PATHS.LEGACY,
      reason: "legacy-font",
      fonts: legacyFonts.map((font) => font.baseFont),
    };
  }
  return {
    parser: PDF_PARSING_PATHS.FONT_CMAP,
    reason: fonts.length > 0 ? "no-legacy-evidence" : "no-fonts",
  };
}


// The Unicode-lane decisions, for consumers eligibility checks (the PDF
// stream's beautify gate asks this instead of keeping its own copy).
export const UNICODE_LANE_DECISIONS = new Set(["aligned", "zawcode", "unaligned-unicode"]);

export function isUnicodeLaneDecision(decision, category) {
  return UNICODE_LANE_DECISIONS.has(decision) || category === "UNICODE";
}


// ===========================================================================
// TEXT KEEPING (not lane machinery)
// Inherited from the deleted normalize.js: zero-width/format-character
// preservation and the line-by-line Engine-normalize plumbing. These stay
// in this file only because this module already held them; they judge
// nothing and select nothing.
// ===========================================================================

// --- normalize.js functions (moved here; normalize.js deleted) ---

const FORMAT_CHARACTER = /^\p{Cf}$/u;
const WHITESPACE = /^\s$/u;
const ZERO_WIDTH_SPACE = "\u200b";

function needsProtection(ch) {
  if (ch === ZERO_WIDTH_SPACE) return false;
  return WHITESPACE.test(ch) || FORMAT_CHARACTER.test(ch);
}

function isFormatCharacter(ch) {
  return ch !== ZERO_WIDTH_SPACE && (ch === "\u034f" || FORMAT_CHARACTER.test(ch));
}

export function protectedCharacters(value) {
  let out = "";
  for (const ch of String(value ?? "")) {
    if (needsProtection(ch)) out += ch;
  }
  return out;
}

export function preserveCharacters(text, transform) {
  const input = String(text ?? "");
  if (typeof transform !== "function") throw new TypeError("Expected a text transformation");
  let hasProtected = false;
  for (const ch of input) {
    if (isFormatCharacter(ch)) { hasProtected = true; break; }
  }
  if (!hasProtected) return transform(input);

  let prefix = "\ue000";
  while (input.includes(prefix)) prefix += "\ue000";
  const suffix = "\ue001";
  const preserved = [];
  let masked = "";
  for (const ch of input) {
    if (isFormatCharacter(ch)) {
      masked += `${prefix}${preserved.length}${suffix}`;
      preserved.push(ch);
    } else masked += ch;
  }

  const transformed = transform(masked);
  const pattern = new RegExp(`${prefix}([0-9]+)${suffix}`, "gu");
  let restored = 0;
  const result = transformed.replace(pattern, (token, index) => {
    const value = preserved[Number(index)];
    if (value === undefined) return token;
    restored += 1;
    return value;
  });
  if (restored !== preserved.length) throw new Error("Text transformation could not preserve zero-width characters");
  return result;
}

export function* normalizePageLines(text, normalize) {
  if (typeof normalize !== "function") throw new TypeError("Expected Engine normalize function");
  const input = String(text ?? "");
  let start = 0;
  while (true) {
    const end = input.indexOf("\n", start);
    if (end < 0) {
      yield normalize(input.slice(start));
      return;
    }
    yield normalize(input.slice(start, end));
    start = end + 1;
  }
}

export function normalizeOutputText(text, normalize) {
  return [...normalizePageLines(text, normalize)].join("\n");
}


// FILE: decoding/runtime.js
/*
(PDF 5) PDF branch, position 5 in the chain - after the runner is created (PDF 4), before the PDF stream runs (PDF 6). Shared with the DOCX branch.
This module is the source runner: it loads the input bytes, runs the PDF or DOCX stream, collects the finished pages, and writes the output.
*/
import { getEngineNormalize, getLogen } from "../../_path.js";
const { installPassiveLog } = (await getLogen()).siteLog;
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { processDocxForMethod, buildFinalPages } from "./source-decoding.js";
import { writeOutput } from "../io/write.js";
import { PosScanner } from "../beautify/scan.js";
import { PageStoreWriter } from "../io/emit.js";
import { repairTextWithPos, repairFromPosVerdict } from "../beautify/repair.js";
import { orderZawCodePages } from "../zawcode-order.js";
import { normalizeOutputText } from "./judgement.js";
import { runPdfStream } from "../pdf/pdf-stream.js";

import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../limits/local.js";
import { REGISTER_LOG } from "../../_path.js";
import { startRecord, note, appendRecord, registerPath } from "../provenance.js";






installPassiveLog({
  file: process.env.LOG_FILE || "",
  checks: /^(1|true|on|yes)$/i.test(String(process.env.LOG_CHECKS ?? "")),
});

async function beautifyPages(pages, eligible = () => true) {
  const totals = { pages: 0, repairs: 0, splits: 0 };
  const repairedPages = [];
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const text = page?.text || "";
    if (!eligible(index) || !text) { repairedPages.push(page); continue; }
    const repaired = await repairTextWithPos(text);
    if (repaired.text === text) { repairedPages.push(page); continue; }
    totals.pages += 1;
    for (const item of repaired.repairs) totals.repairs += item.count;
    for (const item of repaired.splits || []) totals.splits += item.count;
    repairedPages.push({ ...page, text: repaired.text });
  }
  return { pages: repairedPages, totals };
}

export function loadBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}













export function createSourceRunner({ kind, docxImages = false, pdfImages = false }) {
  return async function runSource(msg = {}) {
    const {
      filename, data, inPath, outPath,
    } = msg;
    if (kind === "pdf") {
      // Default converter behavior for PDF: parse the text layer and
      // extract image pages for the separate OCR worker. The converter
      // never performs OCR itself and never re-embeds images.
      return runPdfStream(msg, {
        manual: false, pdfImages,
      });
    }
    let imageDir = null;
    const bytes = loadBytes({ inPath, data });
    const name = filename ?? (inPath ? path.basename(inPath) : null);



    const provenance = startRecord(name ?? inPath ?? "");
    const options = docxImages
      ? (imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"))) && { imageDir, provenance }
      : { provenance };
    options.sourceEncoding = msg.sourceEncoding ?? "auto";
    let job;
    try {
      job = await processDocxForMethod(
        bytes,
        "default",
        name ?? null,
        () => {},
        options,
      );
    } catch (error) {
      if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
      throw error;
    }
    if (imageDir && !job.imageFiles?.length) {
      fs.rmSync(imageDir, { recursive: true, force: true });
      imageDir = null;
    }




    if (!outPath) return { result: job };

    try {
      const chosenPath = provenance?.codepage?.chosen ?? job.encodingPath ?? null;
      const isDraft = provenance?.codepage?.draft === true;
      const pageLocal = job.pageLocalDecoding === true;
      const applyCleanup = msg.applyCleanup !== false;
      const finalPages = buildFinalPages(job, applyCleanup);
      // Already-finalized PDF pages never run this document-wide repair path.
      const eligible = (index) => !pageLocal && job.reports[index]?.category !== "UNKNOWN";
      const { pages: repairedPages, totals: repairTotals } = applyCleanup && !isDraft && !pageLocal
        ? await beautifyPages(finalPages, eligible)
        : { pages: finalPages, totals: { pages: 0, repairs: 0, splits: 0 } };
      let scanRepairedPages = repairedPages;
      if (!isDraft && !pageLocal && applyCleanup && chosenPath === "zawcode") {
        scanRepairedPages = [];
        for (let index = 0; index < repairedPages.length; index += 1) {
          const page = repairedPages[index];
          const fixed = eligible(index)
            ? await repairFromPosVerdict([page], { path: chosenPath, preserveZawCodeOrder: true })
            : [page];
          scanRepairedPages.push(fixed[0]);
        }
      }
      const orderedPages = !isDraft && !pageLocal && applyCleanup && chosenPath === "zawcode"
        ? orderZawCodePages(scanRepairedPages, {}, { path: chosenPath })
        : scanRepairedPages;
      const pages = orderedPages.map((page, index) => eligible(index) ? page : finalPages[index]);
      const scanRepairPages = pages.reduce(
        (n, page, i) => n + ((page?.text || "") !== (repairedPages[i]?.text || "") ? 1 : 0),
        0,
      );
      const scanRepaired = scanRepairPages
        ? { scanRepair: { path: chosenPath, pages: scanRepairPages } }
        : {};
      const repaired = repairTotals.repairs || repairTotals.splits ? { repair: repairTotals } : {};
      note(provenance, {
        detection: job.counts,
        output: outPath,
        ...repaired,
        ...scanRepaired,
      });
      const common = {
        filename: name ?? null,
        counts: job.counts,
        encodingPath: chosenPath,
        ...(msg.includePreview ? { metadata: job.metadata ?? {}, changes: job.changes ?? [] } : {}),
        ...(job.imageFiles ? { imageFiles: job.imageFiles, imageDir } : {}),
        ...(job.linearizationError ? { linearizationWarning: job.linearizationError } : {}),
        ...(job.pageWarnings?.length ? { pageWarnings: job.pageWarnings } : {}),
        ...repaired,
        ...scanRepaired,
      };
      if (msg.deferImageOutput && job.imageFiles?.length) {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "linga-docx-images-"));
        let store;
        try {
          store = new PageStoreWriter(directory, "source");
          for (const page of pages) store.addPage({ text: [page.text || ""] });
          store.close();
          return {
            ...common, pages: pages.length, deferredDocx: true,
            internalDocx: { directory, pageStore: store.store }, provenance,
          };
        } catch (error) {
          store?.close();
          fs.rmSync(directory, { recursive: true, force: true });
          if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
          throw error;
        }
      }
      const normalize = await getEngineNormalize();
      const outputPages = pages.map((page) => ({
        ...page, text: normalizeOutputText(page.text || "", normalize),
      }));
      const scanner = new PosScanner();
      try {
        // DOCX chunks contain 80 paragraphs each; they are not physical pages.
        for (const page of outputPages) await scanner.writePage(null, [page.text]);
        const written = await writeOutput(outPath, outputPages, {
          counts: job.counts, source: name ?? "", includeText: msg.includeText === true,
        });
        const posScan = await scanner.finish();
        appendRecord(provenance, { file: registerPath(REGISTER_LOG) });
        return { ...common, pages: pages.length, ...written, posScan };
      } finally {
        await scanner.close();
      }
    } catch (error) {
      if (imageDir) fs.rmSync(imageDir, { recursive: true, force: true });
      throw error;
    }
  };
}


// FILE: decoding/runtime/detect.js
/*
(PDF 24) PDF branch, position 24 in the chain - small shared helper of the lane decision and finishing (PDF 10, PDF 19).
This module answers simple questions about text and font names: does this text contain Myanmar, is this font a Zawgyi-One face or a known Unicode face.
*/
import { normaliseFontName } from "./codepage/codepage-names.js";

const MYANMAR = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/u;

export function containsMyanmar(text) {
  return MYANMAR.test(String(text ?? ""));
}

export function isZawgyiOneFont(name) {
  const normalized = normaliseFontName(name);
  return normalized === "zawgyione" || normalized === "zawgyi";
}

// Exact family/full names cross-checked against the local font witnesses.
// This does not identify a keyboard or validate PDF character-code mappings.
const UNICODE_FACES = new Set([
  "tharlon", "myanmar3", "myanmar3paoh", "padauk", "padaukregular",
  "pyidaungsu", "yunghkio", "myanmartext",
]);

export function isUnicodeFont(name) {
  return UNICODE_FACES.has(normaliseFontName(name));
}

export function hasOnlyUnicodeFonts(fontNames) {
  const names = fontNames ? [...fontNames] : [];
  return names.length > 0 && names.every(isUnicodeFont);
}

// Only fonts actually used for Myanmar characters count. A missing or mixed
// face is inconclusive: shared code points cannot identify the encoding.
export function hasOnlyZawgyiFonts(fontNames) {
  const names = fontNames ? [...fontNames] : [];
  return names.length > 0 && names.every(isZawgyiOneFont);
}



// FILE: decoding/runtime/docx.js
/*
(DOCX 4) DOCX branch, position 4 in the chain - after the worker entry (PDF 1) routes a DOCX job here.
This module is the converter-side DOCX entry point. It simply calls the default DOCX runner (DOCX 5).
*/
import { runDocxWorker } from "./docx.js";

// Converter-side DOCX entry. There is no manual/image-mode split here any
// more: the default converter runner detects and extracts referenced images
// for the separate OCR worker, and never re-embeds images into the output.
export async function runFromDocx(msg = {}) {
  return runDocxWorker(msg);
}


// FILE: decoding/runtime/pdf.js
/*
(PDF 4) PDF branch, position 4 in the chain - after the converter-side entry (PDF 3).
This module creates the single default PDF converter runner (PDF 5) with image-page extraction turned on.
*/
import { createSourceRunner } from "./runtime.js";

// Single default PDF converter runner. Image pages are detected and
// extracted by default (pdfImages) so the separate OCR worker can read
// them; the converter output itself stays text/layout only.
export const runPdfWorker = createSourceRunner({
  kind: "pdf",
  pdfImages: true,
});


// FILE: decoding/source-decoding.js
/*
(PDF 10) PDF branch, position 10 in the chain - after the file is prepared (PDF 6 to 9), before output is written (PDF 31).
This module is the page-by-page orchestrator: it discovers the pages, decides each page's decoding lane from the page instructions (PDF 11), extracts the text (PDF 13), finishes each page (PDF 19), and turns pages into final records.
*/
import { renderPdfPagePng } from "../pdf/pdf-render.js";
import { note } from "../provenance.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts } from "../detect.js";
import { isEncryptedPdf, hasObjectStreams, scanPdfFileMarkers } from "../../init/pdf/decrypt.js";
import { Rabbit } from "../rabbit.js";
import { orderText } from "../clean.js";
import { preserveCharacters, instructionLane } from "./praised/judgement.js";
export { instructionLane };
import { extractDocxParagraphs, validateDocxArchive } from "../docx/docx-extract.js";
import { extractDocxParagraphsExternal } from "../docx/docx-external.js";
import { scoreText } from "./praised/judgement.js";
import { countImpossiblePairs } from "../beautify/scan.js";
import { WININNWA_LEGACY_CODE_PAGE } from "../codepage/codepage-registry.js";
import { MAX_PAGES, MAX_TEXT_CHARS } from "../limits/local.js";
import {
  MAX_PDF_OBJECTS, extractPageLines, pageHasImages, extractMetadata,
} from "../io/read.js";
import { PdfFileObjects, openPdfScannedObjects } from "../pdf/pdf-objects.js";
import { decodePdfInstructions } from "../pdf/page-instructions.js";
import { PdfPagePieces } from "../pdf/pdf-pages.js";
import {
  cleanupUnicodeText as cleanupUnicode, convertFinalizedPageText,
  finishPageToFile, orderUnicodeText as orderUnicode, pageLayoutLines,
} from "./praised/finalized-cmap.js";
import { DocumentDecoding, PDF_PARSING_PATHS, legacyLayoutForFont, pageFontDecoders } from "../pdf/pdf-fonts.js";
import { pyRound, RuntimeError, baseName } from "../pylib.js";
import { agentAdvisory } from "../../../Architecture/host/advisory.js";

const PARSER_CHAIN_DOOR = "ParserManager";

function adviseParserMiddleChain(api) {
  if (process.env.MYANGUSTIS_CHAIN_DOOR === PARSER_CHAIN_DOOR) return;
  agentAdvisory(
    "parser-middle-chain",
    `[Parser agent advisor] STOP: B.Parser/core/decoding/source-decoding.js:${api}() is a middle-chain API, not the Parser chain door. `
      + "Start from B.Parser/index.js (Manager.dispatchStream/Manager.dispatch) or "
      + "tools-box/js/pipeline-cli.js parser local, and report only that front-door behavior. "
      + "Calling pipeline/text/read helpers directly skips Manager spooling, worker preparation, output/POS sidecars and cleanup options.",
  );
}

export function streamPdfPages(source, log = () => {}, {
  provenance = null, sourceEncoding = "auto", onPageContent = null, onPagePrefix = null, scratchDir = null,
  diskPages = false, layoutPages = false,
} = {}) {
  adviseParserMiddleChain("streamPdfPages");
  const fileBacked = typeof source === "string";
  if (diskPages && !fileBacked) throw new TypeError("Disk-backed PDF pages require a prepared PDF file path");
  const input = fileBacked ? null : (Buffer.isBuffer(source) ? source : Buffer.from(source));
  const size = fileBacked ? fs.statSync(source).size : input.length;
  log(`[+] PDF size: ${size.toLocaleString("en-US")} bytes`);
  const markers = fileBacked ? scanPdfFileMarkers(source)
    : { encrypted: isEncryptedPdf(input), objectStreams: hasObjectStreams(input) };
  if (markers.encrypted) {
    throw new RuntimeError("This PDF is password-protected; decrypt it before extraction.");
  }
  if (markers.objectStreams) {
    throw new RuntimeError(
      "This PDF stores objects in object streams (/ObjStm); expand them before extraction "
        + "(the PDF worker prepares the file automatically).",
    );
  }
  const scanned = fileBacked ? null : openPdfScannedObjects(input, { maxObjects: MAX_PDF_OBJECTS });
  const objects = fileBacked ? new PdfFileObjects(source, { maxObjects: MAX_PDF_OBJECTS }) : scanned.objects;
  const closeObjects = () => { if (scanned) scanned.close(); else objects.close(); };
  let metadata;
  let instructionPages;
  try {
    metadata = extractMetadata(objects, fileBacked ? objects.trailer : input);
    // Page order, geometry, font chains and content references come from
    // the outside-stream instruction pass (page-instructions.js): the
    // document is discovered from dictionaries alone, before any stream
    // is opened. The instruction walk enforces the page cap itself.
    const instructions = decodePdfInstructions(objects);
    if (!instructions.rootPages) throw new RuntimeError("No page tree found in the PDF.");
    instructionPages = instructions.pages;
  } catch (error) {
    closeObjects();
    throw error;
  }
  const npages = instructionPages.length;
  let workDir = scratchDir;
  let ownsScratch = false;
  let pieceStore = null;
  try {
    if (!workDir) {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-pdf-pages-"));
      ownsScratch = true;
    }
    pieceStore = new PdfPagePieces(workDir);
  } catch (error) {
    closeObjects();
    if (ownsScratch) fs.rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
  note(provenance, { metadata, pages: npages, decoding: { scope: "page/font resource" } });
  log(`[+] Total pages: ${npages}; decoding by font resource`);

  const shared = new DocumentDecoding("font");
  // An explicit Zawgyi request must not be reinterpreted as Unicode glyphs.
  shared.visualUnicodeEnabled = sourceEncoding !== "zawgyi-one";
  // The legacy lane's document-level fallback layout is WinInnwa: per-
  // resource layouts are guarded by font name inside the lane
  // (legacyLayoutForFont) — Ayar-set faces get Ayar, unknown faces stay
  // on WinInnwa and are flagged for the cleaning stage's next module.
  const legacy = new DocumentDecoding("legacy", new Map(), WININNWA_LEGACY_CODE_PAGE);
  const sharedFontKinds = new WeakMap();
  shared.fontKind = (font) => {
    if (sharedFontKinds.has(font)) return sharedFontKinds.get(font);
    // Font names never classify a resource. The only evidence is the
    // caller's explicit encoding, or what the font's own ToUnicode map
    // actually outputs (multi-character Myanmar clusters read as Unicode).
    let kind = "UNKNOWN";
    if (sourceEncoding === "unicode") kind = "UNICODE";
    else {
      const clusters = font.toUnicode && !font._conflictingSpaceMap
        ? [...font.toUnicode.values()].filter((value) => [...value].length > 1 && containsMyanmar(value)).length : 0;
      if (clusters >= 4) kind = "UNICODE";
    }
    sharedFontKinds.set(font, kind);
    return kind;
  };
  legacy.fontKind = (font) => font.needsLegacyTextFix ? "UNICODE" : shared.fontKind(font);

  let activeText = null;
  const close = () => {
    activeText?.close();
    activeText = null;
    pieceStore?.close();
    closeObjects();
    if (ownsScratch) fs.rmSync(workDir, { recursive: true, force: true });
  };

  function* generate() {
    try {
    for (let idx = 0; idx < npages; idx += 1) {
      const pageInstruction = instructionPages[idx];
      const [pnum, pgen] = [pageInstruction.num, pageInstruction.gen];
      const laneChoice = instructionLane(pageInstruction, sourceEncoding);
      const fontNames = new Set();
      const fontKinds = new Set();
      const usedLegacyFonts = new Set();
      let legacyUnknownFonts = [];
      let parsingPath = PDF_PARSING_PATHS.FONT_CMAP;
      let checkpoint = null;
      let confirmedRepair = null;
      let visualGlyphRecovery = false;
      let unresolvedVisualGlyph = false;
      const [extractedLines, w, h, images] = extractPageLines(objects, pnum, pgen, shared, {
        pageBox: pageInstruction.size,
        scratchDir: workDir,
        pieceStore,
        usedMyanmarFonts: fontNames,
        usedFontKinds: fontKinds,
        usedLegacyFonts,
        inspectPrefix: (prefix, sharedFonts, loader) => {
          if (legacy.loader !== loader) {
            legacy.loader = loader;
            legacy.resetFontCache();
          }
          // The lane is decided by the outside-stream instructions for
          // this page (see instructionLane above); no sample of the
          // page's shown text is decoded to choose it.
          legacy.legacyFontNames = null;
          legacy.legacyResources = null;
          parsingPath = laneChoice.parser;
          checkpoint = {
            reason: laneChoice.reason,
            ...(laneChoice.fonts ? { fonts: laneChoice.fonts } : {}),
          };
          onPagePrefix?.(idx, prefix, parsingPath, checkpoint);
          if (parsingPath !== PDF_PARSING_PATHS.LEGACY) return shared;
          const legacyFonts = pageFontDecoders(loader, pnum, pgen, legacy);

          // Inside the legacy lane the font name is only a layout guard:
          // profile-matched resources, name-guarded legacy faces, and any
          // other simple face (unknown faces parse with Ayar) are read with
          // the legacy layouts; CID faces keep their own cmap decoding.
          const selected = new Set([...sharedFonts]
            .filter(([, font]) => !font.isCid
              && (font.parsingPath === PDF_PARSING_PATHS.LEGACY
                || legacyLayoutForFont(font.baseFont)))
            .map(([name]) => name));
          // Selection is per PDF resource, not a family-wide byte map. Two
          // resources with the same display name can have different encodings.
          legacy.legacyResources = new Set([...selected].map((name) => legacyFonts.get(name)).filter(Boolean));
          // Unknown legacy faces parse with WinInnwa above; record them so
          // the cleaning stage can route them to its next module.
          legacyUnknownFonts = [...selected]
            .filter((name) => {
              const font = sharedFonts.get(name);
              return font && !legacyLayoutForFont(font.baseFont).known
                && !["UNICODE", "ZAWGYI"].includes(shared.fontKind(font));
            })
            .map((name) => sharedFonts.get(name)?.baseFont || name);
          // The selected page parser may still encounter a Unicode or
          // Zawgyi resource later. Read that resource's own encoding rather
          // than interpreting its PDF codes as WinInnwa; conversion remains
          // a single page-level decision and mixed pages are reported below.
          for (const [name, font] of sharedFonts) {
            if (["UNICODE", "ZAWGYI"].includes(shared.fontKind(font))) legacyFonts.set(name, font);
          }
          return legacy;
        },
        onPageContent: (streams, references, loader, spool) => onPageContent?.(idx, streams, references, loader, spool),
        onVisualGlyphRecovery: ({ changed, unresolved }) => {
          visualGlyphRecovery ||= changed;
          unresolvedVisualGlyph ||= unresolved;
        },
        onConfirmedRepair: ({ before, after, summary }) => {
          confirmedRepair = summary ?? {
            changedLines: countDiffLines(before, after),
            impossibleBefore: countImpossiblePairs(before),
            impossibleAfter: countImpossiblePairs(after),
          };
        },
      });
      const finishedPage = finishPageToFile(extractedLines, {
        directory: workDir, parsingPath, sourceEncoding, fontKinds,
      });
      const finished = { decision: finishedPage.decision };
      const { category, originalHasText } = finishedPage;
      let text;
      let lines;
      if (diskPages) {
        text = activeText = finishedPage.text;
        lines = layoutPages ? {
          [Symbol.iterator]: () => pageLayoutLines(extractedLines, text, finishedPage.lineCount),
        } : undefined;
      } else {
        try {
          text = [...finishedPage.text.chunks()].join("");
          lines = [...pageLayoutLines(extractedLines, finishedPage.text, finishedPage.lineCount)];
        } finally { finishedPage.text.close(); }
      }
      const warnings = [];
      if (visualGlyphRecovery) {
        warnings.push({ code: "unicode-glyph-recovery-needs-review", page: idx + 1 });
      }
      if (unresolvedVisualGlyph) {
        warnings.push({ code: "unicode-glyph-mapping-needs-review", page: idx + 1 });
      }
      if (parsingPath === PDF_PARSING_PATHS.FONT_CMAP && usedLegacyFonts.size) {
        warnings.push({ code: "legacy-font-on-shared-page", page: idx + 1, fonts: [...usedLegacyFonts] });
      }
      if (parsingPath === PDF_PARSING_PATHS.LEGACY && fontKinds.has("ZAWGYI")) {
        warnings.push({ code: "zawgyi-font-on-legacy-page", page: idx + 1 });
      }
      if (parsingPath === PDF_PARSING_PATHS.LEGACY && legacyUnknownFonts.length) {
        warnings.push({ code: "legacy-unknown-font", page: idx + 1, fonts: legacyUnknownFonts });
      }
      if (finished.decision === "unaligned-unicode") {
        warnings.push({ code: "unicode-order-needs-review", page: idx + 1 });
      } else if (finished.decision === "unaligned-unknown") {
        warnings.push({ code: "encoding-order-needs-review", page: idx + 1 });
      } else if (finished.decision === "unaligned-zawgyi") {
        warnings.push({ code: "conversion-characters-need-review", page: idx + 1 });
      }
      shared._pageFonts.delete(`${pnum},${pgen}`);
      legacy._pageFonts.delete(`${pnum},${pgen}`);
      const result = {
        idx, lines, wh: [w, h], text, lineCount: finishedPage.lineCount,
        hasImg: images.length > 0 || pageHasImages(objects, pnum, pgen), images,
        decodeKind: parsingPath, perFont: true, pageFinalized: true, category,
        parsingPath, decision: finished.decision, fontNames, fontKinds, checkpoint,
        ...(confirmedRepair ? { confirmedRepair } : {}),
        ...(warnings.length ? { warnings } : {}),
      };
      if (idx + 1 === npages && !diskPages) close();
      yield result;
      activeText?.close();
      activeText = null;
      if ((idx + 1) % 500 === 0) log(`    ... extracted ${idx + 1}/${npages} pages`);
    }
    } finally {
      close();
    }
  }
  const pages = generate();
  const stop = pages.return.bind(pages);
  pages.return = (value) => {
    try { return stop(value); } finally { close(); }
  };
  return [metadata, npages, pages];
}


const orderZawgyi = (text) => preserveCharacters(text, (part) => orderText(Rabbit.zg2uni(part)));

export function cleanupFor(cat, text) {
  return cat === "UNICODE" ? cleanupUnicode(text) : null;
}


function convertLine(t, cat, applyCleanup) {
  if (cat === "ZAWGYI") return orderZawgyi(t);
  if (cat === "UNICODE") return applyCleanup ? cleanupUnicode(t) : orderUnicode(t);
  return orderText(t);
}
function convLines(lines, cat, applyCleanup) {
  return lines.map(([x, y, size, t]) => [x, y, size, convertLine(t, cat, applyCleanup)]);
}


export function countDiffLines(base, clean) {
  const bl = base.split("\n");
  const cl = clean.split("\n");
  const n = Math.max(bl.length, cl.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if ((i < bl.length ? bl[i] : "") !== (i < cl.length ? cl[i] : "")) count += 1;
  }
  return count;
}


export function processPageRecord(pg, applyCleanup, log = () => {}, wantLayout = false, sourceEncoding = "auto") {
  adviseParserMiddleChain("processPageRecord");
  const idx = pg.idx;
  const raw = pg.text;
  if (pg.perFont) {
    const kinds = pg.fontKinds || new Set();
    const cat = pg.category ?? (kinds.size === 1 ? [...kinds][0] : "UNKNOWN");
    const finalized = pg.pageFinalized === true;
    const text = finalized && typeof raw === "string"
      ? convertFinalizedPageText(raw, pg, applyCleanup !== false) : raw;
    const rep = { page: idx + 1, category: cat, prob: cat === "ZAWGYI" ? 1 : 0,
      text, nChanges: typeof raw === "string" && text !== raw ? countDiffLines(raw, text) : 0,
      perFont: true, pageFinalized: finalized,
      scanEligible: !finalized && kinds.size > 0 && !kinds.has("UNKNOWN"),
      ...(pg.decision === "zawcode" ? { textPath: "zawcode" } : {}),
      ...(pg.checkpoint ? { checkpoint: pg.checkpoint } : {}),
      ...(pg.confirmedRepair ? { confirmedRepair: pg.confirmedRepair } : {}),
      ...(pg.warnings?.length ? { warnings: pg.warnings } : {}) };
    if (wantLayout) {
      rep.lines = finalized && Array.isArray(pg.lines)
        ? pg.lines.map(([x, y, size, line]) => [x, y, size,
          convertFinalizedPageText(line, pg, applyCleanup !== false)])
        : pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
      rep.images = pg.images;
      rep.parsingPath = pg.parsingPath;
    }
    return rep;
  }
  // No detector: the category is whatever the per-page parsing decided
  // (2 KB checkpoint -> page parser -> page decision/category). A record
  // that carries no category from that parsing is UNKNOWN and passes
  // through; font names alone never classify it here.
  const [category, prob] = sourceEncoding === "auto" && pg.legacyDecoded
    ? ["UNICODE", 0]
    : [pg.category ?? "UNKNOWN", pg.category === "ZAWGYI" ? 1 : 0];
  let cat = String(category).toUpperCase();
  if (cat === "OTHER") cat = "UNKNOWN";
























  if (cat === "ZAWGYI" && sourceEncoding !== "zawgyi-one"
    && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
    const asUnicode = scoreText(orderText(raw));
    const asZawgyi = scoreText(orderText(Rabbit.zg2uni(raw)));
    if (asUnicode.marks >= 50 && asZawgyi.score - asUnicode.score >= 0.03) {
      log(`    Page ${idx + 1}: zawgyi-cmap path -- decoded from the font's own `
        + `${pg.decodeKind} table but still Zawgyi: Rabbit reading scores `
        + `${asZawgyi.score.toFixed(3)} vs ${asUnicode.score.toFixed(3)} as Unicode`);
    } else {
      cat = "UNICODE";
      log(`    Page ${idx + 1}: unicode path -- ${category} verdict overridden; `
        + `decoded from the font's own ${pg.decodeKind} table and reads as itself `
        + `(${asUnicode.score.toFixed(3)} vs ${asZawgyi.score.toFixed(3)} converted), `
        + `so this is Unicode in drawing order, not Zawgyi`);
    }
  }

  if (cat === "UNKNOWN") {



    const rep = {
      page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, text: raw, nChanges: 0,
    };
    if (wantLayout) {
      rep.lines = pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
    }
    log(`    Page ${idx + 1}: UNKNOWN -> passed through`);
    return rep;
  }

  let base;
  if (cat === "ZAWGYI") {
    base = orderZawgyi(raw);
    if (hasOnlyZawgyiFonts(pg.fontNames) && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
      log(`    Page ${idx + 1}: zawgyi-cmap path -- Zawgyi-One font evidence -> converted`);
    } else {
      log(`    Page ${idx + 1}: ZAWGYI (font/source evidence) -> converted`);
    }
  } else {
    base = orderUnicode(raw);
    log(`    Page ${idx + 1}: UNICODE (source evidence) -> kept`);
  }

  const clean = cleanupFor(cat, base);
  const nChanges = clean === null || clean === base ? 0 : countDiffLines(base, clean);
  const text = applyCleanup && clean !== null ? clean : base;
  const rep = {
    page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, text, nChanges,
  };
  if (wantLayout) {
    rep.lines = convLines(pg.lines, cat, applyCleanup);
    rep.wh = pg.wh;
    rep.hasImg = pg.hasImg;
  }
  return rep;
}


export function collectChanges(reports) {
  const changes = [];
  for (const rep of reports) {
    if (rep.clean === null) continue;
    const baseLines = rep.base.split("\n");
    const cleanLines = rep.clean.split("\n");
    for (let li = 0; li < Math.max(baseLines.length, cleanLines.length); li += 1) {
      const bl = li < baseLines.length ? baseLines[li] : "";
      const cl = li < cleanLines.length ? cleanLines[li] : "";
      if (bl !== cl) {
        changes.push({
          id: `p${rep.page}-l${li + 1}`,
          page: rep.page,
          line: li + 1,
          category: rep.category,
          original: bl,
          suggested: cl,
        });
      }
    }
  }
  return changes;
}

export function collectPdfResult(reportsIter, npages, filename = "upload.pdf") {
  adviseParserMiddleChain("collectPdfResult");
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  const pagePaths = new Set();
  const pageWarnings = [];
  let textChars = 0;
  for (const rep of reportsIter) {
    const cat = rep.category;
    const base = rep.text;
    textChars += base.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
    const clean = rep.perFont ? null : cleanupFor(cat, base);
    if (rep.parsingPath === PDF_PARSING_PATHS.LEGACY) pagePaths.add("wininnwa");
    else if (rep.textPath) pagePaths.add(rep.textPath);
    else if (cat === "ZAWGYI") pagePaths.add("zawgyi-one");
    else if (cat === "UNICODE") pagePaths.add("unicode");
    if (rep.warnings) pageWarnings.push(...rep.warnings);
    reports.push({ page: rep.page, category: cat, prob: rep.prob, base, clean,
      ...(rep.perFont ? { scanEligible: rep.scanEligible, pageFinalized: rep.pageFinalized } : {}),
      ...(rep.textPath ? { textPath: rep.textPath } : {}),
      ...(rep.checkpoint ? { checkpoint: rep.checkpoint } : {}),
      ...(rep.confirmedRepair ? { confirmedRepair: rep.confirmedRepair } : {}),
      ...(rep.warnings ? { warnings: rep.warnings } : {}) });
    pages.push({ text: base, lines: rep.lines, wh: rep.wh, hasImg: rep.hasImg,
      images: rep.images, parsingPath: rep.parsingPath });
    counts[cat] = (counts[cat] ?? 0) + 1;
  }
  const changes = collectChanges(reports);
  const encodingPath = pagePaths.size === 1 ? [...pagePaths][0] : null;
  return {
    filename, kind: "pdf", reports, counts, metadata: {}, changes, pages, npages,
    pageLocalDecoding: true,
    ...(encodingPath ? { encodingPath } : {}),
    ...(pageWarnings.length ? { pageWarnings } : {}),
  };
}




export const DOCX_CHUNK_PARAGRAPHS = 80;

export function chunkParagraphs(paragraphs, perChunk = DOCX_CHUNK_PARAGRAPHS) {
  if (!paragraphs.length) return [""];
  const out = [];
  for (let i = 0; i < paragraphs.length; i += perChunk) {
    out.push(paragraphs.slice(i, i + perChunk).join("\n"));
  }
  return out;
}


function buildDocxJob(paragraphs, filename, log, sourceEncoding = "auto", fontNamesByParagraph = null) {
  const reports = [];
  const pages = [];
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  let textChars = 0;
  for (const paragraph of paragraphs) {
    textChars += paragraph.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new RuntimeError(`Extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
    }
  }
  const chunks = chunkParagraphs(paragraphs);
  if (chunks.length > MAX_PAGES) {
    throw new RuntimeError(`DOCX exceeds the ${MAX_PAGES} chunk cap`);
  }
  chunks.forEach((chunk, idx) => {
    const fontNames = new Set();
    for (const names of fontNamesByParagraph?.slice(idx * DOCX_CHUNK_PARAGRAPHS, (idx + 1) * DOCX_CHUNK_PARAGRAPHS) ?? []) {
      for (const name of names) fontNames.add(name);
    }
    // OCR placeholders are internal and are not evidence about the DOCX's
    // source encoding or its keyboard/font.
    const detectionText = chunk.replace(/\uE000OCR-[0-9a-f-]{36}-\d+\uE001/gu, "");
    // No detector: classify the chunk from the evidence in hand — explicit
    // source encoding first, then the chunk's own font faces. Anything else
    // stays UNKNOWN and passes through unconverted.
    let category = "UNKNOWN";
    let prob = 0;
    if (containsMyanmar(detectionText)) {
      if (sourceEncoding === "zawgyi-one") { category = "ZAWGYI"; prob = 1; }
      else if (sourceEncoding === "unicode") category = "UNICODE";
      else if (hasOnlyZawgyiFonts(fontNames)) { category = "ZAWGYI"; prob = 1; }
      else if (hasOnlyUnicodeFonts(fontNames)) category = "UNICODE";
    }
    let cat = String(category).toUpperCase();
    if (cat === "OTHER") cat = "UNKNOWN";
    // For actual DOCX text, a known Unicode face is enough to keep the stored
    // code points, but does not prove which keyboard produced them.
    const fontUnicode = sourceEncoding === "auto" && hasOnlyUnicodeFonts(fontNames);
    const base = cat === "ZAWGYI" ? orderZawgyi(chunk)
      : cat === "UNICODE" ? (fontUnicode ? chunk : orderUnicode(chunk)) : chunk;
    const clean = cleanupFor(cat, base);
    reports.push({ page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, base, clean });
    pages.push({ text: base });
    counts[cat] = (counts[cat] ?? 0) + 1;
    log(`    Chunk ${idx + 1}: ${cat}`);
  });

  return {
    filename,
    kind: "docx",
    reports,
    counts,
    metadata: {},
    changes: collectChanges(reports),
    pages,
    paragraphs,
  };
}
export function processDocxBytes(data, filename = "upload.docx", log = () => {}, { imageDir = null, sourceEncoding = "auto" } = {}) {
  adviseParserMiddleChain("processDocxBytes");
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fontNamesByParagraph = [];
  const imageFiles = imageDir ? [] : null;
  const paragraphs = extractDocxParagraphs(bytes, { imageDir, imageFiles, fontNamesByParagraph });
  const job = buildDocxJob(paragraphs, filename, log, sourceEncoding, fontNamesByParagraph);
  if (imageFiles) job.imageFiles = imageFiles;
  return job;
}


export async function processDocxBytesExternal(data, filename = "upload.docx", log = () => {}) {
  validateDocxArchive(Buffer.isBuffer(data) ? data : Buffer.from(data));
  const paragraphs = await extractDocxParagraphsExternal(data);
  return buildDocxJob(paragraphs, filename, log);
}

export const EXTERNAL_UNICODE_QUALITY_FLOOR = 0.5;
function externalQualityOk(counts) {
  const total = (counts.ZAWGYI ?? 0) + (counts.UNICODE ?? 0) + (counts.UNKNOWN ?? 0);
  if (total === 0) return false;
  return (counts.UNICODE ?? 0) / total >= EXTERNAL_UNICODE_QUALITY_FLOOR;
}


export async function processDocxForMethod(data, method, filename = null, log = () => {}, options = {}) {
  const mode = String(method || "default").toLowerCase();
  if (!["default", "manual", "null"].includes(mode)) {
    throw new Error(`Unsupported method: ${JSON.stringify(method)} (use "default"/"manual"/"null")`);
  }
  if (mode === "default") {
    const probe = await processDocxBytesExternal(data, filename || "upload.docx", log);
    if ((probe.counts.ZAWGYI ?? 0) + (probe.counts.UNICODE ?? 0) === 0) {
      log("    mammoth probe has no source-encoding evidence; handing the original DOCX to PRASER");
    } else {
      log(externalQualityOk(probe.counts)
        ? "    mammoth probe passed; handing the original DOCX to PRASER"
        : "    mammoth probe failed the Unicode-readability check; handing the original DOCX to PRASER");
    }
  }
  return processDocxBytes(data, filename || "upload.docx", log, options);
}


export function buildFinalPages(job, applyCleanup) {
  adviseParserMiddleChain("buildFinalPages");
  const out = [];
  const len = Math.min(job.pages.length, job.reports.length);
  for (let i = 0; i < len; i += 1) {
    const pg = job.pages[i];
    const rep = job.reports[i];
    if (!("lines" in pg)) {
      out.push({
        text: applyCleanup && rep.clean !== null && rep.clean !== undefined ? rep.clean : pg.text,
      });
      continue;
    }
    if (applyCleanup && rep.clean !== null && rep.clean !== undefined) {
      out.push({
        text: rep.clean,
        lines: pg.lines.map(([x, y, s, t]) => [x, y, s, cleanupUnicode(t)]),
        wh: pg.wh,
        hasImg: pg.hasImg,
        images: pg.images,
        parsingPath: pg.parsingPath,
      });
    } else {
      out.push({ text: pg.text, lines: pg.lines, wh: pg.wh, hasImg: pg.hasImg,
        images: pg.images, parsingPath: pg.parsingPath });
    }
  }
  return out;
}

export { pyRound, baseName };














export async function markPdfImagePages(bytes, job, imageDir, log = () => {}) {
  const files = [];
  const reports = Array.isArray(job?.reports) ? job.reports : [];
  for (let i = 0; i < reports.length; i += 1) {
    if (!reports[i]?.hasImg && !job.pages?.[i]?.hasImg) continue;
    const id = String(files.length + 1).padStart(4, "0");
    const target = path.join(imageDir, `${id}-page${i + 1}.png`);
    try {
      const { png } = await renderPdfPagePng(bytes, i + 1);
      fs.writeFileSync(target, png, { mode: 0o600 });
    } catch (error) {
      log(`    Page ${i + 1}: render for OCR skipped (${error.message})`);
      continue;
    }
    const marker = `\n[[IMAGE_${id}]]`;
    if (job.pages?.[i]) job.pages[i].text = `${job.pages[i].text ?? ""}${marker}`;
    if (reports[i].clean != null) reports[i].clean = `${reports[i].clean}${marker}`;
    reports[i].text = `${reports[i].text ?? ""}${marker}`;
    files.push({ id, path: target });
  }
  return files;
}


// FILE: docx/docx-external.js
/*
(DOCX 3) DOCX branch, position 3 in the chain - the fallback beside the main extractor (DOCX 2).
This module extracts DOCX paragraphs through the external mammoth library when the built-in extractor is not used.
*/




let mammothPromise = null;
function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import("mammoth").catch((cause) => {
      mammothPromise = null;
      throw new Error(
        "DOCX extraction requested but mammoth is not installed " +
          "(optional dependency; install it to enable the DOCX lane): " +
          `${cause?.message || cause}`,
        { cause },
      );
    });
  }
  return mammothPromise;
}

export async function extractDocxParagraphsExternal(data) {
  const mammoth = (await loadMammoth()).default;
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const { value } = await mammoth.extractRawText({ buffer });
  return value
    .split("\n")
    .filter((line) => line.trim().length > 0);
}


// FILE: docx/docx-extract.js
/*
(DOCX 2) DOCX branch, position 2 in the chain - after the zip is opened (DOCX 1).
This module extracts the paragraphs of a DOCX document from its document.xml, in order, with the same Myanmar checks the PDF branch uses.
*/
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readCentralDirectory, readEntry } from "../io/zip.js";
import { ValueError } from "../pylib.js";
import { OWNER_PARSER_WORKER, resourceLimit } from "../limits/local.js";
import { containsMyanmar } from "../detect.js";



export const MAX_MEMBER_MB = resourceLimit("PRASER_MAX_MEMBER_MB", 64, 256);
export const MAX_DOCX_TOTAL_MB = resourceLimit("PRASER_MAX_DOCX_TOTAL_MB", 128, 512);
export const MAX_DOCX_ENTRIES = resourceLimit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000);
export const MAX_MEMBER_RATIO = OWNER_PARSER_WORKER ? Infinity : 200;

const W_URI = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const DRAWING_URI = "http://schemas.openxmlformats.org/drawingml/2006/main";
const VML_URI = "urn:schemas-microsoft-com:vml";
const RELATIONSHIP_URIS = new Set([
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  "http://purl.oclc.org/ooxml/officeDocument/relationships",
]);
export const DOCUMENT_XML = "word/document.xml";


const HEADER_RE = /^word\/header\d*\.xml$/;
const FOOTER_RE = /^word\/footer\d*\.xml$/;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text) {
  if (!text.includes("&")) return text;
  return text.replace(/&(#\d+|#[xX][0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (whole, body) => {
    if (body[0] === "#") {
      const cp = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
      return String.fromCodePoint(cp);
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}


function* walkXml(xml) {
  const n = xml.length;
  const nsStack = [new Map([["", null]])];
  const scope = [];                        
  let i = 0;

  const parseName = (raw) => {
    const colon = raw.indexOf(":");
    if (colon === -1) {
      const uri = nsStack[nsStack.length - 1].get("") ?? null;
      return [uri ?? "", raw];
    }
    const prefix = raw.slice(0, colon);
    const local = raw.slice(colon + 1);
    const top = nsStack[nsStack.length - 1];
    const uri = top.has(prefix) ? top.get(prefix) : (prefix === "xml"
      ? "http://www.w3.org/XML/1998/namespace"
      : prefix === "xmlns" ? "http://www.w3.org/2000/xmlns/" : undefined);
    if (uri === undefined) throw new Error(`unbound prefix ${JSON.stringify(prefix)}`);
    return [uri ?? "", local];
  };

  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt === -1) break;
    if (lt > i) {
      yield { kind: "text", value: decodeEntities(xml.slice(i, lt)) };
    }
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      const raw = xml.slice(lt + 9, end === -1 ? n : end);
      
      yield { kind: "text", value: raw, cdata: true };
      i = end === -1 ? n : end + 3;
      continue;
    }
    
    let j = lt + 1;
    let quote = null;
    while (j < n) {
      const c = xml[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j += 1;
    }
    const tag = xml.slice(lt + 1, j);
    i = j + 1;

    if (tag[0] === "/") {
      
      
      const [uri, local] = parseName(tag.slice(1).trim());
      scope.pop();
      nsStack.pop();
      yield { kind: "close", uri, local };
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    
    let k = 0;
    while (k < body.length && !/[\s]/.test(body[k])) k += 1;
    const rawName = body.slice(0, k);
    const attrText = body.slice(k);

    const attrs = [];
    const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')|([^\s/>]+)/g;
    let am;
    while ((am = attrRe.exec(attrText)) !== null) {
      const value = am[3] !== undefined ? am[3] : am[4] !== undefined ? am[4] : null;
      attrs.push([am[1], value === null ? null : decodeEntities(value)]);
    }

    const map = new Map(nsStack[nsStack.length - 1]);
    for (const [aname, value] of attrs) {
      if (aname === "xmlns") map.set("", value ?? "");
      else if (aname.startsWith("xmlns:")) map.set(aname.slice(6), value ?? "");
    }
    nsStack.push(map);
    scope.push({ selfClosing });

    const [uri, local] = parseName(rawName);
    const imageNode = (uri === DRAWING_URI && local === "blip") || (uri === VML_URI && local === "imagedata");
    const namespacedAttrs = imageNode ? attrs.map(([name, value]) => {
      const colon = name.indexOf(":");
      return colon < 0
        ? { uri: "", local: name, value }
        : { uri: map.get(name.slice(0, colon)) ?? "", local: name.slice(colon + 1), value };
    }) : [];
    yield { kind: "open", uri, local, selfClosing, attrs, namespacedAttrs };
    if (selfClosing) {
      nsStack.pop();
      scope.pop();
      yield { kind: "close", uri, local };
    }
  }
}


export function extractDocxParagraphs(docxPath, {
  fontNamesByParagraph = null, imageDir = null, imageFiles = null,
} = {}) {
  const buf = Buffer.isBuffer(docxPath) || docxPath instanceof Uint8Array
    ? Buffer.from(docxPath.buffer, docxPath.byteOffset, docxPath.byteLength)
    : fs.readFileSync(docxPath);
  return parseDocxParagraphs(buf, { fontNamesByParagraph, imageDir, imageFiles });
}


export function validateDocxArchive(zipBuf) {
  const entries = readCentralDirectory(zipBuf);
  if (entries.size > MAX_DOCX_ENTRIES) {
    throw new ValueError(`DOCX exceeds the ${MAX_DOCX_ENTRIES} member cap`);
  }
  if (!entries.has("[Content_Types].xml") || !entries.has(DOCUMENT_XML)) {
    throw new ValueError("ZIP package is not a valid DOCX document");
  }

  let total = 0;
  const memberCap = MAX_MEMBER_MB * 1024 * 1024;
  const totalCap = MAX_DOCX_TOTAL_MB * 1024 * 1024;
  for (const [name, info] of entries) {
    if (
      name.includes('\\') ||
      name.includes('\0') ||
      name.startsWith('/') ||
      name.split('/').includes('..')
    ) {
      throw new ValueError(`DOCX contains an unsafe member name ${JSON.stringify(name)}`);
    }
    if (!Number.isSafeInteger(info.file) || !Number.isSafeInteger(info.compressSize)) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} has unsafe ZIP64 sizes`);
    }
    if ((info.flags & 0x1) !== 0) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} is encrypted`);
    }
    if (info.method !== 0 && info.method !== 8) {
      throw new ValueError(`DOCX member ${JSON.stringify(name)} uses unsupported compression`);
    }
    if (info.file > memberCap) {
      throw new ValueError(
        `DOCX member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_MB} MB cap`,
      );
    }
    const ratio = info.file / Math.max(info.compressSize, 1);
    if (ratio > MAX_MEMBER_RATIO) {
      throw new ValueError(
        `DOCX member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_RATIO}x compression-ratio cap`,
      );
    }
    total += info.file;
    if (!Number.isSafeInteger(total) || total > totalCap) {
      throw new ValueError(`DOCX exceeds the ${MAX_DOCX_TOTAL_MB} MB expanded-size cap`);
    }
  }
  return entries;
}


function readMemberXml(zipBuf, info, name) {
  const ratio = info.file / Math.max(info.compressSize, 1);
  if (info.file > MAX_MEMBER_MB * 1024 * 1024) {
    throw new ValueError(
      `docx member ${JSON.stringify(name)} exceeds the ${MAX_MEMBER_MB} MB cap (decompression bomb?)`,
    );
  }
  if (ratio > MAX_MEMBER_RATIO) {
    throw new ValueError(
      `docx member ${JSON.stringify(name)} compresses ${info.compressSize} -> ${info.file} bytes `
      + `(ratio ${Math.round(ratio)}x) — decompression bomb, refused`,
    );
  }
  const xmlBytes = readEntry(zipBuf, info, { maxOutputBytes: (MAX_MEMBER_MB + 1) * 1024 * 1024 });
  
  return xmlBytes.toString("utf8").replace(/\r\n?/g, "\n");
}


function orderedParts(names) {
  const ordered = [];
  ordered.push(...names.filter((n) => HEADER_RE.test(n)).sort());
  if (names.includes(DOCUMENT_XML)) ordered.push(DOCUMENT_XML);
  for (const n of ["word/footnotes.xml", "word/endnotes.xml"]) {
    if (names.includes(n)) ordered.push(n);
  }
  ordered.push(...names.filter((n) => FOOTER_RE.test(n)).sort());
  return ordered;
}

function imageRelationships(zipBuf, entries, part) {
  const relsName = path.posix.join(path.posix.dirname(part), "_rels", `${path.posix.basename(part)}.rels`);
  const info = entries.get(relsName);
  const relationships = new Map();
  if (!info) return relationships;
  for (const ev of walkXml(readMemberXml(zipBuf, info, relsName))) {
    if (ev.kind !== "open" || ev.local !== "Relationship") continue;
    const attrs = Object.fromEntries(ev.attrs);
    if (!attrs.Id || !attrs.Target || !String(attrs.Type || "").endsWith("/image")
        || String(attrs.TargetMode || "").toLowerCase() === "external") continue;
    let target;
    try { target = decodeURIComponent(attrs.Target.split("#", 1)[0]); } catch { continue; }
    if (target.includes("\\") || target.includes("\0") || target.includes("://")) continue;
    const member = target.startsWith("/")
      ? path.posix.normalize(target).slice(1)
      : path.posix.normalize(path.posix.join(path.posix.dirname(part), target));
    if (!member.startsWith("../") && entries.has(member)) relationships.set(attrs.Id, member);
  }
  return relationships;
}

export function parseDocxParagraphs(zipBuf, {
  imageDir = null, imageFiles = null, fontNamesByParagraph = null,
} = {}) {
  const entries = validateDocxArchive(zipBuf);
  if (imageDir && !Array.isArray(imageFiles)) throw new TypeError("imageFiles must be an array for DOCX image extraction");
  const paragraphs = [];
  const images = new Map();
  const markerPrefix = imageDir ? `\uE000OCR-${randomUUID()}-` : "";
  const registerImage = (member) => {
    if (!member || !entries.has(member)) return "";
    if (images.has(member)) return images.get(member);
    const id = String(images.size + 1).padStart(4, "0");
    const name = path.posix.basename(member).replace(/[^a-zA-Z0-9._-]/gu, "_");
    fs.mkdirSync(imageDir, { recursive: true, mode: 0o700 });
    const target = path.join(imageDir, `${id}-${name}`);
    const bytes = readEntry(zipBuf, entries.get(member), { maxOutputBytes: (MAX_MEMBER_MB + 1) * 1024 * 1024 });
    fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 });
    const marker = `${markerPrefix}${id}\uE001`;
    imageFiles.push({ id, path: target, marker });
    images.set(member, marker);
    return marker;
  };
  for (const name of orderedParts([...entries.keys()])) {
    const info = entries.get(name);
    if (!info) continue;
    const relationships = imageDir ? imageRelationships(zipBuf, entries, name) : null;
    const resolveImage = relationships ? (id) => registerImage(relationships.get(id)) : null;
    paragraphs.push(...collectParagraphs(readMemberXml(zipBuf, info, name), { resolveImage, fontNamesByParagraph }));
  }
  return paragraphs;
}


export function collectParagraphs(xml, { resolveImage = null, fontNamesByParagraph = null } = {}) {
  const paragraphs = [];
  const paragraphFonts = [];
  const openParagraphs = [];
  const openRuns = [];
  const elStack = [];        

  for (const ev of walkXml(xml)) {
    if (ev.kind === "open") {
      elStack.push({ uri: ev.uri, local: ev.local, textTaken: false });
      if (ev.uri === W_URI && ev.local === "p") {
        
        
        
        const ctx = { parts: [], at: paragraphs.length, fonts: new Set() };
        paragraphs.push("");
        paragraphFonts.push(ctx.fonts);
        openParagraphs.push(ctx);
      }
      if (ev.uri === W_URI && ev.local === "r") openRuns.push({ fonts: null });
      if (ev.uri === W_URI && ev.local === "rFonts" && openRuns.length) {
        // Only direct run declarations are evidence. Style inheritance and
        // theme fonts are deliberately left unknown.
        const relevant = ev.attrs.filter(([name]) => /^w:(?:ascii|hAnsi|cs|eastAsia)$/u.test(name));
        const themed = ev.attrs.some(([name]) => /^w:(?:ascii|hAnsi|cs|eastAsia)Theme$/u.test(name));
        openRuns[openRuns.length - 1].fonts = themed ? [""] : relevant.map(([, value]) => value || "");
      }
      if (openParagraphs.length) {
        const imageNode = (ev.uri === DRAWING_URI && ev.local === "blip")
          || (ev.uri === VML_URI && ev.local === "imagedata");
        if (resolveImage && imageNode) {
          const reference = ev.namespacedAttrs.find((attr) => RELATIONSHIP_URIS.has(attr.uri)
            && (attr.local === "embed" || attr.local === "id"));
          const marker = reference ? resolveImage(reference.value) : "";
          if (marker) for (const ctx of openParagraphs) ctx.parts.push(marker);
        } else if (ev.uri === W_URI && ev.local === "br") {
          for (const ctx of openParagraphs) ctx.parts.push("\n");
        } else if (ev.uri === W_URI && ev.local === "tab") {
          for (const ctx of openParagraphs) ctx.parts.push("\t");
        }
      }
    } else if (ev.kind === "text") {
      
      
      
      const top = elStack[elStack.length - 1];
      if (top && !top.textTaken && top.uri === W_URI && top.local === "t" && openParagraphs.length) {
        top.textTaken = true;
        for (const ctx of openParagraphs) {
          ctx.parts.push(ev.value);
          if (fontNamesByParagraph && containsMyanmar(ev.value)) {
            const fonts = openRuns[openRuns.length - 1]?.fonts;
            for (const name of fonts?.length ? fonts : [""]) ctx.fonts.add(name);
          }
        }
      }
    } else if (ev.kind === "close") {
      elStack.pop();
      if (ev.uri === W_URI && ev.local === "r") openRuns.pop();
      if (ev.uri === W_URI && ev.local === "p") {
        const ctx = openParagraphs.pop();
        if (ctx) paragraphs[ctx.at] = ctx.parts.join("");
      }
    }
  }
  if (fontNamesByParagraph) fontNamesByParagraph.push(...paragraphFonts);
  return paragraphs;
}

// FILE: helper/pylib.js
/*
(Support 24) Shared support, no chain position - small Python-style helpers.
This module provides truthiness, rounding, byte and integer helpers with Python semantics, kept from the parser's Python lineage, plus the shared ValueError type.
*/


export function pyTruthy(x) {
  if (x === null || x === undefined) return false;
  if (typeof x === "boolean") return x;
  if (typeof x === "number") return x !== 0;
  if (typeof x === "string") return x.length > 0;
  if (Array.isArray(x)) return x.length > 0;
  if (Buffer.isBuffer(x)) return x.length > 0;
  if (x instanceof Map || x instanceof Set) return x.size > 0;
  return true;
}


export function pyRound(x) {
  if (!Number.isFinite(x)) {
    throw new RangeError(`cannot round ${x}`); 
  }
  const fl = Math.floor(x);
  const diff = x - fl;
  if (diff > 0.5) return fl + 1;
  if (diff < 0.5) return fl;
  return fl % 2 === 0 ? fl : fl + 1;
}


const PY_WS = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0b, 0x0c]);
export function pyStripBytes(buf) {
  let i = 0;
  let j = buf.length;
  while (i < j && PY_WS.has(buf[i])) i += 1;
  while (j > i && PY_WS.has(buf[j - 1])) j -= 1;
  return buf.subarray(i, j);
}


export function fromHexStrict(hex) {
  if (hex.length % 2 !== 0) {
    throw new TypeError(`non-hexadecimal number found in fromhex() arg at position ${hex.length - 1}`);
  }
  if (!/^[0-9A-Fa-f]*$/.test(hex)) {
    const bad = hex.search(/[^0-9A-Fa-f]/);
    throw new TypeError(`non-hexadecimal number found in fromhex() arg at position ${bad}`);
  }
  return Buffer.from(hex, "hex");
}


export function pyInt16(s) {
  let t = String(s).trim().replace(/_/g, "");
  let sign = 1n;
  if (t.startsWith("+")) t = t.slice(1);
  else if (t.startsWith("-")) { sign = -1n; t = t.slice(1); }
  if (/^0[xX]/.test(t)) t = t.slice(2);
  if (!/^[0-9A-Fa-f]+$/.test(t)) throw new ValueError(`invalid literal for int() with base 16: '${s}'`);
  const v = BigInt(`0x${t}`) * sign;
  if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  return v; 
}


export function pyInt(s) {
  const t = String(s).trim().replace(/_/g, "");
  if (!/^[+-]?\d+$/.test(t)) throw new ValueError(`invalid literal for int() with base 10: '${s}'`);
  const v = BigInt(t);
  if (v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(v);
  return v;
}

export class ValueError extends Error {
  constructor(msg) { super(msg); this.name = "ValueError"; }
}
export class RuntimeError extends Error {
  constructor(msg) { super(msg); this.name = "RuntimeError"; }
}


export function pyChr(i) {
  if (typeof i === "bigint") i = Number(i);
  if (i < 0 || i > 0x10ffff) {
    throw new ValueError(`chr() arg not in range(0x110000)`);
  }
  return String.fromCodePoint(i);
}


export function pyStrCompare(a, b) {
  const ka = Array.from(a);
  const kb = Array.from(b);
  const n = Math.min(ka.length, kb.length);
  for (let i = 0; i < n; i += 1) {
    const ca = ka[i].codePointAt(0);
    const cb = kb[i].codePointAt(0);
    if (ca !== cb) return ca < cb ? -1 : 1;
  }
  if (ka.length === kb.length) return 0;
  return ka.length < kb.length ? -1 : 1;
}


export function pyLen(str) {
  let n = 0;
  for (const _ch of str) n += 1;
  return n;
}


export function splitExt(p) {
  const base = p.split(/[\\/]/).pop();
  const idx = base.lastIndexOf(".");
  const lastSep = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"));
  if (idx <= 0 || idx < lastSep) return [p, ""];
  return [p.slice(0, p.length - (base.length - idx)), base.slice(idx).toLowerCase()];
}


export function baseName(p) {
  const t = String(p).replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return i === -1 ? t : t.slice(i + 1);
}


export function pyFloat(s) {
  const t = String(s).trim().replace(/_/g, "");
  if (t === "nan" || t === "inf" || t === "-inf" || t === "+inf") return Number(t);
  if (!/^(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
    throw new ValueError(`could not convert string to float: '${s}'`);
  }
  return Number(t);
}


// FILE: helper/stream-replace.js
/*
(PDF 25) PDF branch, position 25 in the chain - text helper for chunked conversion in the finishing step (PDF 19).
This module applies replacement rules to text that arrives in chunks, keeping enough lookahead so matches across chunk boundaries are not lost.
*/
// The Rabbit rules use local Myanmar patterns. Keep enough following text for
// their lookaheads and retain any match that reaches the unfinished boundary.
// This preserves non-overlapping global replacement across chunk boundaries.
const LOOKAHEAD = 16;

function safeBoundary(text, position) {
  let end = Math.max(0, position);
  if (end > 0 && end < text.length) {
    const before = text.charCodeAt(end - 1);
    const after = text.charCodeAt(end);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
  }
  return end;
}

function replacement(template, match) {
  return template.replace(/\$(\$|&|\d{1,2})/gu, (token, value) => {
    if (value === "$") return "$";
    if (value === "&") return match[0];
    let index = Number(value);
    if (index > 0 && index < match.length) return match[index] ?? "";
    if (value.length === 2) {
      index = Number(value[0]);
      if (index > 0 && index < match.length) return `${match[index] ?? ""}${value[1]}`;
    }
    return token;
  });
}

export class StreamingReplace {
  constructor(pattern, template) {
    this.source = pattern.source;
    this.template = template;
    this.pattern = new RegExp(this.source, "gu");
    this.startOnly = this.source.startsWith("^");
    this.endOnly = this.source.endsWith("(?=\\n?$)");
    this.startDone = false;
    this.buffer = "";
  }

  push(chunk, final = false) {
    this.buffer += chunk;
    if (this.startOnly) {
      if (this.startDone) { const out = this.buffer; this.buffer = ""; return out; }
      if (!final && this.buffer.length <= LOOKAHEAD) return "";
      this.startDone = true;
      const out = this.buffer.replace(this.pattern, this.template);
      this.buffer = "";
      return out;
    }
    if (this.endOnly) {
      if (final) {
        const out = this.buffer.replace(this.pattern, this.template);
        this.buffer = "";
        return out;
      }
      const end = safeBoundary(this.buffer, this.buffer.length - LOOKAHEAD);
      const out = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end);
      return out;
    }
    const safe = final ? this.buffer.length : safeBoundary(this.buffer, this.buffer.length - LOOKAHEAD);
    let out = "";
    let consumed = 0;
    let stop = safe;
    this.pattern.lastIndex = 0;
    for (let match; (match = this.pattern.exec(this.buffer)) !== null;) {
      const end = match.index + match[0].length;
      if (match.index >= safe || end > safe) {
        stop = Math.min(safe, match.index);
        break;
      }
      out += this.buffer.slice(consumed, match.index) + replacement(this.template, match);
      consumed = end;
      if (!match[0].length) this.pattern.lastIndex += 1;
    }
    out += this.buffer.slice(consumed, stop);
    this.buffer = this.buffer.slice(stop);
    return out;
  }
}

class CodePointStream {
  constructor() { this.high = ""; }

  input(chunk, final) {
    let text = this.high + chunk;
    this.high = "";
    if (!final && text.length) {
      const last = text.charCodeAt(text.length - 1);
      if (last >= 0xd800 && last <= 0xdbff) {
        this.high = text.slice(-1);
        text = text.slice(0, -1);
      }
    }
    return text;
  }
}

// These Rabbit rules collapse a run of equal characters. A run may be as
// long as the page, so keep the previous character instead of the match.
class CollapseRun extends CodePointStream {
  constructor(characters) {
    super();
    this.characters = characters;
    this.previous = "";
  }

  push(chunk, final = false) {
    let out = "";
    for (const char of this.input(chunk, final)) {
      if (!this.characters.has(char) || char !== this.previous) out += char;
      this.previous = this.characters.has(char) ? char : "";
    }
    return out;
  }
}

// ([က-အ])ေ([ျြွှ]+) moves one vowel after an arbitrarily long
// medial run. Emit the run as it arrives and delay only the vowel.
class MedialRun extends CodePointStream {
  constructor() {
    super();
    this.state = 0;
    this.base = "";
  }

  push(chunk, final = false) {
    let out = "";
    for (const char of this.input(chunk, final)) {
      if (this.state === 3) {
        if ("ျြွှ".includes(char)) { out += char; continue; }
        out += "ေ";
        this.state = 0;
      }
      if (this.state === 2) {
        if ("ျြွှ".includes(char)) {
          out += this.base + char;
          this.base = "";
          this.state = 3;
          continue;
        }
        out += `${this.base}ေ`;
        this.base = "";
        this.state = 0;
      }
      if (this.state === 1) {
        if (char === "ေ") { this.state = 2; continue; }
        out += this.base;
        this.base = "";
        this.state = 0;
      }
      if (char >= "က" && char <= "အ") {
        this.base = char;
        this.state = 1;
      } else out += char;
    }
    if (final) {
      if (this.state === 1) out += this.base;
      else if (this.state === 2) out += `${this.base}ေ`;
      else if (this.state === 3) out += "ေ";
      this.state = 0;
      this.base = "";
    }
    return out;
  }
}

function stageFor(pattern, template) {
  if (pattern.source === "([ိီွု့႕])\\1+" && template === "$1") {
    return new CollapseRun(new Set("ိီွု့႕"));
  }
  if (pattern.source === "([က-အ])ေ([ျြွှ]+)" && template === "$1$2ေ") return new MedialRun();
  for (const char of "ိ်ွ့ီ") {
    if (pattern.source === `[${char}]+` && template === char) return new CollapseRun(new Set([char]));
  }
  return new StreamingReplace(pattern, template);
}

export function createReplacementPipeline(rules, onChunk) {
  if (typeof onChunk !== "function") throw new TypeError("Expected an output callback");
  const stages = rules.map(([pattern, template]) => stageFor(pattern, template));
  let finished = false;
  return {
    push(text, final = false) {
      if (finished) throw new Error("Text replacement stream is already finished");
      let output = String(text ?? "");
      for (const stage of stages) output = stage.push(output, final);
      if (output) onChunk(output);
      if (final) finished = true;
    },
  };
}


// FILE: init/bind-input.js
/*
(Input chain - sits like Architecture/Engine/init/bridge.js) One door, two functions on a trigger.
BindInput is the only entry: a trigger comes in { path } (a file the caller owns) or { object } (bytes or a stream already in hand) - never both. A relative trigger path names a file saved by the host, so it is pointed at the host upload dir (<site runtime>/upload/input, per-kind subdir); an absolute path is an explicit location and is used as given. The trigger then lands in exactly one of two functions: fromPath points at the already-landed file (nothing is read into memory - the whole bytes are never held); fromObject lands a byte stream or loose bytes into a tmp file through the collector (Generator A -> collectA, the incremental tmp writer), and a path-carrying object resolves to its file the same way. Either way the landed file runs past the middle (file/prepare-middle.js): clean files pass untouched, encrypted/object-streamed PDFs are prepared by qpdf over the tmp, and the parsing chain entry receives the prepared file to seek in - qpdf's output is a tmp file too, never memory. One pre-determination (docx/docx-object.js): the first bytes are peeked before landing - a DOCX (PK) is passed on as the object itself (its runner reads the whole archive anyway, so a tmp would buy nothing); only PDFs take the tmp route. The stages sit in this init/ tree - file/file-chunks.js, file/collect-whole.js, file/prepare-middle.js, pdf/, docx/ - the way the segmentor stages sit in MonoSyllabism/generators/; the composition sits here in the door. Routing and job decisions stay in dispatcher.js - this door only answers "where do the bytes live", and returns { path, size } (plus `filename` when the trigger named one, and `collected: true` when the file is a chain-owned tmp its consumer must delete). The dispatcher payload prefers inPath, so workers read the file themselves.
*/
import fs from "node:fs";
import path from "node:path";
import { PARSER_DIR } from "../_path.js";
import { generatorA } from "./file/file-chunks.js";
import { collectA } from "./file/collect-whole.js";
import { prepareMiddle } from "./file/prepare-middle.js";
import { kindFromHead, passObject } from "./docx/docx-object.js";

// Where the host saves uploaded files: <site runtime>/upload/input with
// a per-kind subdir (Backend/file/paths.js: INPUT_DIR, inputDirFor).
// A trigger path that is not absolute names a saved file, so it is
// pointed here - never at the process working directory. Absolute
// paths are explicit locations and pass through untouched.
// PARSER_INPUT_DIR (or the host's PARSER_RUNTIME_DIR) relocates it.
const INPUT_HOME = process.env.PARSER_INPUT_DIR
  ? path.resolve(process.env.PARSER_INPUT_DIR)
  : process.env.PARSER_RUNTIME_DIR
    ? path.join(path.resolve(process.env.PARSER_RUNTIME_DIR), "upload", "input")
    : path.join(PARSER_DIR, "host", "upload", "input");
const KIND_DIR = { txt: "txt", pdf: "pdf", docx: "docx", doc: "docx" };

function savedFilePath(name) {
  if (path.isAbsolute(name)) return name;
  const rel = path.normalize(name);
  const base = rel.includes(path.sep)
    ? path.join(INPUT_HOME, rel)
    : path.join(INPUT_HOME, KIND_DIR[rel.split(".").pop().toLowerCase()] ?? "", rel);
  const resolved = path.resolve(base);
  if (resolved !== INPUT_HOME && !resolved.startsWith(INPUT_HOME + path.sep)) {
    throw new TypeError("BindInput: file path escapes the host upload dir");
  }
  return resolved;
}

// The file-object for an already-landed file: point and measure,
// never read. Existence and file-ness are proven here.
function fileObject(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`BindInput: not a file: ${file}`);
  return { path: file, size: stat.size };
}

// Run landed items past the middle and shape the one object the
// dispatcher accepts: the prepared (or untouched) file, its size, and
// whether the chain owns it. `collected` is set when the returned file
// is a chain tmp - the collected landing, or qpdf's prepared output -
// and its consumer must delete it; a caller's own file is never marked.
async function preparedObject(items, { filename = null, collectedItem = false } = {}) {
  for await (const ready of prepareMiddle(items)) {
    return {
      path: ready.path,
      size: fs.statSync(ready.path).size,
      prepared: ready.prepared === true,
      ...((ready.prepared || collectedItem) ? { collected: true } : {}),
      ...(filename ? { filename } : {}),
    };
  }
  throw new TypeError("BindInput: prepare produced nothing");
}

// Trigger came with a file path: the bytes already live in that file,
// so the trigger simply points at it (through savedFilePath) - no
// collection, no memory - and the middle prepares it if it must.
async function fromPath(name) {
  const file = savedFilePath(name);
  fileObject(file); // prove existence before the middle sees it
  return preparedObject([{ path: file }]);
}

// Trigger came with an object. A path-carrying object resolves to its
// file like fromPath. A byte stream or loose bytes have no home yet,
// so they land in a tmp through the collector (marked collected: true
// - the consumer owns its deletion).
async function fromObject(object, nameHint = null) {
  const filename = (typeof object?.filename === "string" && object.filename) || nameHint || null;
  if (typeof object?.path === "string" && object.path && !(object instanceof Uint8Array)) {
    const file = savedFilePath(object.path);
    fileObject(file);
    return preparedObject([{ path: file }], { filename });
  }
  const source = object?.[Symbol.asyncIterator]
    ? object
    : object instanceof Uint8Array
      ? [object]
      : object?.bytes instanceof Uint8Array
        ? [object.bytes]
        : object?.data instanceof Uint8Array
          ? [object.data]
          : null;
  if (!source) {
    throw new TypeError("BindInput: object must be a byte stream, bytes, or a file path");
  }
  return objectByKind(source, filename);
}

async function objectByKind(source, filename) {
  async function* asChunks() { yield* source; }
  const stream = asChunks();
  const iterator = stream[Symbol.asyncIterator]();
  const head = [];
  let headBytes = 0;
  while (headBytes < 4) {
    const next = await iterator.next();
    if (next.done) break;
    const buf = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    head.push(buf);
    headBytes += buf.length;
  }
  async function* rest() {
    yield* head;
    yield* stream;
  }
  if (kindFromHead(Buffer.concat(head)) === "docx") {
    return passObject(rest(), filename);
  }
  return preparedObject(collectA(rest(), { nameHint: filename }), { filename, collectedItem: true });
}

/**
 * One entry for trigger input. Returns a promise for the input object:
 * { path, size } - the file the bytes live in, always. `collected: true`
 * marks a chain-owned tmp the consumer must delete after use.
 */
export function BindInput(trigger) {
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) {
    throw new TypeError("BindInput: a trigger object is required");
  }
  const path = trigger.path ?? trigger.inPath;
  const hasPath = typeof path === "string" && path.length > 0;
  const hasObject = trigger.object !== undefined && trigger.object !== null;
  if (hasPath && hasObject) {
    throw new TypeError("BindInput: supply a file path or an object, not both");
  }
  if (hasPath) return fromPath(path);
  if (hasObject) return fromObject(trigger.object, trigger.filename ?? null);
  throw new TypeError("BindInput: trigger must carry a file path or an object");
}


// FILE: init/docx/docx-object.js
/*
(init/docx - docx-object) Pre-determination and pass-through for DOCX, for the door.
This module owns the two DOCX decisions at the door: kindFromHead reads the first bytes and names what arrived ("%PDF-" a PDF, PK a zip container - a DOCX, anything else other), and passObject hands a DOCX on as the object itself: its runner reads the whole archive in memory anyway (the zip directory sits at the end), so landing it in a tmp file would only add a write+read round trip for nothing.
*/
import { collectBytes } from "../file/collect-whole.js";

// Pre-determination from the first bytes - the same magics the
// converter worker sniffs when it chooses its runner.
export function kindFromHead(head) {
  if (head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) return "docx";
  return "other";
}

// Pass the DOCX on as the object: { bytes, size }, plus the trigger's
// filename when it named one.
export async function passObject(source, filename = null) {
  const bytes = await collectBytes(source);
  return { bytes, size: bytes.length, ...(filename ? { filename } : {}) };
}


// FILE: init/file/collect-whole.js
/*
(Input chain, new - the collector as an incremental tmp writer) Second link: consumes Generator A (or any chunk stream) and lands it in a tmp file.
For PDF, holding the whole input in memory bought nothing - every downstream stage peeks files by offset anyway - so PDF collection is a landing, not a holding: each chunk is written to a tmp file as it arrives, the byte cap is enforced while writing (a partial file is destroyed on overflow), and exactly one item is emitted: { path, size, collected: true }. Memory stays flat no matter how large the input; the emitted tmp is owned by the chain's consumer, marked by `collected`. DOCX is the one exception (collectBytes below): its runner reads the whole archive in memory regardless, so it is passed the object directly.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAX_INPUT_BYTES, MAX_INPUT_MB } from "../../core/limits/local.js";

let sequence = 0;

// The whole bytes in memory. This is DOCX's landing: its runner reads
// the whole archive anyway (the zip directory sits at the end), so a
// tmp file would only add a write+read round trip. PDF never lands
// here - it goes to the tmp writer above. Cap enforced identically.
export async function collectBytes(source, { maxBytes = MAX_INPUT_BYTES } = {}) {
  const chunks = [];
  let total = 0;
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, total);
}

// Consume every chunk from `source`, writing each to a fresh tmp file
// as it arrives, then yield the landed file once: { path, size }.
// Nothing of the input is retained in memory beyond one chunk.
export async function* collectA(source, { maxBytes = MAX_INPUT_BYTES, nameHint = null } = {}) {
  // The tmp keeps the trigger filename's extension when one is known:
  // downstream kind detection reads names before it reads bytes.
  const hinted = String(nameHint ?? "").toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1];
  const file = path.join(
    os.tmpdir(),
    `myangustis-input-${process.pid}-${++sequence}.${hinted ?? "tmp"}`,
  );
  const out = fs.createWriteStream(file, { mode: 0o600 });
  let total = 0;
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > maxBytes) {
        throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
      }
      if (!out.write(buf)) {
        await new Promise((resolve, reject) => {
          out.once("drain", resolve);
          out.once("error", reject);
        });
      }
    }
    await new Promise((resolve, reject) => {
      out.end((error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    out.destroy();
    fs.rmSync(file, { force: true });
    throw error;
  }
  yield { path: file, size: total, collected: true };
}


// FILE: init/file/file-chunks.js
/*
(Input chain, new - not wired into the live chain yet) Generator A: the file-reading stream, first link.
This module reads a file from a given path and emits its bytes as a sequence of chunks (an async generator). It parses nothing and keeps nothing - each chunk is handed downstream and forgotten.
*/
import fs from "node:fs";

// Generator A: emit the file at `filePath` as chunks of bytes.
// The consumer decides what a chunk means; this module only reads.
export async function* generatorA(filePath, { chunkBytes = 1024 * 1024 } = {}) {
  if (!filePath || typeof filePath !== "string") {
    throw new TypeError("generatorA: file path is required");
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`generatorA: not a file: ${filePath}`);
  }
  const stream = fs.createReadStream(filePath, { highWaterMark: chunkBytes });
  for await (const chunk of stream) {
    yield chunk;
  }
}


// FILE: init/file/prepare-middle.js
/*
(init/file - prepare-middle, the middle consumer) Third link: consumes the collector's landed file and passes one file to the next chain (the outside-stream skeleton parser).
This module holds nothing. It takes the landed tmp file from the collector and passes one file downstream: either the same file untouched (clean - no /Encrypt, no /ObjStm: nothing to prepare), or a qpdf-prepared file (encrypted or object-streamed: qpdf decrypts + expands + repairs, working file to file). Detection runs on the file in bounded blocks - no qpdf call and no memory load happens before the decision. A collected tmp that goes through qpdf is deleted once prepared; the prepared file is owned by downstream from that moment.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scanPdfFileMarkers } from "../pdf/decrypt.js";

// Only PDFs are qpdf's business. Anything else that flows through the
// chain (DOCX above all) passes through untouched.
function isPdfFile(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(5);
    fs.readSync(fd, head, 0, 5, 0);
    return head.toString("latin1") === "%PDF-";
  } finally {
    fs.closeSync(fd);
  }
}
import { runQpdfFile } from "../pdf/qpdf.js";
import { copyPdfPrefix, findPdfEnd } from "../../core/pdf/pdf-tail.js";

// Same qpdf work as preparePdf in core/pdf/pdf-stream.js (the live
// chain's prepare step): decrypt with empty password, disable object
// streams, preserve content streams. Kept in step deliberately; the
// damaged-file retry (trim to the true PDF end, prepare again) too.
async function prepareTmp(input, prepared) {
  const prepare = (source) => runQpdfFile(source, prepared, [
    "--password=", "--decrypt", "--object-streams=disable", "--stream-data=preserve",
  ]);
  try {
    try {
      await prepare(input);
    } catch (cause) {
      if (!/can.t find startxref/iu.test(String(cause?.message))) throw cause;
      const end = findPdfEnd(input);
      if (!end || end >= fs.statSync(input).size) throw cause;
      const trimmed = path.join(path.dirname(input), "trimmed.pdf");
      copyPdfPrefix(input, trimmed, end);
      try {
        await prepare(trimmed);
      } finally {
        fs.rmSync(trimmed, { force: true });
      }
    }
  } catch (cause) {
    if (/invalid password|password.*incorrect|requires a password/iu.test(String(cause?.message))) {
      throw new Error("This PDF needs a password to open; supply an unprotected copy.", { cause });
    }
    throw cause;
  }
}

// Consume the collector's landed file and emit exactly one item:
//   { prepared: false, kind: "file", path, encrypted, objectStreams }
//   { prepared: true,  kind: "file", path, encrypted, objectStreams }
// Either way downstream receives a file to peek by offset; this module
// retains nothing. A `collected` input tmp is deleted once qpdf has
// produced the prepared file (or failed trying).
export async function* prepareMiddle(source, { workDir } = {}) {
  for await (const item of source) {
    const input = typeof item === "string" ? item : item?.path;
    if (!input) throw new TypeError("prepareMiddle: a landed file is required");
    if (!isPdfFile(input)) {
      yield { prepared: false, kind: "file", path: input, encrypted: false, objectStreams: false };
      return;
    }
    const { encrypted, objectStreams } = scanPdfFileMarkers(input);

    if (!encrypted && !objectStreams) {
      // Nothing to prepare: pass the very same file downstream.
      yield { prepared: false, kind: "file", path: input, encrypted, objectStreams };
      return;
    }

    const ownDir = !workDir;
    const directory = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-prepare-"));
    fs.mkdirSync(directory, { recursive: true });
    const prepared = path.join(directory, "prepared.pdf");
    try {
      await prepareTmp(input, prepared);
    } catch (error) {
      if (ownDir) fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    } finally {
      if (item?.collected) fs.rmSync(input, { force: true });
    }
    yield { prepared: true, kind: "file", path: prepared, encrypted, objectStreams };
    return;
  }
}


// FILE: init/pdf/decrypt.js
/*
(PDF 7) PDF branch, position 7 in the chain - the first check on the raw input bytes, before preparation.
This module only looks for marker bytes in the PDF: it reports whether the file is encrypted (/Encrypt) or uses object streams (/ObjStm), without loading the file into the parser.
*/
import fs from "node:fs";

const ENCRYPT_MARK = Buffer.from("/Encrypt");

export function isEncryptedPdf(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(ENCRYPT_MARK);
}

const OBJSTM_MARK = Buffer.from("/ObjStm");

// Match the byte-based checks without loading a path-backed PDF into memory.
export function scanPdfFileMarkers(source) {
  const fd = fs.openSync(source, "r");
  const block = Buffer.allocUnsafe(64 * 1024);
  let tail = Buffer.alloc(0);
  let encrypted = false;
  let objectStreams = false;
  let position = 0;
  try {
    while (true) {
      const count = fs.readSync(fd, block, 0, block.length, position);
      if (!count) break;
      position += count;
      const bytes = tail.length ? Buffer.concat([tail, block.subarray(0, count)]) : block.subarray(0, count);
      encrypted ||= bytes.includes(ENCRYPT_MARK);
      objectStreams ||= bytes.includes(OBJSTM_MARK);
      if (encrypted && objectStreams) break;
      tail = Buffer.from(bytes.subarray(Math.max(0, bytes.length - Math.max(ENCRYPT_MARK.length, OBJSTM_MARK.length) + 1)));
    }
    return { encrypted, objectStreams };
  } finally {
    fs.closeSync(fd);
  }
}











export function hasObjectStreams(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return buf.includes(OBJSTM_MARK);
}


// FILE: init/pdf/qpdf.js
/*
(PDF 8) PDF branch, position 8 in the chain - after the byte checks (PDF 7).
This module runs the external qpdf program to prepare a PDF for the parser: decrypt it and rewrite it without object streams, into a working file.
*/
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const QPDF_BIN = process.env.PRASER_QPDF_BIN || "qpdf";

function run(binary, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (cause) => reject(new Error(
      cause?.code === "ENOENT"
        ? `qpdf executable not found (${JSON.stringify(binary)})`
        : `qpdf failed to start: ${cause?.message || cause}`,
      { cause },
    )));
    child.once("close", (code, signal) => {



      if (code === 0 || code === 3) resolve({ warnings: stderr.trim() });
      else reject(new Error(`qpdf exited with ${signal ? `signal ${signal}` : `status ${code}`}${stderr.trim() ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

export async function runQpdfFile(input, output, args = []) {
  if (typeof input !== "string" || typeof output !== "string" || !input || !output) {
    throw new TypeError("qpdf requires input and output file paths");
  }
  await run(QPDF_BIN, [...args, "--", path.resolve(input), path.resolve(output)]);
  await fs.chmod(output, 0o600);
  return { warnings: "" };
}


// FILE: io/compose.js
/*
(PDF 32) PDF branch, position 32 in the chain - called by the output writer (PDF 31) for pdf and docx output.
This module renders finished text back into a document: it lays out paragraphs and writes an output PDF or DOCX with proper Burmese fonts.
*/
import {
  ANONYMOUS_PRO_FILES,
  BURMESE_FONTS,
  DEFAULT_BURMESE_KEY,
  FONT_ROLES,
  classifyTextRole,
  isFile,
  registerPdfFonts,
  applyPdfRole,
} from "../codepage/fonts.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { OUTPUT_FONT_DIR } from "../../_path.js";

const BURMESE_DOCX_NAME = BURMESE_FONTS[DEFAULT_BURMESE_KEY].docx;
import { PdfWriter } from "../pdf/pdf-writer.js";
import { writeOptimizedPdf } from "../pdf/pdf-optimize.js";
import { ZipStreamWriter } from "./zip.js";
import { pyRound, RuntimeError } from "../pylib.js";
import { textLines } from "../decoding/finalized-cmap.js";

export function esc(s) {
  
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}


export function pdfLineHeight(pdf, role) {
  const cfg = FONT_ROLES[role];
  return pdf.fontSizePt * cfg.line_spacing / pdf.k;
}





export async function writePdf(outPath, texts, metadata, pdfPath, npages, log = () => {}, workDir = null) {
  const engReg = ANONYMOUS_PRO_FILES[""];
  if (!engReg || !isFile(engReg)) {
    throw new RuntimeError(
      `Anonymous Pro font not found in ${OUTPUT_FONT_DIR} (required for PDF output).`,
    );
  }

  const directory = fs.mkdtempSync(workDir
    ? path.join(workDir, "pdf-output-") : path.join(os.tmpdir(), "linga-pdf-output-"));
  let pdf;
  try {
  pdf = new PdfWriter(directory);
  pdf.setFooter((self) => {
    self.setY(-15);
    applyPdfRole(self, "page_number");
    self.cell(0, pdfLineHeight(self, "page_number"), String(self.pageNo), { align: "C" });
  });
  pdf.setAutoPageBreak(true, 20);
  registerPdfFonts(pdf);

  const left = 18;
  const top = 18;

  const renderHeader = () => {
    pdf.setXY(left, top);
    applyPdfRole(pdf, "title");
    pdf.cell(0, pdfLineHeight(pdf, "title"), `Source: ${pdfPath}`, { newX: "LMARGIN", newY: "NEXT" });
    applyPdfRole(pdf, "meta");
    const metaItems = [["Pages", npages], ...Object.entries(metadata || {})];
    for (const [k, v] of metaItems) {
      pdf.cell(0, pdfLineHeight(pdf, "meta"), `${k}: ${v}`, { newX: "LMARGIN", newY: "NEXT" });
    }
    pdf.ln(5);
  };

  let idx = 0;
  for await (const txt of texts) {
    pdf.addPage();
    pdf.setXY(left, top);
    if (idx === 0) {
      renderHeader();
      pdf.ln(3);
    }
    let prevBlank = true;
    const chunks = typeof txt?.textChunks === "function" ? txt.textChunks() : [String(txt ?? "")];
    for (const line of textLines(chunks)) {
      const role = classifyTextRole(line, prevBlank);
      if (role === "blank") {
        pdf.ln(pdfLineHeight(pdf, "paragraph") * 0.5);
        prevBlank = true;
        continue;
      }
      applyPdfRole(pdf, role);
      pdf.cell(0, pdfLineHeight(pdf, role), line, {
        newX: "LMARGIN", newY: "NEXT", align: FONT_ROLES[role].align,
      });
      prevBlank = false;
    }
    idx += 1;
  }

  const firstPass = path.join(directory, "first-pass.pdf");
  await pdf.output(firstPass);
  await writeOptimizedPdf(outPath, firstPass, log);
  return outPath;
  } finally {
    pdf?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}












const TWIPS = 20; 
const LH = 1.2;   
export function hasMyanmar(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1000 && cp <= 0x109f) return true;
  }
  return false;
}
export function layoutPara(xTw, beforeTw, size, text) {
  const half = Math.max(1, pyRound(size * 2));
  const lineTw = Math.max(1, pyRound(size * LH * TWIPS));
  const bm = hasMyanmar(text) ? BURMESE_DOCX_NAME : "Anonymous Pro";
  const rpr = `<w:rPr><w:rFonts w:ascii="Anonymous Pro" w:hAnsi="Anonymous Pro" `
    + `w:cs="${bm}"/><w:sz w:val="${half}"/><w:szCs w:val="${half}"/></w:rPr>`;
  const ppr = `<w:pPr><w:spacing w:before="${Math.max(0, pyRound(beforeTw))}" w:after="0" `
    + `w:line="${lineTw}" w:lineRule="exact"/>`
    + `<w:ind w:left="${Math.max(0, pyRound(xTw))}" w:right="0" w:firstLine="0"/>`
    + `<w:jc w:val="left"/></w:pPr>`;
  return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

export function sectPr(wPt, hPt) {
  return `<w:sectPr><w:pgSz w:w="${pyRound(wPt * TWIPS)}" w:h="${pyRound(hPt * TWIPS)}"/>`
    + `<w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" `
    + `w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>`;
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';

const RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
  + '</Relationships>';

const DOC_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';


export async function writeDocxLayout(outPath, pages, pdfPath, pageCount = pages.length) {
  void pdfPath;
  async function* body() {
    yield DOC_HEAD;
    let i = 0;
    for await (const pg of pages) {
      const [wPt, hPt] = pg.wh ?? [612.0, 792.0];
      const count = pg.lineCount ?? pg.lines?.length ?? 0;
      const lines = typeof pg.lines === "function" ? pg.lines() : (pg.lines ?? []);
      const hasText = pg.hasText ?? Boolean(String(pg.text ?? "").trim());
      if (!count && hasText) {
        const text = typeof pg.textChunks === "function" ? pg.textChunks() : [String(pg.text ?? "")];
        for (const line of textLines(text)) yield line ? layoutPara(20 * TWIPS, 0, 11, line) : "<w:p/>";
      } else if (!count && pg.hasImg) {
        yield layoutPara(20 * TWIPS, 20 * TWIPS, 10, "[image-only page]");
      }
      let prevBase = null;
      let prevH = 0.0;
      for (const [x, y, size, text] of lines) {
        if (!text) continue;
        const baseTop = hPt - y;
        let before;
        if (prevBase === null) before = Math.max(0.0, baseTop - size);
        else before = Math.max(0.0, baseTop - prevBase - prevH);
        prevBase = baseTop;
        prevH = size * LH;
        yield layoutPara(x * TWIPS, before * TWIPS, size, text);
      }
      if (i < pageCount - 1) yield `<w:p><w:pPr>${sectPr(wPt, hPt)}</w:pPr></w:p>`;
      else yield sectPr(wPt, hPt);
      i += 1;
    }
    if (i !== pageCount) throw new Error("Page count changed while writing DOCX");
    if (pageCount === 0) yield sectPr(612.0, 792.0);
    yield "</w:body></w:document>";
  }

  const zip = new ZipStreamWriter(outPath);
  try {
    await zip.writestr("[Content_Types].xml", CONTENT_TYPES);
    await zip.writestr("_rels/.rels", RELS);
    await zip.member("word/document.xml").stream(body());
    await zip.close();
  } finally {
    zip.abort();
  }
  return outPath;
}


export async function writeDocxPlain(outPath, text) {
  async function* body() {
    yield DOC_HEAD;
    const chunks = typeof text === "string" || text == null ? [String(text ?? "")] : text;
    for (const line of textLines(chunks)) {
      yield line ? layoutPara(0.0, 0.0, 11.0, line) : "<w:p/>";
    }
    yield sectPr(612.0, 792.0);
    yield "</w:body></w:document>";
  }
  const zip = new ZipStreamWriter(outPath);
  try {
    await zip.writestr("[Content_Types].xml", CONTENT_TYPES);
    await zip.writestr("_rels/.rels", RELS);
    await zip.member("word/document.xml").stream(body());
    await zip.close();
  } finally {
    zip.abort();
  }
  return outPath;
}


// FILE: io/zip.js
/*
(DOCX 1) DOCX branch, position 1 in the chain - a DOCX file is a zip, so this is the first read.
This module reads and writes zip archives safely: central directory, entry extraction with size limits, and a streaming zip writer.
*/
import fs from "node:fs";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { resourceLimit } from "../limits/local.js";

const MAX_ZIP_ENTRIES = resourceLimit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000);
const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const ZIP64_EOCD_LOC_SIG = 0x07064b50;

export class BadZipFile extends Error {
  constructor(msg) { super(msg); this.name = "BadZipFile"; }
}


export function readCentralDirectory(buf) {
  const maxBack = Math.min(buf.length, 66075);
  let eocd = -1;
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i >= 0 && buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) throw new BadZipFile("File is not a zip file");

  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  if (cdOffset === 0xffffffff || count === 0xffff) {
    const loc = eocd + 22;
    if (loc + 20 <= buf.length && buf.readUInt32LE(loc) === ZIP64_EOCD_LOC_SIG) {
      const z64 = Number(buf.readBigUInt64LE(loc + 8));
      if (z64 + 4 <= buf.length && buf.readUInt32LE(z64) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(z64 + 32));
        cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
      }
    }
  }

  if (!Number.isSafeInteger(count) || count > MAX_ZIP_ENTRIES) {
    throw new BadZipFile(`ZIP exceeds the ${MAX_ZIP_ENTRIES} member cap`);
  }
  if (!Number.isSafeInteger(cdOffset) || cdOffset < 0 || cdOffset > buf.length) {
    throw new BadZipFile("ZIP central directory offset is invalid");
  }

  const entries = new Map();
  let parsedCount = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CD_SIG) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    let compressSize = buf.readUInt32LE(p + 20);
    let fileSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    let localOffset = buf.readUInt32LE(p + 42);
    const nameStart = p + 46;
    const extraStart = nameStart + nameLen;
    const name = buf.toString("utf8", nameStart, extraStart);
    p = extraStart + extraLen + commentLen;

    if (fileSize === 0xffffffff || compressSize === 0xffffffff || localOffset === 0xffffffff) {
      let q = extraStart;
      const end = extraStart + extraLen;
      while (q + 4 <= end) {
        const id = buf.readUInt16LE(q);
        const sz = buf.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (fileSize === 0xffffffff && r + 8 <= end) { fileSize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (compressSize === 0xffffffff && r + 8 <= end) { compressSize = Number(buf.readBigUInt64LE(r)); r += 8; }
          if (localOffset === 0xffffffff && r + 8 <= end) { localOffset = Number(buf.readBigUInt64LE(r)); }
          break;
        }
        q += 4 + sz;
      }
    }

    if (entries.has(name)) throw new BadZipFile(`Duplicate ZIP member ${JSON.stringify(name)}`);
    entries.set(name, { name, flags, method, crc, compressSize, file: fileSize, localOffset });
    parsedCount += 1;
  }
  if (parsedCount !== count) throw new BadZipFile("ZIP central directory is truncated");
  return entries;
}


export function readEntry(buf, entry, { maxOutputBytes = null } = {}) {
  if ((entry.flags & 0x1) !== 0) {
    throw new Error(`File ${JSON.stringify(entry.name)} is encrypted, password required for extraction`);
  }
  if (entry.method !== 0 && entry.method !== 8) {
    throw new Error(`compression type ${entry.method} for ${JSON.stringify(entry.name)} not supported`);
  }
  const lh = entry.localOffset;
  if (lh + 30 > buf.length || buf.readUInt32LE(lh) !== LOCAL_SIG) {
    throw new BadZipFile("Bad magic number for local header");
  }
  const nameLen = buf.readUInt16LE(lh + 26);
  const extraLen = buf.readUInt16LE(lh + 28);
  const start = lh + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressSize);

  let out;
  if (entry.method === 0) {
    out = data;
  } else {
    try {
      const options = Number.isFinite(maxOutputBytes) && maxOutputBytes > 0
        ? { maxOutputLength: maxOutputBytes }
        : undefined;
      out = zlib.inflateRawSync(data, options);
    } catch (e) {
      if (e && e.code === "ERR_BUFFER_TOO_LARGE") throw e;
      throw new BadZipFile(`Bad CRC-32 for file ${JSON.stringify(entry.name)}`);
    }
  }
  
  if ((entry.crc >>> 0) !== (zlib.crc32(out) >>> 0)) {
    throw new BadZipFile(`Bad CRC-32 for file ${JSON.stringify(entry.name)}`);
  }
  return out;
}


export function openZipBuffer(buf) {
  return readCentralDirectory(buf);
}

const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
class Member {
  constructor(zip, name) {
    this.zip = zip;
    this.name = name;
    this.nameBuf = Buffer.from(name, "utf8");
    this.utf8 = [...name].some((c) => c.codePointAt(0) > 0xff);
    this.time = new Date();
    this.crc = 0;
    this.size = 0;
    this.compressSize = 0;
    this.headerPos = zip.pos;
  }

  async stream(chunks) {
    const zip = this.zip;
    const flags = this.utf8 ? 0x800 : 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_SIG, 0);
    header.writeUInt16LE(20, 4);            
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8);             
    header.writeUInt16LE(dosTime(this.time), 10);
    header.writeUInt16LE(dosDate(this.time), 12);
    header.writeUInt32LE(0, 14);            
    header.writeUInt32LE(0, 18);            
    header.writeUInt32LE(0, 22);            
    header.writeUInt16LE(this.nameBuf.length, 26);
    header.writeUInt16LE(0, 28);
    zip.write(header);
    zip.write(this.nameBuf);

    const defl = zlib.createDeflateRaw({ level: zip.compresslevel });
    const src = Readable.from((async function* () {
      for await (const c of chunks) {
        const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c), "utf8");
        this.size += buf.length;
        this.crc = zlib.crc32(buf, this.crc);
        yield buf;
      }
    }).call(this));
    const done = new Promise((resolve, reject) => {
      defl.on("data", (chunk) => {
        this.compressSize += chunk.length;
        zip.write(chunk);
      });
      defl.on("error", reject);
      defl.on("end", resolve);
      src.on("error", reject);
    });
    src.pipe(defl);
    src.resume();
    await done;

    const patch = Buffer.alloc(12);
    patch.writeUInt32LE(this.crc >>> 0, 0);
    patch.writeUInt32LE(this.compressSize, 4);
    patch.writeUInt32LE(this.size, 8);
    fs.writeSync(zip.fd, patch, 0, 12, this.headerPos + 14);
    zip.entries.push(this);
  }
}

export class ZipStreamWriter {
  constructor(outPath, { compresslevel = 6 } = {}) {
    this.fd = fs.openSync(outPath, "w");
    this.pos = 0;
    this.entries = [];
    this.compresslevel = compresslevel;
  }

  write(buf) {
    fs.writeSync(this.fd, buf, 0, buf.length, this.pos);
    this.pos += buf.length;
  }

  member(name) {
    return new Member(this, name);
  }

  
  async writestr(name, data) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
    await new Member(this, name).stream([buf]);
  }

  abort() {
    if (this.fd != null) fs.closeSync(this.fd);
    this.fd = null;
  }

  async close() {
    const cdStart = this.pos;
    for (const e of this.entries) {
      const cd = Buffer.alloc(46);
      cd.writeUInt32LE(CD_SIG, 0);
      cd.writeUInt16LE((3 << 8) | 20, 4);   
      cd.writeUInt16LE(20, 6);              
      cd.writeUInt16LE(e.utf8 ? 0x800 : 0, 8);
      cd.writeUInt16LE(8, 10);
      cd.writeUInt16LE(dosTime(e.time), 12);
      cd.writeUInt16LE(dosDate(e.time), 14);
      cd.writeUInt32LE(e.crc >>> 0, 16);
      cd.writeUInt32LE(e.compressSize, 20);
      cd.writeUInt32LE(e.size, 24);
      cd.writeUInt16LE(e.nameBuf.length, 28);
      cd.writeUInt16LE(0, 30);              
      cd.writeUInt16LE(0, 32);              
      cd.writeUInt16LE(0, 34);              
      cd.writeUInt16LE(0, 36);              
      cd.writeUInt32LE(0o600 << 16, 38);
      cd.writeUInt32LE(e.headerPos, 42);
      this.write(cd);
      this.write(e.nameBuf);
    }
    const cdSize = this.pos - cdStart;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(EOCD_SIG, 0);
    eocd.writeUInt16LE(this.entries.length, 8);          
    eocd.writeUInt16LE(this.entries.length, 10);         
    eocd.writeUInt32LE(cdSize, 12);
    eocd.writeUInt32LE(cdStart, 16);
    this.write(eocd);
    this.abort();
  }
}


// FILE: json-map.js
/*
(Support 26) Shared support, no chain position - JSON map loading.
This module loads and caches the JSON map files (word and glyph data) that cleanup and repair read, and maps file paths to map names.
*/
import fs from 'node:fs';
import path from 'node:path';
import { MAP_DIR } from '../_path.js';

const cache = new Map();

export function mapNameForPath(file) {
  const relative = path.relative(MAP_DIR, path.resolve(file));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative) && relative.endsWith('.json') ? relative : null;
}

export function loadMapJson(name) {
  if (typeof name !== 'string' || path.isAbsolute(name) || !name.endsWith('.json')) {
    throw new TypeError('Expected a relative JSON map name');
  }
  const file = path.resolve(MAP_DIR, name);
  if (!mapNameForPath(file)) throw new Error('JSON map must be inside the parser map directory');
  const realRoot = fs.realpathSync(MAP_DIR);
  const realFile = fs.realpathSync(file);
  const relative = path.relative(realRoot, realFile);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('JSON map must be inside the parser map directory');
  }
  const stat = fs.statSync(realFile, { bigint: true });
  const version = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  let entry = cache.get(realFile);
  if (!entry || entry.version !== version) {
    const value = JSON.parse(fs.readFileSync(realFile, 'utf8'));
    entry = { version, value };
    cache.set(realFile, entry);
  }
  return globalThis.structuredClone(entry.value);
}


// FILE: manager/index.js
/*
(Support 21) Shared support, no chain position - the Manager barrel file.
This module re-exports the Manager (Support 22), the output writers and the log helpers so importers have one place to import from.
*/



























export { Manager } from "./manager-core.js";


export { writeDocxPlain, writeDocxLayout, writePdf } from "../io/render.js";


import { getLogen } from "../../_path.js";
const { SILENT, collect, stdoutLog, tee, resolveLog } = (await getLogen()).parserLog;
export { SILENT, collect, stdoutLog, tee, resolveLog };


// FILE: manager/manager-core.js
/*
(Support 22) Shared support, no chain position - the worker pool and Manager.
This module creates worker threads (converter and OCR), submits payloads to them, and terminates them. All routing logic lives in the API dispatcher (Support 19).
*/
// Manager — thin worker pool + dispatch wrapper.
// Job/method normalization and caller-based routing live in ../api/dispatcher.js.
// This module only creates workers, submits payloads, and terminates workers.
import { Worker } from "node:worker_threads";
import fs from "node:fs/promises";
import path from "node:path";
import { dispatch } from "../api/dispatcher.js";
import { BindInput } from "../../init/bind-input.js";
import { writeOutput } from "../io/write.js";

const CONVERTER_URL = new URL("../worker/converter.js", import.meta.url);
const OCR_URL = new URL("../worker/ocr.js", import.meta.url);

export class WorkerPool {
  #workers = new Map();
  #pending = new Map();
  #seq = 0;

  #rejectPendingFor(worker, error) {
    for (const [id, entry] of this.#pending) {
      if (entry.worker !== worker) continue;
      this.#pending.delete(id);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  // There are only two worker slots in the whole parser: one converter
  // thread and one OCR thread. The caller assigns the profile/limit for the
  // next job; if that assignment changes, the same worker script is
  // recreated with the new profile instead of spawning another worker type.
  createWorker(workerKey, owner = false, { limit = null, worker: workerName = null } = {}) {
    if (workerKey !== "ocr" && workerKey !== "converter") {
      throw new TypeError(`Unsupported worker key "${workerKey}" (use "ocr" or "converter")`);
    }
    const profile = workerName || (owner ? "owner" : "site");
    const existing = this.#workers.get(workerKey);
    if (existing) {
      if (existing.owner === owner && existing.profile === profile && existing.limit === limit) {
        return existing.worker;
      }
      this.#workers.delete(workerKey);
      this.#rejectPendingFor(
        existing.worker,
        new Error("Parser worker profile changed before the job finished"),
      );
      existing.worker.terminate().catch(() => {});
    }
    const url = workerKey === "ocr" ? OCR_URL : CONVERTER_URL;
    const options = {
      workerData: {
        parserOwner: owner,
        parserWorker: workerName,
        parserLimit: limit,
        parserKey: workerKey,
      },
      env: {
        ...process.env,
        CURL_KEY: "__parser_worker_disabled__",
        CURL_KEY_SHA256: "__parser_worker_disabled__",
        MYANGUSTIS_CHAIN_DOOR: "ParserManager",
      },
    };
    // The trigger limit drives the thread limits: 0 = no resource limits,
    // any positive limit = capped; no limit sent falls back to owner/site.
    const capped = limit === null ? !owner : limit > 0;
    if (capped) {
      options.resourceLimits = { maxOldGenerationSizeMb: 256, stackSizeMb: 8 };
    }
    const worker = new Worker(url, options);
    worker.on("message", (message) => this.handleReply(message));
    worker.on("error", (error) => {
      if (this.#workers.get(workerKey)?.worker === worker) {
        this.#workers.delete(workerKey);
      }
      this.#rejectPendingFor(worker, error);
    });
    worker.on("exit", () => {
      if (this.#workers.get(workerKey)?.worker === worker) {
        this.#workers.delete(workerKey);
      }
      this.#rejectPendingFor(worker, new Error("Parser worker exited"));
    });
    this.#workers.set(workerKey, { worker, owner, profile, limit });
    return worker;
  }

  submit(worker, payload, budget = 300000) {
    const id = ++this.#seq;
    return new Promise((resolve, reject) => {
      // budget null/Infinity = no cap (limit 0): no timer at all.
      const timer = Number.isFinite(budget)
        ? setTimeout(() => {
            this.#pending.delete(id);
            reject(new Error(`Worker exceeded ${budget} ms`));
            this.terminate(worker);
          }, budget)
        : null;
      timer?.unref();
      this.#pending.set(id, { resolve, reject, timer, worker });
      try {
        worker.postMessage({ ...payload, id });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error);
      }
    });
  }

  handleReply(message) {
    const entry = this.#pending.get(message.id);
    if (!entry) return false;
    this.#pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.result ?? message);
    else entry.reject(new Error(message.error?.message ?? message.error ?? "Worker error"));
    return true;
  }

  terminate(worker) {
    for (const [workerKey, entry] of this.#workers) {
      if (entry.worker === worker) {
        this.#workers.delete(workerKey);
        worker.terminate().catch(() => {});
        return;
      }
    }
  }

  async close() {
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("Worker pool is shutting down"));
    }
    this.#pending.clear();
    for (const { worker } of this.#workers.values()) {
      worker.terminate().catch(() => {});
    }
    this.#workers.clear();
  }
}

export const pool = new WorkerPool();

// Thin Manager wrapper for existing callers (python-entry, scraper-entry).
// Delegates routing/normalization to dispatcher; pool handles worker lifecycle.
export class Manager {
  constructor({ outputDir, quiet } = {}) {
    this.outputDir = outputDir;
  }

  async dispatch(job, caller = "site", identity = null) {
    let { object } = job;
    let chainOwned = null;
    if (!object && job.inPath) {
      object = await BindInput({ path: job.inPath });
      if (object?.collected) chainOwned = object;
    }
    if (!object) {
      throw new TypeError("Manager.dispatch: job needs an object or inPath");
    }
    try {
      return await dispatch({
        object,
        method: job.method ?? "default",
        caller,
        identity,
        job,
        key: job.key ?? null,
        limit: job.limit ?? null,
        worker: job.worker ?? null,
        output: job.output ?? job.outputFormat ?? job.outputType ?? null,
      });
    } finally {
      // A collected/prepared tmp is chain-owned: the job is done with it.
      if (chainOwned) await fs.rm(chainOwned.path, { force: true }).catch(() => {});
    }
  }

  async dispatchStream(source, job = {}) {
    const object = await BindInput({ object: source });
    try {
      return await dispatch({
        object,
        method: job.method ?? "default",
        caller: "local",
        identity: job.identity ?? null,
        job,
        key: job.key ?? null,
        limit: job.limit ?? null,
        worker: job.worker ?? null,
        output: job.output ?? job.outputFormat ?? job.outputType ?? null,
      });
    } finally {
      // A collected tmp is chain-owned: the job is done with it.
      if (object?.collected) await fs.rm(object.path, { force: true }).catch(() => {});
    }
  }

  async renderPlainText(job = {}) {
    const { inPath, outPath, source = "", owner = false } = job;
    if (!inPath || !outPath || path.extname(outPath).toLowerCase() !== ".docx") {
      throw new Error("Plain text rendering requires an input file and a .docx output path");
    }
    const bytes = await fs.readFile(inPath);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return writeOutput(outPath, [{ text }], { source, owner });
  }

  async close() {
    await pool.close();
  }
}


// FILE: ocr/ocr-ops.js
/*
(OCR 2) OCR branch, position 2 in the chain - after the OCR worker entry (OCR 1).
This module handles OCR job messages: it loads the bytes, runs OCR over PDF pages or image files (OCR 3), and writes the recognized text out.
*/
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  ocrAvailable,
  initOcr,
  pdfPageCount,
  pageHasImage,
  ocrPdfPage,
  ocrPdfRegion,
  ocrImage,
  ocrImageDetailed,
  closeOcr,
} from "./ocr.js";
import { writePageStore } from "../io/write.js";
import { PdfTextSink } from "../pdf/pdf-text-sink.js";
import { PageStoreWriter } from "../io/emit.js";
import { PosScanner } from "../beautify/scan.js";
import { normalizeOutputText } from "../decoding/judgement.js";
import { getEngineNormalize } from "../../_path.js";
import {
  MAX_INPUT_BYTES,
  MAX_INPUT_MB,
  MAX_PAGES,
  MAX_TEXT_CHARS,
  OWNER_PARSER_WORKER,
} from "../limits/local.js";

export function loadOcrBytes({ inPath, data }) {
  const bytes = inPath
    ? fs.readFileSync(inPath)
    : data instanceof Uint8Array ? data : data ? new Uint8Array(data) : null;
  if (bytes && bytes.byteLength > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return bytes;
}

function loadOcrPdfSource(msg) {
  if (!msg?.inPath) return loadOcrBytes(msg ?? {});
  if (fs.statSync(msg.inPath).size > MAX_INPUT_BYTES) {
    throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
  }
  return msg.inPath;
}

export async function ocrToFile(msg) {
  const bytes = loadOcrPdfSource(msg);
  const n = await pdfPageCount(bytes);
  if (n > MAX_PAGES) throw new Error(`PDF exceeds the ${MAX_PAGES} page cap`);
  const source = msg.source ?? (msg.inPath ? path.basename(msg.inPath) : "");
  const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
  const extension = path.extname(msg.outPath).toLowerCase();
  const textOutput = extension === "" || extension === ".txt";
  const directory = fs.mkdtempSync(msg.workDir
    ? path.join(msg.workDir, "ocr-") : path.join(os.tmpdir(), "linga-ocr-job-"));
  let sink;
  let store;
  let scanner;
  try {
    scanner = new PosScanner({ directory });
    if (textOutput) sink = new PdfTextSink(directory, { includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER });
    else store = new PageStoreWriter(directory, "ocr");
    let textChars = 0;
    let normalize = null;
    for (let p = 1; p <= n; p += 1) {
      const recognized = await ocrPdfPage(bytes, p);
      textChars += recognized.length;
      if (textChars > MAX_TEXT_CHARS) throw new Error(`OCR text exceeds the ${MAX_TEXT_CHARS} character cap`);
      normalize ??= await getEngineNormalize();
      const text = normalizeOutputText(recognized, normalize);
      await scanner.writePage(p, [text]);
      if (sink) sink.addPage([text]);
      else store.addPage({ text: [text] });
    }
    store?.close();
    const written = sink ? sink.finish(msg.outPath, counts, source)
      : await writePageStore(msg.outPath, store.store, {
        directory, counts, source, includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER, layout: false,
      });
    const posScan = await scanner.finish();
    return { filename: source || null, pages: n, ...written, posScan };
  } finally {
    await scanner?.close();
    sink?.close();
    store?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function ocrImageFiles(msg) {
  const files = Array.isArray(msg.files) ? msg.files : [];
  if (!OWNER_PARSER_WORKER && files.length > 4096) throw new Error("DOCX image count exceeds the OCR limit");
  const results = [];
  for (const file of files) {
    const image = fs.readFileSync(file.path);
    if (image.byteLength > MAX_INPUT_BYTES) throw new Error(`Image exceeds the ${MAX_INPUT_MB} MB cap`);
    results.push({ id: file.id, text: await ocrImage(image) });
  }
  return results;
}

export async function handleOcrMessage(msg) {
  if (msg?.op === "ocr") return await ocrToFile(msg);
  if (msg?.op === "ocr-images") return await ocrImageFiles(msg);
  const { type, pageNumber } = msg ?? {};
  const bytes = ["pageCount", "pageHasImage", "ocrPage", "ocrRegion"].includes(type)
    ? loadOcrPdfSource(msg ?? {})
    : loadOcrBytes(msg ?? {});
  switch (type) {
    case "available":
      return await ocrAvailable();
    case "init":
      await initOcr();
      return true;
    case "pageCount":
      return await pdfPageCount(bytes);
    case "pageHasImage":
      return await pageHasImage(bytes, pageNumber);
    case "ocrPage":
      return await ocrPdfPage(bytes, pageNumber);
    case "ocrRegion":
      return await ocrPdfRegion(bytes, pageNumber, msg.bbox);
    case "ocrImageDetailed":
      return await ocrImageDetailed(bytes);
    case "close":
      await closeOcr();
      return true;
    default:
      throw new Error(`ocr.worker: unknown message ${JSON.stringify(type ?? msg?.op)}`);
  }
}


// FILE: ocr/ocr.js
/*
(OCR 3) OCR branch, position 3 in the chain - called by the OCR operations (OCR 2).
This module wraps the OCR engine: availability checks, initialization, per-image and per-PDF-page recognition, and image-page detection.
*/
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { OCR_MODEL_DIR } from "../../_path.js";
import { MAX_OCR_PIXELS } from "../limits/local.js";
import {
  pageHasRasterImage,
  pdfPageCount as countPdfPages,
  renderPdfPagePng,
  renderPdfRegionPng,
} from "../pdf/pdf-render.js";

const OCR_CACHE_DIR = path.join(os.tmpdir(), "linga-ocr");
const BUNDLED_OCR_MODEL_DIR = OCR_MODEL_DIR;
const DEFAULT_LANGS = (process.env.PRASER_OCR_LANG || "mya")
  .split(/[+,]/).map((s) => s.trim()).filter(Boolean);

let workerPromise = null;
let workerKey = null;





function findInDir(dir, langs) {
  if (!dir || !fs.existsSync(dir)) return null;
  for (const lang of langs) {
    if (fs.existsSync(path.join(dir, `${lang}.traineddata.gz`))) return { lang, gzip: true };
    if (fs.existsSync(path.join(dir, `${lang}.traineddata`))) return { lang, gzip: false };
  }
  return null;
}


function findLangPath(langs) {
  const customDir = process.env.PRASER_OCR_LANG_PATH;
  let hit = findInDir(customDir, langs);
  if (hit) return { path: path.resolve(customDir), gzip: hit.gzip };

  hit = findInDir(BUNDLED_OCR_MODEL_DIR, langs);
  if (hit) return { path: BUNDLED_OCR_MODEL_DIR, gzip: hit.gzip };

  const base = path.resolve("node_modules/@tesseract.js-data");
  if (fs.existsSync(base)) {
    for (const lang of langs) {
      const dir = path.join(base, lang);
      if (!fs.existsSync(dir)) continue;
      const versions = fs.readdirSync(dir)
        .filter((v) => fs.existsSync(path.join(dir, v, `${lang}.traineddata.gz`)))
        .sort()
        .reverse();
      if (versions.length) return { path: path.join(dir, versions[0]), gzip: true };
    }
  }
  return null;
}


export async function ocrAvailable() {
  try {
    await import("tesseract.js");
    await import("../pdf/pdf-render.js");
    return true;
  } catch {
    return false;
  }
}


export async function initOcr({ langs = DEFAULT_LANGS, log = () => {} } = {}) {
  const key = langs.join("+");
  if (!workerPromise || workerKey !== key) {
    workerKey = key;
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const found = findLangPath(langs);
      const options = {
        cacheMethod: "none",
        logger: () => {},


        workerPath: path.join(path.dirname(fileURLToPath(import.meta.url)), "ocr-no-relaxedsimd.cjs"),
      };
      if (found) {
        options.langPath = found.path;
        options.gzip = found.gzip;
      } else {
        fs.mkdirSync(OCR_CACHE_DIR, { recursive: true });
        options.cachePath = OCR_CACHE_DIR;
      }
      log(`[+] OCR: tesseract.js ${key}${found ? ` (traineddata: ${path.relative(process.cwd(), found.path)})` : " (downloads traineddata once)"}`);
      return createWorker(langs, 1, options);
    })();
  }
  return workerPromise;
}

function flattenOcrRegions(blocks) {
  const regions = [];
  for (const block of blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        for (const word of line.words || []) {
          regions.push({
            text: word.text || "",
            confidence: Number(word.confidence) || 0,
            bbox: word.bbox ? { ...word.bbox } : null,
            symbols: (word.symbols || []).map((symbol) => ({
              text: symbol.text || "",
              confidence: Number(symbol.confidence) || 0,
              bbox: symbol.bbox ? { ...symbol.bbox } : null,
            })),
          });
        }
      }
    }
  }
  return regions;
}


export async function ocrImageDetailed(source, { log = () => {} } = {}) {
  const bytes = Buffer.isBuffer(source) ? source : Buffer.from(source);
  const worker = await initOcr({ log });
  const { data } = await worker.recognize(bytes, {}, { text: true, blocks: true });
  return {
    text: data.text || "",
    confidence: Number(data.confidence) || 0,
    regions: flattenOcrRegions(data.blocks),
  };
}

export async function ocrImage(source, options = {}) {
  return (await ocrImageDetailed(source, options)).text;
}


export async function pageHasImage(source, pageNumber) {
  return pageHasRasterImage(source, pageNumber);
}


export async function pdfPageCount(source) {
  return countPdfPages(source);
}


export async function ocrPdfPage(source, pageNumber, { scale = 3, log = () => {} } = {}) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new Error("OCR scale must be greater than zero and at most 4");
  }


  const rendered = await renderPdfPagePng(source, pageNumber, { scale, maxPixels: MAX_OCR_PIXELS });
  const pixels = rendered.width * rendered.height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_OCR_PIXELS) {
    throw new Error(`OCR page exceeds the ${MAX_OCR_PIXELS} pixel cap`);
  }
  return ocrImage(rendered.png, { log });
}


export async function ocrPdfRegion(source, pageNumber, bbox, { scale = 3, log = () => {} } = {}) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new Error("OCR scale must be greater than zero and at most 4");
  }
  const rendered = await renderPdfRegionPng(source, pageNumber, bbox, { scale, maxPixels: MAX_OCR_PIXELS });
  return ocrImage(rendered.png, { log });
}

export async function closeOcr() {
  if (!workerPromise) return;
  try {
    const worker = await workerPromise;
    await worker.terminate();
  } catch { /* worker never started */ }
  workerPromise = null;
  workerKey = null;
}


// FILE: original-pdf-cache.js
/*
(PDF 37) PDF branch, position 37 in the chain - the bridge from parsing to the repair stage (Repair 1).
This module keeps one shared handle on the job's prepared PDF, so later stages (repair's line-SVG requests) read the same file instead of loading the PDF again.
*/
import fs from "node:fs";
import { openPdfScannedObjects } from "./pdf/pdf-objects.js";
import { analysePage, lineSvgFor } from "./beautify/repair/make-line.js";

// One shared original-PDF handle for a job.
//
// Parser prepares the PDF once and wraps that exact prepared file here;
// later stages (repair's line-SVG requests) ask this same handle instead of
// loading the PDF again. Page scenes and line SVGs are built lazily and
// retained on the handle for the life of the job: even whole-book line SVGs
// are small next to the parser's baseline, and sharing them is the point.
export function createOriginalPdfCache({
  sourcePdf = null,
  preparedPdf = null,
  pdf = null,
  directory = null,
  exportLineSvg: exportLineSvgImpl = null,
  exportPageSvg: exportPageSvgImpl = null,
  // A pdf2svg-style page export: ({ page, ... }) -> SVG text, or
  // { svg, lines } with the page's own line metadata in svg-page
  // coordinates. When supplied, broken-line SVGs are framed from it by
  // the JS make-line mirror (core/beautify/repair/make-line.js).
  exportPageSvgText: exportPageSvgTextImpl = null,
} = {}) {
  let scannedHandle = null;
  let closed = false;
  const pageScenes = new Map();
  const pageAnalyses = new Map();
  const lineSvgs = new Map();

  const notImplemented = (request = null) => {
    const error = new Error("JS PDF line SVG exporter is not implemented for this original-PDF cache yet");
    error.code = "PDF_LINE_SVG_NOT_IMPLEMENTED";
    if (request) error.request = request;
    return error;
  };

  const cache = {
    sourcePdf,
    preparedPdf: preparedPdf ?? pdf ?? sourcePdf,
    pdf: preparedPdf ?? pdf ?? sourcePdf,
    directory,

    // The prepared PDF is scanned at most once per handle; every later stage
    // reuses the same object index instead of opening the file again.
    scannedObjects() {
      if (closed) throw new Error("original-PDF cache is closed");
      if (!cache.pdf) throw new TypeError("original-PDF cache has no PDF to scan");
      scannedHandle ??= openPdfScannedObjects(cache.pdf);
      return scannedHandle.objects;
    },

    // One page scene per page, built on first ask and kept for reuse.
    async pageScene(page, buildPageScene = null) {
      if (closed) throw new Error("original-PDF cache is closed");
      const key = String(page);
      if (pageScenes.has(key)) return pageScenes.get(key);
      const builder = buildPageScene ?? exportPageSvgImpl;
      if (typeof builder !== "function") throw notImplemented({ page });
      const scene = await builder({
        cache, page, sourcePdf: cache.sourcePdf, preparedPdf: cache.preparedPdf, pdf: cache.pdf,
      });
      pageScenes.set(key, scene);
      return scene;
    },

    // Repair contract: one broken line in, that line's SVG response out.
    async exportLineSvg(request = {}) {
      if (closed) throw new Error("original-PDF cache is closed");
      const key = String(request.id ?? `${request.page ?? "unknown"}:${request.line ?? "unknown"}`);
      if (lineSvgs.has(key)) return lineSvgs.get(key);
      let response;
      if (typeof exportLineSvgImpl === "function") {
        response = await exportLineSvgImpl({
          ...request,
          cache,
          sourcePdf: cache.sourcePdf,
          preparedPdf: cache.preparedPdf,
          pdf: cache.pdf,
        });
      } else if (typeof exportPageSvgTextImpl === "function") {
        const pageKey = String(request.page);
        if (!pageAnalyses.has(pageKey)) {
          const exported = await exportPageSvgTextImpl({
            cache, page: request.page, sourcePdf: cache.sourcePdf,
            preparedPdf: cache.preparedPdf, pdf: cache.pdf,
          });
          const svgText = typeof exported === "string" ? exported : exported?.svg;
          if (typeof svgText !== "string" || !svgText) throw notImplemented(request);
          pageAnalyses.set(pageKey, analysePage(svgText, {
            pageLines: typeof exported === "string" ? null : (exported.lines ?? null),
          }));
        }
        response = {
          id: key,
          page: request.page,
          line: request.line,
          svg: lineSvgFor(pageAnalyses.get(pageKey), request.line, {
            label: `page ${request.page} line ${request.line}`,
          }),
        };
      } else if (typeof exportPageSvgImpl === "function") {
        const scene = await cache.pageScene(request.page);
        response = scene?.lines?.get?.(request.line)
          ?? scene?.lines?.[request.line]
          ?? scene?.lineSvgs?.get?.(key)
          ?? scene?.lineSvgs?.[key]
          ?? null;
        if (typeof response === "string") {
          response = { id: key, page: request.page, line: request.line, svg: response };
        }
        if (!response) throw notImplemented(request);
      } else {
        throw notImplemented(request);
      }
      lineSvgs.set(key, response);
      return response;
    },

    stats() {
      const sizeOf = (value) => {
        try {
          return typeof value === "string" && fs.existsSync(value) ? fs.statSync(value).size : null;
        } catch {
          return null;
        }
      };
      return {
        sourcePdf: cache.sourcePdf,
        preparedPdf: cache.preparedPdf,
        sourceBytes: sizeOf(cache.sourcePdf),
        preparedBytes: sizeOf(cache.preparedPdf),
        scanned: scannedHandle !== null,
        pageScenes: pageScenes.size,
        pageAnalyses: pageAnalyses.size,
        lineSvgs: lineSvgs.size,
        closed,
      };
    },

    close() {
      if (closed) return;
      closed = true;
      scannedHandle?.close();
      scannedHandle = null;
      pageScenes.clear();
      lineSvgs.clear();
    },
  };

  return cache;
}


// FILE: pdf/page-instructions.js
/*
(PDF 11) PDF branch, position 11 in the chain - called by the orchestrator (PDF 10) before any page text is read.
This module decodes only what lives outside the PDF's streams - the dictionaries - and reports per-page instructions: page order, size, fonts and content references. Stream bodies are never opened here. With pagesOnly it reports only the page tree (count, order, boxes, rotation) - the OCR mode: OCR renders pages and needs no decoding facts.
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

function buildInstructions(objects, { census = false, pagesOnly = false } = {}) {
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
    // OCR (pagesOnly) keeps only the page tree: fonts are decoding
    // facts an OCR job never uses, so the font pass is skipped whole.
    const fonts = pagesOnly ? [] : pageFonts(pageKey).map((font) => ({
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
      ...(pagesOnly ? {} : {
      fonts,
      contents: contentKeys.map((contentKey) => {
        const dict = dictText(contentKey);
        return {
          key: contentKey,
          length: /\/Length\s+(\d+)/u.exec(dict)?.[1] ?? "?",
          filter: fieldName(dict, "Filter") ?? "none",
        };
      }),
      }),
    };
  });

  const decoded = pagesOnly
    ? { rootPages: rootPagesKey, pageCount: pages.length, pages }
    : { catalog: catalogKey, rootPages: rootPagesKey, info, pages };
  if (census && !pagesOnly) {
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
export function decodePdfInstructions(objects, { pagesOnly = false } = {}) {
  return buildInstructions(objects, { pagesOnly });
}

// Decode a PDF (path or bytes) from outside-stream dictionaries only,
// with the full object census. Stream bodies are never opened, so every
// content/font stream is a reference, not bytes.
export function decodeOutsideStream(source, { maxObjects, pagesOnly = false } = {}) {
  const { objects, close } = openPdfScannedObjects(source, { maxObjects });
  try {
    return buildInstructions(objects, { census: !pagesOnly, pagesOnly });
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


// FILE: pdf/pdf-content.js
/*
(PDF 14) PDF branch, position 14 in the chain - helper of the extraction (PDF 13).
This module decodes a page's content streams exactly once and spools the bytes to a scratch file, so parsing never decompresses the same stream twice.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Unzlib } from "fflate";
import { PdfName, PdfRef } from "./pdf-fonts.js";

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

// A small compressed input block also bounds the output produced by a single
// deflate push, even for highly compressible page commands.
const ENCODED_CHUNK = 1024;
const PLAIN_CHUNK = 64 * 1024;

function writeAll(fd, data, offset) {
  let written = 0;
  while (written < data.length) {
    const count = fs.writeSync(fd, data, written, data.length - written, offset + written);
    if (!count) throw new Error("Could not write the PDF content spool");
    written += count;
  }
}

function readRange(fd, position, length) {
  const data = Buffer.allocUnsafe(length);
  const read = fs.readSync(fd, data, 0, length, position);
  if (!read && length) throw new Error("PDF content stream ended early");
  return data.subarray(0, read);
}

function needsPreparedDecode(message) {
  const error = new Error(message);
  error.code = "PDF_CONTENT_DECODE_REQUIRED";
  return error;
}

function contentFilter(loader, dictionary, ref) {
  let filter = loader.resolve(dictionary.get("Filter"));
  if (Array.isArray(filter)) filter = filter.map((entry) => loader.resolve(entry));
  const list = filter == null ? [] : Array.isArray(filter) ? filter : [filter];
  const names = list.map((entry) => entry instanceof PdfName ? String(entry) : "");
  if (names.length > 1 || (names.length === 1 && !["FlateDecode", "Fl"].includes(names[0]))) {
    throw needsPreparedDecode(`PDF content stream ${ref} uses an unsupported filter; prepare it with qpdf first`);
  }
  const rawParms = loader.resolve(dictionary.get("DecodeParms"));
  const params = Array.isArray(rawParms) ? rawParms : [rawParms];
  for (const value of params) {
    const entry = loader.resolve(value);
    const predictor = entry instanceof Map ? loader.resolve(entry.get("Predictor")) : null;
    if (predictor != null && Number(predictor) !== 1) {
      throw needsPreparedDecode(`PDF content stream ${ref} uses an unsupported predictor`);
    }
  }
  return names.length > 0;
}

function* decodedChunks(loader, ref, maxBytes) {
  const dictionary = loader.objectValue(ref);
  if (!(dictionary instanceof Map)) throw new Error(`Missing PDF content stream ${ref}`);
  const length = loader.resolve(dictionary.get("Length"));
  const range = loader.objects.streamRange(ref.key(), length);
  if (!range) throw new Error(`Missing PDF content stream ${ref}`);
  const compressed = contentFilter(loader, dictionary, ref);
  let total = 0;
  let position = 0;
  if (!compressed) {
    while (position < range.length) {
      const bytes = readRange(range.fd, range.start + position, Math.min(PLAIN_CHUNK, range.length - position));
      position += bytes.length;
      total += bytes.length;
      if (total > maxBytes) throw new Error(`PDF content stream exceeds the ${maxBytes} byte cap`);
      yield bytes;
    }
    return;
  }

  const pending = [];
  const decoder = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new Error(`PDF content stream exceeds the ${maxBytes} byte cap`);
    if (chunk.length) pending.push(Buffer.from(chunk));
  });
  if (!range.length) throw new Error(`Invalid compressed PDF content stream ${ref}`);
  while (position < range.length) {
    const bytes = readRange(range.fd, range.start + position, Math.min(ENCODED_CHUNK, range.length - position));
    position += bytes.length;
    decoder.push(bytes, position === range.length);
    while (pending.length) yield pending.shift();
  }
}

// Spool each decoded stream once. The checkpoint contains exactly the first
// 2,048 decoded bytes across /Contents, and the same decoded bytes are then
// read from the spool for parsing without repeating the decompression.
export function spoolPageContent(loader, pageNum, pageGen, {
  maxBytes, inspect = () => {}, scratchDir = null,
} = {}) {
  if (maxBytes !== Infinity && (!Number.isSafeInteger(maxBytes) || maxBytes < 1)) {
    throw new RangeError("A content stream limit is required");
  }
  const page = loader.resolve(new PdfRef(pageNum, pageGen));
  const references = page instanceof Map ? streamReferences(loader, page.get("Contents")) : [];
  const dir = scratchDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "myangustis-page-"));
  const file = path.join(dir, `commands-${process.pid}-${Math.random().toString(36).slice(2)}.bin`);
  let fd = null;
  try {
    fd = fs.openSync(file, "wx+", 0o600);
    const entries = [];
    const prefix = [];
    let prefixSize = 0;
    let inspected = false;
    let position = 0;
    const inspectOnce = () => {
      if (inspected) return;
      inspected = true;
      inspect(Buffer.concat(prefix, prefixSize), references);
    };
    for (const ref of references) {
      const start = position;
      for (const chunk of decodedChunks(loader, ref, maxBytes)) {
        if (prefixSize < PAGE_CONTENT_PREFIX_BYTES) {
          const size = Math.min(chunk.length, PAGE_CONTENT_PREFIX_BYTES - prefixSize);
          prefix.push(Buffer.from(chunk.subarray(0, size)));
          prefixSize += size;
          if (prefixSize === PAGE_CONTENT_PREFIX_BYTES) inspectOnce();
        }
        writeAll(fd, chunk, position);
        position += chunk.length;
      }
      entries.push({ start, length: position - start });
    }
    inspectOnce();
    return {
      fd, file, size: position, references, streams: entries,
      close() {
        if (fd !== null) { fs.closeSync(fd); fd = null; }
        fs.rmSync(file, { force: true });
        if (scratchDir === null) fs.rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    if (scratchDir === null) fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}


// FILE: pdf/pdf-encodings.js
/*
(PDF 17) PDF branch, position 17 in the chain - data tables for the font decoders (PDF 16).
This module holds the built-in PDF encoding tables (WinAnsi, MacRoman, standard encoding) and the glyph-name to Unicode map.
*/

export const WIN_ANSI_ENCODING = new Map([
  [32, ' '], [33, '!'], [34, '"'], [35, '#'],
  [36, '$'], [37, '%'], [38, '&'], [39, '\''],
  [40, '('], [41, ')'], [42, '*'], [43, '+'],
  [44, ','], [45, '-'], [46, '.'], [47, '/'],
  [48, '0'], [49, '1'], [50, '2'], [51, '3'],
  [52, '4'], [53, '5'], [54, '6'], [55, '7'],
  [56, '8'], [57, '9'], [58, ':'], [59, ';'],
  [60, '<'], [61, '='], [62, '>'], [63, '?'],
  [64, '@'], [65, 'A'], [66, 'B'], [67, 'C'],
  [68, 'D'], [69, 'E'], [70, 'F'], [71, 'G'],
  [72, 'H'], [73, 'I'], [74, 'J'], [75, 'K'],
  [76, 'L'], [77, 'M'], [78, 'N'], [79, 'O'],
  [80, 'P'], [81, 'Q'], [82, 'R'], [83, 'S'],
  [84, 'T'], [85, 'U'], [86, 'V'], [87, 'W'],
  [88, 'X'], [89, 'Y'], [90, 'Z'], [91, '['],
  [92, '\\'], [93, ']'], [94, '^'], [95, '_'],
  [96, '`'], [97, 'a'], [98, 'b'], [99, 'c'],
  [100, 'd'], [101, 'e'], [102, 'f'], [103, 'g'],
  [104, 'h'], [105, 'i'], [106, 'j'], [107, 'k'],
  [108, 'l'], [109, 'm'], [110, 'n'], [111, 'o'],
  [112, 'p'], [113, 'q'], [114, 'r'], [115, 's'],
  [116, 't'], [117, 'u'], [118, 'v'], [119, 'w'],
  [120, 'x'], [121, 'y'], [122, 'z'], [123, '{'],
  [124, '|'], [125, '}'], [126, '~'], [127, '\u007f'],
  [128, '\u20ac'], [129, '\u2022'], [130, '\u201a'], [131, '\u0192'],
  [132, '\u201e'], [133, '\u2026'], [134, '\u2020'], [135, '\u2021'],
  [136, '\u02c6'], [137, '\u2030'], [138, '\u0160'], [139, '\u2039'],
  [140, '\u0152'], [141, '\u2022'], [142, '\u017d'], [143, '\u2022'],
  [144, '\u2022'], [145, '\u2018'], [146, '\u2019'], [147, '\u201c'],
  [148, '\u201d'], [149, '\u2022'], [150, '\u2013'], [151, '\u2014'],
  [152, '\u02dc'], [153, '\u2122'], [154, '\u0161'], [155, '\u203a'],
  [156, '\u0153'], [157, '\u2022'], [158, '\u017e'], [159, '\u0178'],
  [160, '\u00a0'], [161, '\u00a1'], [162, '\u00a2'], [163, '\u00a3'],
  [164, '\u00a4'], [165, '\u00a5'], [166, '\u00a6'], [167, '\u00a7'],
  [168, '\u00a8'], [169, '\u00a9'], [170, '\u00aa'], [171, '\u00ab'],
  [172, '\u00ac'], [173, '\u00ad'], [174, '\u00ae'], [175, '\u00af'],
  [176, '\u00b0'], [177, '\u00b1'], [178, '\u00b2'], [179, '\u00b3'],
  [180, '\u00b4'], [181, '\u00b5'], [182, '\u00b6'], [183, '\u00b7'],
  [184, '\u00b8'], [185, '\u00b9'], [186, '\u00ba'], [187, '\u00bb'],
  [188, '\u00bc'], [189, '\u00bd'], [190, '\u00be'], [191, '\u00bf'],
  [192, '\u00c0'], [193, '\u00c1'], [194, '\u00c2'], [195, '\u00c3'],
  [196, '\u00c4'], [197, '\u00c5'], [198, '\u00c6'], [199, '\u00c7'],
  [200, '\u00c8'], [201, '\u00c9'], [202, '\u00ca'], [203, '\u00cb'],
  [204, '\u00cc'], [205, '\u00cd'], [206, '\u00ce'], [207, '\u00cf'],
  [208, '\u00d0'], [209, '\u00d1'], [210, '\u00d2'], [211, '\u00d3'],
  [212, '\u00d4'], [213, '\u00d5'], [214, '\u00d6'], [215, '\u00d7'],
  [216, '\u00d8'], [217, '\u00d9'], [218, '\u00da'], [219, '\u00db'],
  [220, '\u00dc'], [221, '\u00dd'], [222, '\u00de'], [223, '\u00df'],
  [224, '\u00e0'], [225, '\u00e1'], [226, '\u00e2'], [227, '\u00e3'],
  [228, '\u00e4'], [229, '\u00e5'], [230, '\u00e6'], [231, '\u00e7'],
  [232, '\u00e8'], [233, '\u00e9'], [234, '\u00ea'], [235, '\u00eb'],
  [236, '\u00ec'], [237, '\u00ed'], [238, '\u00ee'], [239, '\u00ef'],
  [240, '\u00f0'], [241, '\u00f1'], [242, '\u00f2'], [243, '\u00f3'],
  [244, '\u00f4'], [245, '\u00f5'], [246, '\u00f6'], [247, '\u00f7'],
  [248, '\u00f8'], [249, '\u00f9'], [250, '\u00fa'], [251, '\u00fb'],
  [252, '\u00fc'], [253, '\u00fd'], [254, '\u00fe'], [255, '\u00ff'],
]);

export const MAC_ROMAN_ENCODING = new Map([
  [32, ' '], [33, '!'], [34, '"'], [35, '#'],
  [36, '$'], [37, '%'], [38, '&'], [39, '\''],
  [40, '('], [41, ')'], [42, '*'], [43, '+'],
  [44, ','], [45, '-'], [46, '.'], [47, '/'],
  [48, '0'], [49, '1'], [50, '2'], [51, '3'],
  [52, '4'], [53, '5'], [54, '6'], [55, '7'],
  [56, '8'], [57, '9'], [58, ':'], [59, ';'],
  [60, '<'], [61, '='], [62, '>'], [63, '?'],
  [64, '@'], [65, 'A'], [66, 'B'], [67, 'C'],
  [68, 'D'], [69, 'E'], [70, 'F'], [71, 'G'],
  [72, 'H'], [73, 'I'], [74, 'J'], [75, 'K'],
  [76, 'L'], [77, 'M'], [78, 'N'], [79, 'O'],
  [80, 'P'], [81, 'Q'], [82, 'R'], [83, 'S'],
  [84, 'T'], [85, 'U'], [86, 'V'], [87, 'W'],
  [88, 'X'], [89, 'Y'], [90, 'Z'], [91, '['],
  [92, '\\'], [93, ']'], [94, '^'], [95, '_'],
  [96, '`'], [97, 'a'], [98, 'b'], [99, 'c'],
  [100, 'd'], [101, 'e'], [102, 'f'], [103, 'g'],
  [104, 'h'], [105, 'i'], [106, 'j'], [107, 'k'],
  [108, 'l'], [109, 'm'], [110, 'n'], [111, 'o'],
  [112, 'p'], [113, 'q'], [114, 'r'], [115, 's'],
  [116, 't'], [117, 'u'], [118, 'v'], [119, 'w'],
  [120, 'x'], [121, 'y'], [122, 'z'], [123, '{'],
  [124, '|'], [125, '}'], [126, '~'], [127, '\u007f'],
  [128, '\u00c4'], [129, '\u00c5'], [130, '\u00c7'], [131, '\u00c9'],
  [132, '\u00d1'], [133, '\u00d6'], [134, '\u00dc'], [135, '\u00e1'],
  [136, '\u00e0'], [137, '\u00e2'], [138, '\u00e4'], [139, '\u00e3'],
  [140, '\u00e5'], [141, '\u00e7'], [142, '\u00e9'], [143, '\u00e8'],
  [144, '\u00ea'], [145, '\u00eb'], [146, '\u00ed'], [147, '\u00ec'],
  [148, '\u00ee'], [149, '\u00ef'], [150, '\u00f1'], [151, '\u00f3'],
  [152, '\u00f2'], [153, '\u00f4'], [154, '\u00f6'], [155, '\u00f5'],
  [156, '\u00fa'], [157, '\u00f9'], [158, '\u00fb'], [159, '\u00fc'],
  [160, '\u2020'], [161, '\u00b0'], [162, '\u00a2'], [163, '\u00a3'],
  [164, '\u00a7'], [165, '\u2022'], [166, '\u00b6'], [167, '\u00df'],
  [168, '\u00ae'], [169, '\u00a9'], [170, '\u2122'], [171, '\u00b4'],
  [172, '\u00a8'], [173, '\u2260'], [174, '\u00c6'], [175, '\u00d8'],
  [176, '\u221e'], [177, '\u00b1'], [178, '\u2264'], [179, '\u2265'],
  [180, '\u00a5'], [181, '\u00b5'], [182, '\u2202'], [183, '\u2211'],
  [184, '\u220f'], [185, '\u03c0'], [186, '\u222b'], [187, '\u00aa'],
  [188, '\u00ba'], [189, '\u03a9'], [190, '\u00e6'], [191, '\u00f8'],
  [192, '\u00bf'], [193, '\u00a1'], [194, '\u00ac'], [195, '\u221a'],
  [196, '\u0192'], [197, '\u2248'], [198, '\u2206'], [199, '\u00ab'],
  [200, '\u00bb'], [201, '\u2026'], [202, '\u00a0'], [203, '\u00c0'],
  [204, '\u00c3'], [205, '\u00d5'], [206, '\u0152'], [207, '\u0153'],
  [208, '\u2013'], [209, '\u2014'], [210, '\u201c'], [211, '\u201d'],
  [212, '\u2018'], [213, '\u2019'], [214, '\u00f7'], [215, '\u25ca'],
  [216, '\u00ff'], [217, '\u0178'], [218, '\u2044'], [219, '\u00a4'],
  [220, '\u2039'], [221, '\u203a'], [222, '\ufb01'], [223, '\ufb02'],
  [224, '\u2021'], [225, '\u00b7'], [226, '\u201a'], [227, '\u201e'],
  [228, '\u2030'], [229, '\u00c2'], [230, '\u00ca'], [231, '\u00c1'],
  [232, '\u00cb'], [233, '\u00c8'], [234, '\u00cd'], [235, '\u00ce'],
  [236, '\u00cf'], [237, '\u00cc'], [238, '\u00d3'], [239, '\u00d4'],
  [240, '\uf8ff'], [241, '\u00d2'], [242, '\u00da'], [243, '\u00db'],
  [244, '\u00d9'], [245, '\u0131'], [246, '\u02c6'], [247, '\u02dc'],
  [248, '\u00af'], [249, '\u02d8'], [250, '\u02d9'], [251, '\u02da'],
  [252, '\u00b8'], [253, '\u02dd'], [254, '\u02db'], [255, '\u02c7'],
]);

export const STANDARD_ENCODING = new Map([
  [32, ' '], [33, '!'], [34, '"'], [35, '#'],
  [36, '$'], [37, '%'], [38, '&'], [39, '\u2019'],
  [40, '('], [41, ')'], [42, '*'], [43, '+'],
  [44, ','], [45, '-'], [46, '.'], [47, '/'],
  [48, '0'], [49, '1'], [50, '2'], [51, '3'],
  [52, '4'], [53, '5'], [54, '6'], [55, '7'],
  [56, '8'], [57, '9'], [58, ':'], [59, ';'],
  [60, '<'], [61, '='], [62, '>'], [63, '?'],
  [64, '@'], [65, 'A'], [66, 'B'], [67, 'C'],
  [68, 'D'], [69, 'E'], [70, 'F'], [71, 'G'],
  [72, 'H'], [73, 'I'], [74, 'J'], [75, 'K'],
  [76, 'L'], [77, 'M'], [78, 'N'], [79, 'O'],
  [80, 'P'], [81, 'Q'], [82, 'R'], [83, 'S'],
  [84, 'T'], [85, 'U'], [86, 'V'], [87, 'W'],
  [88, 'X'], [89, 'Y'], [90, 'Z'], [91, '['],
  [92, '\\'], [93, ']'], [94, '^'], [95, '_'],
  [96, '\u2018'], [97, 'a'], [98, 'b'], [99, 'c'],
  [100, 'd'], [101, 'e'], [102, 'f'], [103, 'g'],
  [104, 'h'], [105, 'i'], [106, 'j'], [107, 'k'],
  [108, 'l'], [109, 'm'], [110, 'n'], [111, 'o'],
  [112, 'p'], [113, 'q'], [114, 'r'], [115, 's'],
  [116, 't'], [117, 'u'], [118, 'v'], [119, 'w'],
  [120, 'x'], [121, 'y'], [122, 'z'], [123, '{'],
  [124, '|'], [125, '}'], [126, '~'], [161, '\u00a1'],
  [162, '\u00a2'], [163, '\u00a3'], [164, '\u2044'], [165, '\u00a5'],
  [166, '\u0192'], [167, '\u00a7'], [168, '\u00a4'], [169, '\''],
  [170, '\u201c'], [171, '\u00ab'], [172, '\u2039'], [173, '\u203a'],
  [174, '\ufb01'], [175, '\ufb02'], [177, '\u2013'], [178, '\u2020'],
  [179, '\u2021'], [180, '\u00b7'], [182, '\u00b6'], [183, '\u2022'],
  [184, '\u201a'], [185, '\u201e'], [186, '\u201d'], [187, '\u00bb'],
  [188, '\u2026'], [189, '\u2030'], [191, '\u00bf'], [193, '`'],
  [194, '\u00b4'], [195, '\u02c6'], [196, '\u02dc'], [197, '\u00af'],
  [198, '\u02d8'], [199, '\u02d9'], [200, '\u00a8'], [202, '\u02da'],
  [203, '\u00b8'], [205, '\u02dd'], [206, '\u02db'], [207, '\u02c7'],
  [208, '\u2014'], [225, '\u00c6'], [227, '\u00aa'], [232, '\u0141'],
  [233, '\u00d8'], [234, '\u0152'], [235, '\u00ba'], [241, '\u00e6'],
  [245, '\u0131'], [248, '\u0142'], [249, '\u00f8'], [250, '\u0153'],
  [251, '\u00df'],
]);

export const GLYPH_NAME_TO_UNICODE = new Map([
  ['A', 'A'], ['AE', '\u00c6'], ['Aacute', '\u00c1'],
  ['Acircumflex', '\u00c2'], ['Adieresis', '\u00c4'], ['Agrave', '\u00c0'],
  ['Aring', '\u00c5'], ['Atilde', '\u00c3'], ['B', 'B'],
  ['C', 'C'], ['Ccedilla', '\u00c7'], ['D', 'D'],
  ['Delta', '\u2206'], ['E', 'E'], ['Eacute', '\u00c9'],
  ['Ecircumflex', '\u00ca'], ['Edieresis', '\u00cb'], ['Egrave', '\u00c8'],
  ['Eth', '\u00d0'], ['Euro', '\u20ac'], ['F', 'F'],
  ['G', 'G'], ['H', 'H'], ['I', 'I'],
  ['Iacute', '\u00cd'], ['Icircumflex', '\u00ce'], ['Idieresis', '\u00cf'],
  ['Igrave', '\u00cc'], ['J', 'J'], ['K', 'K'],
  ['L', 'L'], ['Lslash', '\u0141'], ['M', 'M'],
  ['N', 'N'], ['Ntilde', '\u00d1'], ['O', 'O'],
  ['OE', '\u0152'], ['Oacute', '\u00d3'], ['Ocircumflex', '\u00d4'],
  ['Odieresis', '\u00d6'], ['Ograve', '\u00d2'], ['Omega', '\u03a9'],
  ['Oslash', '\u00d8'], ['Otilde', '\u00d5'], ['P', 'P'],
  ['Q', 'Q'], ['R', 'R'], ['S', 'S'],
  ['Scaron', '\u0160'], ['T', 'T'], ['Thorn', '\u00de'],
  ['U', 'U'], ['Uacute', '\u00da'], ['Ucircumflex', '\u00db'],
  ['Udieresis', '\u00dc'], ['Ugrave', '\u00d9'], ['V', 'V'],
  ['W', 'W'], ['X', 'X'], ['Y', 'Y'],
  ['Yacute', '\u00dd'], ['Ydieresis', '\u0178'], ['Z', 'Z'],
  ['Zcaron', '\u017d'], ['a', 'a'], ['aacute', '\u00e1'],
  ['acircumflex', '\u00e2'], ['acute', '\u00b4'], ['adieresis', '\u00e4'],
  ['ae', '\u00e6'], ['agrave', '\u00e0'], ['ampersand', '&'],
  ['apple', '\uf8ff'], ['approxequal', '\u2248'], ['aring', '\u00e5'],
  ['asciicircum', '^'], ['asciitilde', '~'], ['asterisk', '*'],
  ['at', '@'], ['atilde', '\u00e3'], ['b', 'b'],
  ['backslash', '\\'], ['bar', '|'], ['braceleft', '{'],
  ['braceright', '}'], ['bracketleft', '['], ['bracketright', ']'],
  ['breve', '\u02d8'], ['brokenbar', '\u00a6'], ['bullet', '\u2022'],
  ['c', 'c'], ['caron', '\u02c7'], ['ccedilla', '\u00e7'],
  ['cedilla', '\u00b8'], ['cent', '\u00a2'], ['circumflex', '\u02c6'],
  ['colon', ':'], ['comma', ','], ['copyright', '\u00a9'],
  ['currency', '\u00a4'], ['d', 'd'], ['dagger', '\u2020'],
  ['daggerdbl', '\u2021'], ['degree', '\u00b0'], ['dieresis', '\u00a8'],
  ['divide', '\u00f7'], ['dollar', '$'], ['dotaccent', '\u02d9'],
  ['dotlessi', '\u0131'], ['e', 'e'], ['eacute', '\u00e9'],
  ['ecircumflex', '\u00ea'], ['edieresis', '\u00eb'], ['egrave', '\u00e8'],
  ['eight', '8'], ['ellipsis', '\u2026'], ['emdash', '\u2014'],
  ['endash', '\u2013'], ['equal', '='], ['eth', '\u00f0'],
  ['exclam', '!'], ['exclamdown', '\u00a1'], ['f', 'f'],
  ['fi', '\ufb01'], ['five', '5'], ['fl', '\ufb02'],
  ['florin', '\u0192'], ['four', '4'], ['fraction', '\u2044'],
  ['g', 'g'], ['germandbls', '\u00df'], ['grave', '`'],
  ['greater', '>'], ['greaterequal', '\u2265'], ['guillemotleft', '\u00ab'],
  ['guillemotright', '\u00bb'], ['guilsinglleft', '\u2039'], ['guilsinglright', '\u203a'],
  ['h', 'h'], ['hungarumlaut', '\u02dd'], ['hyphen', '-'],
  ['i', 'i'], ['iacute', '\u00ed'], ['icircumflex', '\u00ee'],
  ['idieresis', '\u00ef'], ['igrave', '\u00ec'], ['infinity', '\u221e'],
  ['integral', '\u222b'], ['j', 'j'], ['k', 'k'],
  ['l', 'l'], ['less', '<'], ['lessequal', '\u2264'],
  ['logicalnot', '\u00ac'], ['lozenge', '\u25ca'], ['lslash', '\u0142'],
  ['m', 'm'], ['macron', '\u00af'], ['mu', '\u00b5'],
  ['multiply', '\u00d7'], ['n', 'n'], ['nbspace', '\u00a0'],
  ['nine', '9'], ['notequal', '\u2260'], ['ntilde', '\u00f1'],
  ['numbersign', '#'], ['o', 'o'], ['oacute', '\u00f3'],
  ['ocircumflex', '\u00f4'], ['odieresis', '\u00f6'], ['oe', '\u0153'],
  ['ogonek', '\u02db'], ['ograve', '\u00f2'], ['one', '1'],
  ['onehalf', '\u00bd'], ['onequarter', '\u00bc'], ['onesuperior', '\u00b9'],
  ['ordfeminine', '\u00aa'], ['ordmasculine', '\u00ba'], ['oslash', '\u00f8'],
  ['otilde', '\u00f5'], ['p', 'p'], ['paragraph', '\u00b6'],
  ['parenleft', '('], ['parenright', ')'], ['partialdiff', '\u2202'],
  ['percent', '%'], ['period', '.'], ['periodcentered', '\u00b7'],
  ['perthousand', '\u2030'], ['pi', '\u03c0'], ['plus', '+'],
  ['plusminus', '\u00b1'], ['product', '\u220f'], ['q', 'q'],
  ['question', '?'], ['questiondown', '\u00bf'], ['quotedbl', '"'],
  ['quotedblbase', '\u201e'], ['quotedblleft', '\u201c'], ['quotedblright', '\u201d'],
  ['quoteleft', '\u2018'], ['quoteright', '\u2019'], ['quotesinglbase', '\u201a'],
  ['quotesingle', '\''], ['r', 'r'], ['radical', '\u221a'],
  ['registered', '\u00ae'], ['ring', '\u02da'], ['s', 's'],
  ['scaron', '\u0161'], ['section', '\u00a7'], ['semicolon', ';'],
  ['seven', '7'], ['six', '6'], ['slash', '/'],
  ['space', ' '], ['sterling', '\u00a3'], ['summation', '\u2211'],
  ['t', 't'], ['thorn', '\u00fe'], ['three', '3'],
  ['threequarters', '\u00be'], ['threesuperior', '\u00b3'], ['tilde', '\u02dc'],
  ['trademark', '\u2122'], ['two', '2'], ['twosuperior', '\u00b2'],
  ['u', 'u'], ['uacute', '\u00fa'], ['ucircumflex', '\u00fb'],
  ['udieresis', '\u00fc'], ['ugrave', '\u00f9'], ['underscore', '_'],
  ['v', 'v'], ['w', 'w'], ['x', 'x'],
  ['y', 'y'], ['yacute', '\u00fd'], ['ydieresis', '\u00ff'],
  ['yen', '\u00a5'], ['z', 'z'], ['zcaron', '\u017e'],
  ['zero', '0'],
]);

export const BASE_ENCODINGS = new Map([
  ['WinAnsiEncoding', WIN_ANSI_ENCODING],
  ['MacRomanEncoding', MAC_ROMAN_ENCODING],
  ['StandardEncoding', STANDARD_ENCODING],
  ['PDFDocEncoding', WIN_ANSI_ENCODING],
  ['MacExpertEncoding', STANDARD_ENCODING],
]);


// FILE: pdf/pdf-fonts.js
/*
(PDF 16) PDF branch, position 16 in the chain - called by the extraction (PDF 13) for every page font.
This module builds the font decoders: ToUnicode maps, embedded TrueType cmaps, standard encodings, and the legacy code-page lanes (WinInnwa/Ayar) for fonts that carry no Unicode map of their own.
*/
import { createHash } from "node:crypto";
import { pyChr } from "../pylib.js";
import { BASE_ENCODINGS, GLYPH_NAME_TO_UNICODE } from "./pdf-encodings.js";
import { isLegacyFontName, isUnresolvedLegacyFont, normaliseFontName } from "../codepage/codepage-names.js";
import { lookupLegacyCode, AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE, WININNWA_UNRESOLVED_SLOTS } from "../codepage/codepage-registry.js";
import { confirmedRunAt } from "../codepage/codepage-confirmed.js";
import { subsetFontBridge } from "../codepage/codepage-subset.js";
import { parseTtfGsubReverse, parseTtfVariantSlots } from "../codepage/ttf-gsub.js";
import { hasVisualUnicodeConflicts, matchVisualUnicodeGlyphs } from "../codepage/codepage-visual.js";







// Decode an explicitly supplied single-byte profile without /ToUnicode.
// Its direct entries can be table-seeded; review candidates require opt-in.
// Unmapped bytes are errors, not ASCII fallbacks or silently dropped text.
export function decodeRawByteSlots(data, profile, { includeReview = false } = {}) {
  if (!(data instanceof Uint8Array) && typeof data !== "string") {
    throw new TypeError("Expected raw bytes or a byte string");
  }
  const table = new Map();
  for (const source of [profile?.bytes, ...(includeReview ? [profile?.resolvedForReview] : [])]) {
    if (!source || typeof source !== "object") continue;
    for (const [hex, text] of Object.entries(source)) {
      if (!/^[0-9A-F]{2}$/u.test(hex) || typeof text !== "string" || !text.length) {
        throw new TypeError(`Invalid raw byte entry ${hex}`);
      }
      const byte = Number.parseInt(hex, 16);
      if (table.has(byte) && table.get(byte) !== text) {
        throw new Error(`Conflicting raw byte entry ${hex}`);
      }
      table.set(byte, text);
    }
  }
  const codes = typeof data === "string" ? Array.from(data, (c) => c.codePointAt(0)) : data;
  const result = [];
  for (let i = 0; i < codes.length; i += 1) {
    const byte = codes[i];
    if (byte > 255 || !table.has(byte)) {
      const hex = byte.toString(16).toUpperCase().padStart(2, "0");
      throw new Error(`Unmapped raw PDF byte ${hex} at offset ${i}`);
    }
    result.push(table.get(byte));
  }
  return result;
}

export function decodeRawBytes(data, profile, options = {}) {
  return decodeRawByteSlots(data, profile, options).join("");
}

// Input slots are already in glyph order and belong to one syllable/cluster.
// A later stacked syllable cannot change this cluster's u shape. This does not
// reorder Unicode text or verify that profile values reflect the actual font.
export function encodeRawByteSlots(slots, profile, { byteChoices = {}, includeReview = false } = {}) {
  if (!Array.isArray(slots) || slots.some((s) => typeof s !== "string" || !s.length)) {
    throw new TypeError("Expected non-empty Unicode slots");
  }
  const choices = new Map();
  const byteValues = new Map();
  for (const source of [profile?.bytes, ...(includeReview ? [profile?.resolvedForReview] : [])]) {
    for (const [hex, text] of Object.entries(source || {})) {
      if (!/^[0-9A-F]{2}$/u.test(hex) || typeof text !== "string" || !text.length) {
        throw new TypeError(`Invalid raw byte entry ${hex}`);
      }
      if (byteValues.has(hex) && byteValues.get(hex) !== text) {
        throw new Error(`Conflicting raw byte entry ${hex}`);
      }
      byteValues.set(hex, text);
      const list = choices.get(text) || [];
      if (!list.includes(hex)) list.push(hex);
      choices.set(text, list);
    }
  }
  const rules = profile?.writingRules || {};
  const u = rules.uVariants;
  const baseCount = slots.filter((slot) => {
    if (slot.startsWith("\u1004\u103A\u1039")) return false;
    const c = slot.codePointAt(0);
    return (c >= 0x1000 && c <= 0x1021) || (c >= 0x1023 && c <= 0x102A) || c === 0x103F || c === 0x104E;
  }).length;
  if (baseCount > 1 || (u && slots.includes(u.unicode) && baseCount !== 1)) {
    throw new Error("Encode one syllable/cluster at a time for contextual glyph selection");
  }
  const needsLongU = u && ((u.longInPaliOrStack && slots.some((s) => s.includes("\u1039"))) ||
    (u.longWhenContains || []).some((mark) => slots.some((s) => s.includes(mark))));
  const output = [];
  for (let i = 0; i < slots.length; i += 1) {
    // A preceding ya/ra in this one cluster selects ာ, not ါ. Glyph-order
    // ra may precede the base, so inspect the preceding slots rather than
    // assuming logical Unicode order.
    const hasMedial = baseCount === 1 && slots.slice(0, i).some((s) => /[ျြ]/u.test(s));
    const value = slots[i] === "ါ" && hasMedial ? "ာ" : slots[i];
    // When the same Unicode stack has different upper-consonant glyphs,
    // select only bytes valid after the preceding raw base.
    const available = (choices.get(value) || []).filter((candidate) => {
      const restriction = rules.restrictedBytes?.[candidate];
      if (!restriction) return true;
      const previous = output.at(-1);
      if (previous === undefined) return false;
      if (restriction.precedingBytes && !restriction.precedingBytes.includes(previous)) return false;
      const upper = byteValues.get(previous);
      if (restriction.requiresPrecedingConsonant && !/^[\u1000-\u1021]$/u.test(upper || "")) return false;
      return !(restriction.excludedPrecedingValues || []).includes(upper);
    });
    let hex = byteChoices[i];
    if (u && value === u.unicode) {
      const required = needsLongU ? u.long : u.short;
      if (hex !== undefined && hex !== required) throw new Error(`Raw glyph ${hex} violates the u-shape rule`);
      hex = required;
    }
    if (hex === undefined && available.length === 1) [hex] = available;
    if (!hex || !available.includes(hex)) {
      throw new Error(`Unresolved raw glyph for slot ${i} (${JSON.stringify(value)}); candidates: ${available.join(", ") || "none"}`);
    }
    output.push(hex);
  }
  return Uint8Array.from(output, (hex) => Number.parseInt(hex, 16));
}

export class PdfName {
  constructor(v) { this.v = v; }
  toString() { return this.v; }
  valueOf() { return this.v; }
}


export class PdfKeyword {
  constructor(v) { this.v = v; }
  toString() { return this.v; }
  valueOf() { return this.v; }
}


export class PdfFloat extends Number {}


export const isNumeric = (v) => typeof v === "number" || v instanceof PdfFloat;
export const toNumber = (v) => (typeof v === "number" ? v : v.valueOf());


export class PdfHexBytes {
  constructor(s) { this.s = s; }
}
export class PdfRef {
  constructor(num, gen = 0) {
    this.num = Math.trunc(num);
    this.gen = Math.trunc(gen);
  }
  key() { return `${this.num},${this.gen}`; }
  toString() { return `${this.num} ${this.gen} R`; }
}




const WS = "\\x00\\x09-\\x0d\\x20";
const TOKEN_RE = new RegExp(
  `[${WS}]*(?:`
  + "(?<comment>%[^\\r\\n]*)"
  + `|(?<name>/[^${WS}()<>\\[\\]{}/%]*)`
  + "|(?<num>[+-]*(?:\\d+\\.\\d*|\\.\\d+|\\d+))"
  + "|(?<dopen><<)"
  + "|(?<dclose>>>)"
  + "|(?<hex><[^>]*>)"
  + "|(?<aopen>\\[)"
  + "|(?<aclose>\\])"
  + "|(?<lit>\\()"
  + "|(?<popen>\\{)"
  + "|(?<pclose>\\})"
  + "|(?<kw>[A-Za-z'\"*][A-Za-z0-9'\"*]*)"
  + `|(?<other>[^${WS}])`
  + ")",
  "y",
);

const LIT_SPECIAL_RE = /[()\\\r]/g;

const ESCAPES = new Map([
  [0x6e, "\n"], [0x72, "\r"], [0x74, "\t"], [0x62, "\b"], [0x66, "\f"],
  [0x28, "("], [0x29, ")"], [0x5c, "\\"],
]);

export function scanLiteralString(data, i) {
  let depth = 1;
  let out = "";
  const n = data.length;
  while (i < n) {
    LIT_SPECIAL_RE.lastIndex = i;
    const m = LIT_SPECIAL_RE.exec(data);
    if (m === null) {
      out += data.slice(i);
      return [out, n];
    }
    out += data.slice(i, m.index);
    const c = m[0];
    i = m.index + 1;
    if (c === "(") {
      depth += 1;
      out += "(";
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) return [out, i];
      out += ")";
    } else if (c === "\r") {
      if (i < n && data[i] === "\n") i += 1;
      out += "\n";
    } else {
      if (i >= n) break;
      const b = data.charCodeAt(i);
      i += 1;
      if (ESCAPES.has(b)) {
        out += ESCAPES.get(b);
      } else if (b >= 0x30 && b <= 0x37) {
        let val = b - 0x30;
        for (let k = 0; k < 2; k += 1) {
          if (i < n && data.charCodeAt(i) >= 0x30 && data.charCodeAt(i) <= 0x37) {
            val = val * 8 + (data.charCodeAt(i) - 0x30);
            i += 1;
          } else break;
        }
        out += String.fromCharCode(val & 0xff);
      } else if (b === 0x0a) { // line continuation
        /* pass */
      } else if (b === 0x0d) {
        if (i < n && data[i] === "\n") i += 1;
      } else {
        out += String.fromCharCode(b);
      }
    }
  }
  return [out, n];
}


function hexToByteString(text) {
  let digits = "";
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if ((c >= "0" && c <= "9") || (c >= "A" && c <= "F") || (c >= "a" && c <= "f")) digits += c;
  }
  if (digits.length % 2) digits += "0";
  let out = "";
  for (let i = 0; i < digits.length; i += 2) {
    const v = Number.parseInt(digits.slice(i, i + 2), 16);
    if (Number.isNaN(v)) return "";
    out += String.fromCharCode(v);
  }
  return out;
}
const NAME_ESC_RE = /#([0-9A-Fa-f]{2})/g;


function decodeName(raw) {
  return raw.replace(NAME_ESC_RE, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}


export class Lexer {
  constructor(data, pos = 0) {
    this.data = data;
    this.pos = pos;
  }


  nextToken() {
    const { data } = this;
    for (;;) {
      TOKEN_RE.lastIndex = this.pos;
      const m = TOKEN_RE.exec(data);
      if (m === null || m.index !== this.pos || TOKEN_RE.lastIndex === this.pos) return null;
      this.pos = TOKEN_RE.lastIndex;
      const g = m.groups;
      if (g.comment !== undefined) continue;
      if (g.name !== undefined) return ["obj", new PdfName(decodeName(g.name.slice(1)))];
      if (g.num !== undefined) {
        const raw = g.num.replace(/^\+*/, "");
        if (raw.includes(".")) {
          const v = Number.parseFloat(raw);
          return ["obj", Number.isNaN(v) ? 0 : new PdfFloat(v)];
        }
        const v = Number.parseInt(raw, 10);
        return ["obj", Number.isNaN(v) ? 0 : v];
      }
      if (g.hex !== undefined) return ["obj", new PdfHexBytes(hexToByteString(g.hex.slice(1, -1)))];
      if (g.lit !== undefined) {
        const [s, end] = scanLiteralString(data, this.pos);
        this.pos = end;
        return ["obj", s];
      }
      if (g.kw !== undefined) {
        const kw = g.kw;
        if (kw === "true") return ["obj", true];
        if (kw === "false") return ["obj", false];
        if (kw === "null") return ["obj", null];
        return ["kw", new PdfKeyword(kw)];
      }
      if (g.dopen !== undefined) return ["dopen", null];
      if (g.dclose !== undefined) return ["dclose", null];
      if (g.aopen !== undefined) return ["aopen", null];
      if (g.aclose !== undefined) return ["aclose", null];
      if (g.popen !== undefined || g.pclose !== undefined) continue;

      return ["kw", new PdfKeyword(g.other)];
    }
  }
}

function collapseRefs(stack) {
  const top = stack[stack.length - 1];
  if (stack.length >= 3 && top instanceof PdfKeyword && String(top) === "R") {
    const gen = stack[stack.length - 2];
    const num = stack[stack.length - 3];
    if (typeof num === "number" && typeof gen === "number") {
      stack.length -= 3;
      stack.push(new PdfRef(num, gen));
      return true;
    }
  }
  return false;
}

const isKeyword = (v) => v instanceof PdfKeyword;
const isIntLike = (v) => typeof v === "number" || typeof v === "boolean";


export function parseObject(data, pos = 0) {
  const lex = new Lexer(data, pos);
  const stack = [];
  const containers = [];
  for (;;) {
    const tok = lex.nextToken();
    if (tok === null) break;
    const [kind, value] = tok;
    if (kind === "aopen") { containers.push({ type: "a", mark: stack.length }); continue; }
    if (kind === "dopen") { containers.push({ type: "d", mark: stack.length }); continue; }
    if (kind === "aclose" || kind === "dclose") {
      if (!containers.length) continue;
      const { type, mark } = containers.pop();
      const items = stack.splice(mark);
      if (type === "a") {
        stack.push(items);
      } else {
        const d = new Map();
        for (let i = 0; i < items.length - 1; i += 2) {
          const key = items[i];
          if (key instanceof PdfName) d.set(String(key), items[i + 1]);
        }
        stack.push(d);
      }
    } else if (kind === "kw") {
      stack.push(value);
      collapseRefs(stack);
      if (!containers.length && (String(value) === "stream" || String(value) === "endobj")) break;
    } else {
      stack.push(value);
    }
    if (!containers.length && stack.length && !isKeyword(stack[stack.length - 1])) {
      if (stack.length === 1 && !isIntLike(stack[0])) return stack[0];
      if (stack[stack.length - 1] instanceof PdfRef) return stack[stack.length - 1];
    }
  }
  for (const item of stack) {
    if (!isKeyword(item)) return item;
  }
  return null;
}




const UNI_NAME_RE = /^uni([0-9A-Fa-f]{4,6})$/;
const U_NAME_RE = /^u([0-9A-Fa-f]{4,6})$/;

export function glyphNameToUnicode(name) {
  if (!name || name === ".notdef") return null;
  const hit = GLYPH_NAME_TO_UNICODE.get(name);
  if (hit !== undefined) return hit;
  let m = UNI_NAME_RE.exec(name);
  if (m) {
    const hex = m[1];
    let out = "";
    for (let i = 0; i < hex.length; i += 4) {
      out += pyChr(Number.parseInt(hex.slice(i, i + 4), 16));
    }
    return out;
  }
  m = U_NAME_RE.exec(name);
  if (m) {
    const cp = Number.parseInt(m[1], 16);
    return (cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) ? pyChr(cp) : null;
  }
  if (name.includes(".")) return glyphNameToUnicode(name.split(".", 1)[0]);
  if (Array.from(name).length === 1) return name;
  return null;
}


export function buildSimpleEncoding(encodingObj, resolve) {
  encodingObj = resolve(encodingObj);
  if (encodingObj instanceof PdfName) {
    const base = BASE_ENCODINGS.get(String(encodingObj));
    if (base === undefined) return [new Map(), false];
    return [new Map(base), true];
  }
  if (encodingObj instanceof Map) {
    const baseNameVal = resolve(encodingObj.get("BaseEncoding"));
    const base = baseNameVal instanceof PdfName ? BASE_ENCODINGS.get(String(baseNameVal)) : undefined;
    let declared = base !== undefined;
    const table = new Map(base !== undefined ? base : BASE_ENCODINGS.get("StandardEncoding"));
    const diffs = resolve(encodingObj.get("Differences"));
    if (Array.isArray(diffs)) {
      let code = 0;
      for (let item of diffs) {
        item = resolve(item);
        if (isNumeric(item)) {
          code = Math.trunc(toNumber(item));
        } else if (item instanceof PdfName) {
          const ch = glyphNameToUnicode(String(item));
          if (ch !== null) table.set(code, ch);
          else table.delete(code);
          code += 1;
        }
      }
      declared = true;
    }
    return [table, declared];
  }
  return [new Map(), false];
}






export class CMapEncoding {
  constructor(identity = true) {
    this.identity = identity;
    this.widths = new Set();
    this.spaces = [];
    this.single = new Map();
    this.singleByWidth = new Map();
    this.ranges = [];
  }

  codeLengths() {
    return this.widths.size ? Array.from(this.widths).sort((a, b) => a - b) : [2];
  }

  cidFor(code, width = null) {
    if (this.identity) return code;
    const cid = width !== null && this.singleByWidth.size
      ? this.singleByWidth.get(width)?.get(code) : this.single.get(code);
    if (cid !== undefined) return cid;
    for (const [lo, hi, base, rangeWidth] of this.ranges) {
      if ((width === null || rangeWidth === undefined || rangeWidth === width) && lo <= code && code <= hi) {
        return base + (code - lo);
      }
    }
    return code;
  }

  _inSpace(code, width) {
    if (!this.spaces.length) return this.widths.size ? this.widths.has(width) : width === 2;
    return this.spaces.some(([w, lo, hi]) => w === width && code >= lo && code <= hi);
  }

  * iterCodes(data) {
    const lengths = this.codeLengths();
    for (let i = 0; i < data.length;) {
      let matched = false;
      for (const width of lengths) {
        if (i + width > data.length) continue;
        let code = 0;
        for (let k = 0; k < width; k += 1) code = code * 256 + data.charCodeAt(i + k);
        if (!this._inSpace(code, width)) continue;
        yield [code, this.cidFor(code, width), width, false];
        i += width;
        matched = true;
        break;
      }
      if (!matched) {
        // Do not pad a truncated/invalid code with zero or interpret it as a
        // different CID. Retain each unmatched byte as an explicit unknown.
        yield [data.charCodeAt(i), null, 1, true];
        i += 1;
      }
    }
  }
}

const CODESPACE_RE = /begincodespacerange([\s\S]*?)endcodespacerange/g;
const CIDRANGE_RE = /begincidrange([\s\S]*?)endcidrange/g;
const CIDCHAR_RE = /begincidchar([\s\S]*?)endcidchar/g;
const HEXPAIR_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g;
const HEXNUM_RE = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\d+)/g;
const HEXINT_RE = /<([0-9A-Fa-f]+)>\s*(\d+)/g;


export function parseCmapStream(data) {
  const text = Buffer.isBuffer(data) ? data.toString("latin1") : data;
  const enc = new CMapEncoding(false);
  let m;
  CODESPACE_RE.lastIndex = 0;
  while ((m = CODESPACE_RE.exec(text)) !== null) {
    HEXPAIR_RE.lastIndex = 0;
    let p;
    while ((p = HEXPAIR_RE.exec(m[1])) !== null) {
      const width = p[1].length / 2;
      if (!Number.isInteger(width) || width < 1 || width > 4 || p[2].length !== p[1].length) continue;
      enc.widths.add(width);
      enc.spaces.push([width, parseInt(p[1], 16), parseInt(p[2], 16)]);
    }
  }
  CIDRANGE_RE.lastIndex = 0;
  while ((m = CIDRANGE_RE.exec(text)) !== null) {
    HEXNUM_RE.lastIndex = 0;
    let p;
    while ((p = HEXNUM_RE.exec(m[1])) !== null) {
      const width = p[1].length / 2;
      if (!Number.isInteger(width) || width < 1 || width > 4 || p[2].length !== p[1].length) continue;
      enc.ranges.push([Number.parseInt(p[1], 16), Number.parseInt(p[2], 16), Number.parseInt(p[3], 10), width]);
    }
  }
  CIDCHAR_RE.lastIndex = 0;
  while ((m = CIDCHAR_RE.exec(text)) !== null) {
    HEXINT_RE.lastIndex = 0;
    let p;
    while ((p = HEXINT_RE.exec(m[1])) !== null) {
      const width = p[1].length / 2;
      if (!Number.isInteger(width) || width < 1 || width > 4) continue;
      const code = Number.parseInt(p[1], 16);
      const cid = Number.parseInt(p[2], 10);
      if (!enc.singleByWidth.has(width)) enc.singleByWidth.set(width, new Map());
      enc.singleByWidth.get(width).set(code, cid);
      enc.single.set(code, cid);
    }
  }
  if (!enc.widths.size) enc.widths.add(2);
  if (!enc.ranges.length && !enc.single.size) enc.identity = true;
  return enc;
}






export const IDENTITY = Symbol("IDENTITY");

// These are parsing routes, not encoding verdicts. The shared route
// decodes every font resource through its own cmap data (/ToUnicode first,
// then the embedded TTF cmap); the legacy route uses a legacy codepage.
export const PDF_PARSING_PATHS = Object.freeze({
  FONT_CMAP: "font-cmap",
  LEGACY: "legacy",
});

// The font name is a guard *inside* the legacy lane only: once a page is
// on the legacy lane (chosen by the English-violation check, never by a
// name), the name picks which of the two existing legacy layouts reads
// the resource. WinInnwa faces use the WinInnwa layout; the Ayar-family
// faces (Ayar, Arlarwade, Amyanmar and the other registered legacy faces)
// use the Ayar layout. An unknown face is parsed with WinInnwa and is
// flagged (known: false) so the cleaning stage can route it to the
// additional module that will be specified for unknown legacy faces.
export function legacyLayoutForFont(baseFont) {
  const name = normaliseFontName(baseFont);
  if (name.startsWith("wininnwa")) {
    return { layout: "wininnwa", codePage: WININNWA_LEGACY_CODE_PAGE, known: true };
  }
  if (/^(?:ayar|arlarwade|amyanmar)/u.test(name) || isLegacyFontName(baseFont)) {
    return { layout: "ayar", codePage: AYAR_LEGACY_CODE_PAGE, known: true };
  }
  return { layout: "wininnwa", codePage: WININNWA_LEGACY_CODE_PAGE, known: false };
}

export class CmapIdentityMap extends Map {}


export class LegacyAyarMap extends Map {}

const isSurrogate = (cp) => cp >= 0xd800 && cp <= 0xdfff;











const CATEGORY_C_RE = /\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}|\p{Cn}/u;
function isCategoryC(ch) {
  return CATEGORY_C_RE.test(ch);
}


export function mapCode(codeToUni, cid) {
  if (codeToUni === IDENTITY) {
    if (cid >= 0 && cid <= 0x10ffff && !isSurrogate(cid)) return pyChr(cid);
    return null;
  }
  const v = codeToUni.get(cid);
  if (v === undefined) {
    if (codeToUni instanceof CmapIdentityMap) {
      if (cid === 0) return " ";
      if (cid >= 0x20 && cid <= 0x10ffff && !isSurrogate(cid)) {
        const ch = pyChr(cid);
        if (!isCategoryC(ch)) return ch;
      }
    }
    return null;
  }
  return typeof v === "number" ? pyChr(v) : v;
}
export function usableToUnicode(mapping) {
  if (!mapping || !mapping.size) return null;
  let spaces = 0;
  for (const v of mapping.values()) if (v === " ") spaces += 1;
  if (spaces / mapping.size > 0.9) {
    const filtered = new Map();
    for (const [k, v] of mapping) if (v !== " ") filtered.set(k, v);
    mapping = filtered;
  }
  return mapping.size ? mapping : null;
}

// Font and object resources are reused across pages, but keeping every
// document resource forever defeats disk-backed PDF input on large books.
class ResourceCache extends Map {
  constructor(limit) { super(); this.limit = limit; }
  get(key) {
    if (!this.has(key)) return undefined;
    const value = super.get(key);
    super.delete(key);
    super.set(key, value);
    return value;
  }
  set(key, value) {
    if (this.has(key)) super.delete(key);
    super.set(key, value);
    if (this.size > this.limit) super.delete(this.keys().next().value);
    return this;
  }
}

export class DocumentDecoding {
  constructor(kind, mapping = null, legacyCodePage = null, { legacyFontNames = null, vectorRepair = null } = {}) {
    this.kind = kind;
    this.map = kind === "identity" ? IDENTITY : (mapping || new Map());
    this.keyKind = kind === "cmap" || kind === "font" ? "gid" : "code";
    this.trustFontToUnicode = kind === "tounicode" || kind === "none" || kind === "font";
    this.legacyTextFix = kind === "legacy";
    this.legacyCodePage = legacyCodePage;
    this.legacyFontNames = legacyFontNames ? new Set(legacyFontNames) : null;
    this.legacyResources = null;




    this.vectorRepair = vectorRepair;
    this.loader = null;
    this._decoders = new ResourceCache(64);
    this._pageFonts = new Map();
  }

  resetFontCache() {
    this._decoders.clear();
    this._pageFonts.clear();
  }
}


export function asDocumentDecoding(decoding) {
  if (decoding instanceof DocumentDecoding) return decoding;
  if (decoding === IDENTITY) return new DocumentDecoding("identity");
  if (decoding instanceof LegacyAyarMap) return new DocumentDecoding("legacy", decoding);
  if (decoding instanceof CmapIdentityMap) return new DocumentDecoding("cmap", decoding);
  if (!decoding || (decoding instanceof Map && decoding.size === 0)) return new DocumentDecoding("none");
  return new DocumentDecoding("tounicode", decoding);
}





const MAX_SHAPING_DEPTH = 8;



const SPACE_CODES = new Set([
  0x0009, 0x0020, 0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f,
  0x205f, 0x3000,
]);









function resolveShapedGlyphs(fontBytes, table) {
  const reverse = parseTtfGsubReverse(fontBytes);
  if (!reverse.size) return table;
  const walking = new Set();
  const resolve = (gid, depth) => {
    const direct = table.get(gid);


    if (direct !== undefined) {
      return typeof direct === "number" ? String.fromCodePoint(direct) : direct;
    }
    if (depth >= MAX_SHAPING_DEPTH || walking.has(gid)) return undefined;
    const inputs = reverse.get(gid);
    if (!inputs) return undefined;
    walking.add(gid);
    let out = "";
    for (const part of inputs) {
      const text = resolve(part, depth + 1);
      if (text === undefined) { out = undefined; break; }
      out += text;
    }
    walking.delete(gid);
    return out;
  };
  for (const gid of reverse.keys()) {
    if (table.has(gid)) continue;
    const text = resolve(gid, 0);
    if (text) table.set(gid, text);
  }







  const slots = parseTtfVariantSlots(fontBytes);
  for (let round = 0; round < 3; round += 1) {
    let added = false;
    for (const group of slots) {
      const unknown = group.filter((g) => !table.has(g));
      if (!unknown.length) continue;
      const known = new Map();
      for (const gid of group) {
        const value = table.get(gid);
        if (value === undefined) continue;
        const text = typeof value === "number" ? String.fromCodePoint(value) : value;
        if (text) known.set(text, value);
      }
      // A shaping group can contain different characters or sequences. A
      // single convenient-looking member is not evidence for the others.
      if (known.size !== 1) continue;
      const value = known.values().next().value;
      for (const gid of unknown) { table.set(gid, value); added = true; }
    }
    if (!added) break;
  }
  return table;
}

export class FontResourceLoader {
  constructor(objects, getStream, parseTtfCmap, parseToUnicodeStream) {
    this.objects = objects;
    this._getStream = getStream;
    this._parseTtfCmap = parseTtfCmap;
    this._parseToUnicode = parseToUnicodeStream;
    this._objCache = new ResourceCache(512);
    this._gidCache = new ResourceCache(32);
    this._tuCache = new ResourceCache(32);
    this._cidCache = new ResourceCache(32);
  }

  objectValue(ref) {
    const key = ref.key();
    if (this._objCache.has(key)) return this._objCache.get(key);
    const read = (objectKey) => this.objects.dictionary
      ? this.objects.dictionary(objectKey) : this.objects.get(objectKey);
    let raw = read(key);
    if (raw === undefined && ref.gen !== 0) raw = read(`${ref.num},0`);
    const value = raw ? parseObject(raw.toString("latin1")) : null;
    this._objCache.set(key, value);
    return value;
  }

  resolve(value, depth = 0) {
    while (value instanceof PdfRef && depth < 32) {
      value = this.objectValue(value);
      depth += 1;
    }
    return value;
  }

  streamOf(ref) {
    if (!(ref instanceof PdfRef)) return null;
    return this._getStream(this.objects, ref.num, ref.gen);
  }


  reversedFontCmap(descriptor) {
    descriptor = this.resolve(descriptor);
    if (!(descriptor instanceof Map)) return new Map();
    for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
      const ref = descriptor.get(key);
      if (!(ref instanceof PdfRef)) continue;
      const cacheKey = ref.key();
      if (this._gidCache.has(cacheKey)) return this._gidCache.get(cacheKey);
      const data = this.streamOf(ref);
      const table = new Map();
      if (data) {
        const cmap = this._parseTtfCmap(data) || new Map();





        const direct = new Map();
        const ambiguous = new Set();
        const codepoints = new Map();
        for (const [uni, gid] of cmap) {
          if (!gid) continue;
          if (!codepoints.has(gid)) codepoints.set(gid, new Set());
          codepoints.get(gid).add(uni);
          const prev = table.get(gid);
          if (prev === undefined || uni < prev) table.set(gid, uni);
          if (direct.has(gid) && direct.get(gid) !== uni) {
            direct.delete(gid);
            ambiguous.add(gid);
          } else if (!ambiguous.has(gid)) {
            direct.set(gid, uni);
          }
        }
        table.direct = direct;
        table.ambiguous = ambiguous;
        table.codepoints = codepoints;
        resolveShapedGlyphs(data, table);
      }
      this._gidCache.set(cacheKey, table);
      return table;
    }
    return new Map();
  }


  tounicodeOf(fontDict, { preserveSpaces = false } = {}) {
    const ref = fontDict.get("ToUnicode");
    if (!(ref instanceof PdfRef)) return null;
    const cacheKey = `${ref.key()}:${preserveSpaces ? "all" : "filtered"}`;
    if (this._tuCache.has(cacheKey)) return this._tuCache.get(cacheKey);
    const data = this.streamOf(ref);
    const parsed = data ? this._parseToUnicode(data) : null;
    const mapping = preserveSpaces ? (parsed?.size ? parsed : null) : usableToUnicode(parsed);
    this._tuCache.set(cacheKey, mapping);
    return mapping;
  }


  cidToGid(descendant) {
    const entry = descendant.get("CIDToGIDMap");
    if (entry instanceof PdfRef) {
      const key = entry.key();
      if (this._cidCache.has(key)) return this._cidCache.get(key);
      const data = this.streamOf(entry);
      if (data && data.length) {
        const count = Math.floor(data.length / 2);
        const gids = new Uint16Array(count);
        for (let i = 0; i < count; i += 1) gids[i] = data.readUInt16BE(i * 2);
        const lookup = (cid) => (cid >= 0 && cid < gids.length ? gids[cid] : 0);
        this._cidCache.set(key, lookup);
        return lookup;
      }
    }
    return null;
  }


  pageFontResources(pageNum, pageGen = 0) {
    let page = this.resolve(new PdfRef(pageNum, pageGen));
    const fonts = new Map();
    const seen = new Set();
    let depth = 0;
    while (page instanceof Map && depth < 32) {
      const resources = this.resolve(page.get("Resources"));
      if (resources instanceof Map) {
        const fontDict = this.resolve(resources.get("Font"));
        if (fontDict instanceof Map) {
          for (const [name, entry] of fontDict) {
            if (!fonts.has(name)) fonts.set(name, entry);
          }
        }
      }
      const parent = page.get("Parent");
      if (!(parent instanceof PdfRef) || seen.has(parent.key())) break;
      seen.add(parent.key());
      page = this.resolve(parent);
      depth += 1;
    }
    return fonts;
  }
}


export function detectLegacyLayoutFonts(objects, getStreamFn, parseToUnicodeFn) {  const found = [];
  const subtypeRe = /\/Subtype\s*\/(TrueType|Type1|MMType1)\b/;
  const encodingRe = /\/Encoding\s*(\/|\d)/;
  const touRe = /\/ToUnicode\s+(\d+)\s+(\d+)\s+R/;
  const baseFontRe = /\/BaseFont\s*\/([#\w+\-.]+)/;
  const simpleEncRe = /\/Encoding\s*\/(WinAnsi|MacRoman|Standard|MacExpert)Encoding\b/;
  const push = (key) => {
    const [numStr, genStr] = key.split(",");
    found.push(new PdfRef(Number.parseInt(numStr, 10), Number.parseInt(genStr, 10)));
  };
  for (const [key, body] of objects) {
    if (!Buffer.isBuffer(body)) continue;
    const text = body.toString("latin1");
    if (!text.includes("/Subtype")) continue;
    if (!subtypeRe.test(text)) continue;
    const bf = baseFontRe.exec(text);
    // A sparse /ToUnicode map does not make an unsupported face Ayar/WinInnwa.
    if (bf && isUnresolvedLegacyFont(bf[1])) continue;
    if (!text.includes("/ToUnicode")) {
      if (!bf || !isLegacyFontName(bf[1])) continue;
      const enc = /\/Encoding\s*(\/\w+|\d+\s+\d+\s+R)/.exec(text);
      if (enc && !simpleEncRe.test(text)) continue;
      push(key);
      continue;
    }
    if (encodingRe.test(text)) continue;
    const m = touRe.exec(text);
    if (!m) continue;
    let mapping;
    try {
      const raw = getStreamFn(objects, Number.parseInt(m[1], 10), Number.parseInt(m[2], 10));
      mapping = raw ? parseToUnicodeFn(raw) : new Map();
    } catch {
      continue;
    }
    if (!mapping || !mapping.size) continue;
    let totalChars = 0;
    let myanmar = 0;
    for (const v of mapping.values()) {
      for (const ch of v) {
        totalChars += 1;
        const cp = ch.codePointAt(0);
        if (cp >= 0x1000 && cp <= 0x109f) myanmar += 1;
      }
    }
    if (!totalChars) continue;
    if (myanmar / totalChars < 0.25) push(key);
  }
  return found;
}








export function legacyFontFaces(objects, getStreamFn, parseToUnicodeFn) {
  const faces = [];
  for (const ref of detectLegacyLayoutFonts(objects, getStreamFn, parseToUnicodeFn)) {
    const body = objects.get(ref.key());
    if (!Buffer.isBuffer(body)) continue;
    const text = body.toString("latin1");
    const bf = /\/BaseFont\s*\/([#\w+\-.]+)/.exec(text);
    const fd = /\/FontDescriptor\s+(\d+)\s+(\d+)\s+R/.exec(text);
    if (!bf || !fd) continue;
    const desc = objects.get(`${fd[1]},${fd[2]}`);
    const descText = Buffer.isBuffer(desc) ? desc.toString("latin1") : "";
    const ascent = /\/Ascent\s+(-?\d+(?:\.\d+)?)/.exec(descText);
    const descent = /\/Descent\s+(-?\d+(?:\.\d+)?)/.exec(descText);
    if (!ascent || !descent) continue;
    faces.push({
      ref: ref.key(),
      baseFont: bf[1],
      ascent: Number(ascent[1]) / 1000,
      descent: Number(descent[1]) / 1000,
    });
  }
  return faces;
}


// Avoid a separate rope node or array entry for every decoded byte of a large
// PDF string. The decoder's returned text is unchanged.
class DecodedTextBuilder {
  constructor() { this.batch = []; this.parts = []; }

  add(text) {
    if (!text) return;
    this.batch.push(text);
    if (this.batch.length >= 4096) {
      this.parts.push(this.batch.join(""));
      this.batch.length = 0;
    }
  }

  finish() {
    if (!this.parts.length) return this.batch.join("");
    if (this.batch.length) this.parts.push(this.batch.join(""));
    return this.parts.join("");
  }
}

export class FontDecoder {
  constructor(name, {
    subtype = "", baseFont = "", isCid = false, cmap = null, toUnicode = null,
    encoding = null, hasEncoding = false, hasPdfEncoding = hasEncoding, encodingHasDifferences = false,
    ownGids = null, doc = null, cidToGid = null,
    zawcodeGlyphs = null, confirmedRawRuns = null, fontLegacyCodePage = null,
  } = {}) {
    this.name = name;
    this.subtype = subtype;
    this.baseFont = baseFont;
    this.isCid = isCid;
    this.cmap = cmap || new CMapEncoding(true);
    this.toUnicode = toUnicode;
    this.encoding = encoding || new Map();
    this.hasEncoding = hasEncoding;
    this.hasPdfEncoding = hasPdfEncoding;
    this.encodingHasDifferences = encodingHasDifferences;
    this.ownGids = ownGids || new Map();
    this.zawcodeGlyphs = zawcodeGlyphs;
    this.confirmedRawRuns = confirmedRawRuns;
    this.fontLegacyCodePage = fontLegacyCodePage;
    this.doc = doc !== null ? doc : new DocumentDecoding("none");
    this._cidToGid = cidToGid;
    const widths = this.toUnicode?.byWidth;
    // Some simple-font PDFs encode their one-byte character codes as
    // zero-padded two-byte ToUnicode entries. Recover only when the entire
    // map is two-byte and every source code fits a simple-font byte.
    this._paddedSimpleToUnicode = !this.isCid && widths?.size === 1 && widths.has(2);
    if (this._paddedSimpleToUnicode) {
      for (const code of widths.get(2).keys()) {
        if (code < 0 || code > 0xff) { this._paddedSimpleToUnicode = false; break; }
      }
    }
    this._conflictingSpaceMap = false;
    if (this.doc.kind === "font" && this.isCid && this.toUnicode && this.ownGids.direct?.size) {
      let contradictions = 0;
      const groups = this.toUnicode.byWidth || new Map([[2, this.toUnicode]]);
      for (const [width, entries] of groups) {
        for (const [code, value] of entries) {
          if (value !== " ") continue;
          const cid = this.cmap.cidFor(code, width);
          const gid = this.gidFor(cid);
          const cp = this.ownGids.direct.get(gid);
          if (cp !== undefined && !SPACE_CODES.has(cp)) contradictions += 1;
        }
      }
      // Use only this resource's own direct cmap to detect a heavily
      // contradictory ToUnicode map. A few shaped clusters are not enough.
      this._conflictingSpaceMap = contradictions >= 4 && contradictions / this.toUnicode.size >= 0.08;
    }
    // A mixed document can contain CID text alongside simple legacy fonts.
    // Use a substantial Myanmar ToUnicode map for that CID font's raw text,
    // not the other font's legacy table. This is not an encoding verdict;
    // sparse or space-dominated maps remain on the existing fallback path.
    const mappings = this.toUnicode ? [...this.toUnicode.values()] : [];
    const myanmarMappings = mappings.filter((v) => /[\u1000-\u109f]/u.test(v)).length;
    const spaceMappings = mappings.filter((v) => v === " ").length;
    this._unicodeCidInLegacyDocument = this.doc.kind === "legacy" && this.isCid
      && this.zawcodeGlyphs === null && mappings.length >= 8 && myanmarMappings >= 4
      && myanmarMappings * 2 >= mappings.length && spaceMappings * 2 < mappings.length;
  }

  get parsingPath() {
    // A font name never selects a lane here. Only a matched resource
    // profile (confirmed raw runs or a profile legacy codepage) marks the
    // resource legacy from outside the legacy lane; in-lane layout choice
    // by name is legacyLayoutForFont's job, applied when the lane is built.
    if (this.confirmedRawRuns || this.fontLegacyCodePage
        || isUnresolvedLegacyFont(this.baseFont)) return PDF_PARSING_PATHS.LEGACY;
    return PDF_PARSING_PATHS.FONT_CMAP;
  }

  get _isSelectedLegacyFont() {
    if (isUnresolvedLegacyFont(this.baseFont)) return false;
    if (this.fontLegacyCodePage) return true;
    if (this.doc.legacyResources !== null) return this.doc.legacyResources.has(this);
    const selected = this.doc.legacyFontNames;
    if (!selected) return true;
    const normalize = (name) => String(name || "")
      .replace(/^[A-Z]{6}\+/u, "")
      .replace(/[^A-Za-z0-9]+/gu, "")
      .toLowerCase();
    const actual = normalize(this.baseFont);
    return [...selected].some((name) => normalize(name) === actual);
  }

  get _trustedToUnicode() {
    if (!this.toUnicode) return null;
    if (this.doc.trustFontToUnicode || this._unicodeCidInLegacyDocument) return this.toUnicode;
    if (this.doc.kind === "legacy" && !this._isSelectedLegacyFont) return this.toUnicode;
    return null;
  }

  get needsLegacyTextFix() {
    return this.doc.legacyTextFix && !this._unicodeCidInLegacyDocument && this._isSelectedLegacyFont;
  }

  _toUnicodeForCode(map, code, width) {
    if (!map) return undefined;
    if (!map.byWidth) return map.get(code);
    const exact = map.byWidth.get(width)?.get(code);
    return exact !== undefined ? exact
      : width === 1 && this._paddedSimpleToUnicode ? map.byWidth.get(2).get(code) : undefined;
  }

  _legacyLookup(code) {
    const page = this.fontLegacyCodePage || this.doc.legacyCodePage;
    if (!page) return null;
    if (!this._isSelectedLegacyFont) return null;
    // The selected layout belongs to the character slots, not the visual
    // font family. A page-selected simple resource can use the same layout
    // under another face; unselected resources do not inherit it.
    const pageSelected = this.doc.kind === "legacy"
      && (this.doc.legacyResources !== null || this.doc.legacyFontNames !== null);
    if (!this.toUnicode && !isLegacyFontName(this.baseFont) && !pageSelected) return null;
    if (!this.toUnicode && !this.encodingHasDifferences) {
      if (page === WININNWA_LEGACY_CODE_PAGE && WININNWA_UNRESOLVED_SLOTS.has(code)) {
        return String.fromCodePoint(code);
      }
      const direct = lookupLegacyCode(code, page);
      return direct === undefined ? null : direct;
    }
    // Differences and /ToUnicode describe PDF codes -> character slots. They
    // must be followed before applying the selected keyboard layout: a PDF
    // code such as 01 is not itself necessarily a keyboard slot.
    const src = this.toUnicode ? this._toUnicodeForCode(this.toUnicode, code, 1) : this.encoding.get(code);
    if (!src) return null;
    let out = "";
    for (const ch of src) {
      const slot = ch.codePointAt(0);
      // Keep an ambiguous legacy slot visible rather than inventing a
      // Burmese reading or confusing it with this PDF's raw byte.
      if (page === WININNWA_LEGACY_CODE_PAGE && WININNWA_UNRESOLVED_SLOTS.has(slot)) {
        out += ch;
        continue;
      }
      const hit = lookupLegacyCode(slot, page);
      if (hit === undefined) return null;
      out += hit;
    }
    return out;
  }




  _docLookup(key, cid = null) {
    if (this.zawcodeGlyphs !== null) {
      const hit = this.zawcodeGlyphs.get(key);
      return hit === undefined ? null : hit;
    }
    if (this.doc.map === IDENTITY) return mapCode(IDENTITY, key);
    if (this.doc.keyKind === "gid" && this.ownGids.size) {
      const hit = this.ownGids.get(key);
      if (hit !== undefined) return typeof hit === "number" ? pyChr(hit) : hit;















      const own = cid !== null && this.toUnicode ? this.toUnicode.get(cid) : undefined;
      if (own) {











        if (own.trim() !== "" || this._isSpaceGid(cid)) return own;




        const repaired = this._vectorRepairLookup(key, cid);
        if (repaired !== null) return repaired;


        if (this.doc && this.doc.recordBlind) this.doc.recordBlind.add(key);
        return "";
      }
    }
    return mapCode(this.doc.map, key);
  }


  _isSpaceGid(gid) {
    if (this._spaceGids === undefined) {
      const set = new Set();
      for (const [g, uni] of this.ownGids) {
        if (typeof uni === "number" && SPACE_CODES.has(uni)) set.add(g);
      }
      this._spaceGids = set;
    }


    return this._spaceGids.size === 0 || this._spaceGids.has(gid);
  }







  _vectorRepairLookup(key, cid = null) {
    const repair = this.doc ? this.doc.vectorRepair : null;
    if (!repair || !repair.byGid || !repair.byGid.size) return null;
    for (const candidate of [cid, key]) {
      if (candidate === null || candidate === undefined) continue;
      const hit = repair.byGid.get(candidate);
      if (hit !== undefined && hit !== null) return hit;
    }
    return null;
  }

  gidFor(cid) {
    if (this._cidToGid === null || this._cidToGid === undefined) return cid;
    return this._cidToGid(cid);
  }


  decodeCode(code, cid = null, width = this.isCid ? 2 : 1, useConfirmed = true) {
    if (isUnresolvedLegacyFont(this.baseFont)
        || (useConfirmed && this.confirmedRawRuns?.unresolved.has(code))) return null;
    // These are raw PDF codes, not /ToUnicode values or physical key positions.
    const confirmed = useConfirmed && !this.isCid ? this.confirmedRawRuns?.bytes?.get(code) : undefined;
    if (confirmed !== undefined) return confirmed;
    if (!this.isCid && this.doc.kind === "font" && this.fontLegacyCodePage) {
      const bridged = this._legacyLookup(code);
      if (bridged !== null) return bridged;
    }
    const tu = this._trustedToUnicode;
    const hit = this._toUnicodeForCode(tu, code, width);
    if (this.isCid && this.doc.kind === "font" && this._conflictingSpaceMap) {
      // Reuse the existing font-cmap parser for this resource when its
      // ToUnicode map is dominated by contradictory space mappings. Do not
      // invent a new direct encoding or use a different font's glyph IDs.
      const localCid = cid === null ? code : cid;
      const gid = this.gidFor(localCid);
      if (!this.ownGids.ambiguous?.has(gid)) {
        const local = this._docLookup(gid, localCid);
        if (local !== null) return local;
      }
    }
    if (hit !== undefined) return hit;
    if (!this.isCid) {
      const bridged = this._legacyLookup(code);
      if (bridged !== null) return bridged;
      if (this.hasEncoding) {
        const encoded = this.encoding.get(code);
        return encoded === undefined ? null : encoded;
      }
      return this._docLookup(code);
    }
    cid = cid === null ? code : cid;
    const key = (this.doc.keyKind === "code" || this.doc.map === IDENTITY) ? cid : this.gidFor(cid);
    return this._docLookup(key, cid);
  }


  decode(data, { useConfirmed = true, skipUnknown = false } = {}) {
    if (!data) return "";
    if (isUnresolvedLegacyFont(this.baseFont)) {
      if (skipUnknown) return "";
      // Keep raw character codes visible rather than applying a different
      // font's map, /ToUnicode, or a document-wide glyph fallback.
      const out = new DecodedTextBuilder();
      const width = this.isCid ? 4 : 2;
      if (this.isCid) {
        for (const [code] of this.cmap.iterCodes(data)) out.add(`[${code.toString(16).toUpperCase().padStart(width, "0")}]`);
      } else {
        for (const char of data) out.add(`[${char.charCodeAt(0).toString(16).toUpperCase().padStart(width, "0")}]`);
      }
      return out.finish();
    }
    if (this.zawcodeGlyphs !== null && this.doc.zawcodeStats) {
      this.doc.zawcodeStats.glyphs += Math.floor(data.length / 2);
    }
    const out = new DecodedTextBuilder();
    if (this.isCid) {
      for (const [code, cid, width, invalid] of this.cmap.iterCodes(data)) {
        const text = invalid ? null : this.decodeCode(code, cid, width, useConfirmed);
        if (text !== null) out.add(text);
        else if (!skipUnknown) out.add(`[${code.toString(16).toUpperCase().padStart(width * 2, "0")}]`);
      }
      return out.finish();
    }
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      if (useConfirmed && this.confirmedRawRuns) {
        const run = confirmedRunAt(this.confirmedRawRuns, data, i);
        if (run) {
          out.add(run.text);
          i += run.bytes.length - 1;
          continue;
        }
        if (this.confirmedRawRuns.unresolved.has(code)) {
          if (!skipUnknown) out.add(`[${code.toString(16).toUpperCase().padStart(2, "0")}]`);
          continue;
        }
      }
      let text = this.decodeCode(code, null, 1, useConfirmed);
      if (text === null) {
        text = ((code < 0x20 || (code >= 0x7f && code <= 0x9f)) && code !== 0x09 && code !== 0x0a && code !== 0x0d)
          ? "" : pyChr(code);
      }
      out.add(text);
    }
    return out.finish();
  }
}





















export class UnsetFontDecoder extends FontDecoder {


  static _hasNulByte(s) {
    for (let i = 0; i < s.length; i += 1) if (s.charCodeAt(i) === 0) return true;
    return false;
  }

  decode(data) {
    if (!data) return "";
    if (data instanceof PdfHexBytes) {
      const s = data.s;
      let out = "";
      for (let i = 0; i + 1 < s.length; i += 2) {
        const code = (s.charCodeAt(i) << 8) | s.charCodeAt(i + 1);
        const text = this._docLookup(code);
        out += text !== null ? text : `[${code.toString(16).toUpperCase().padStart(4, "0")}]`;
      }
      return out;
    }


    const byteCodes = this.doc.keyKind === "gid" && !UnsetFontDecoder._hasNulByte(data);
    const winAnsi = byteCodes ? BASE_ENCODINGS.get("WinAnsiEncoding") : null;
    let out = "";
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i);
      const simple = winAnsi ? winAnsi.get(code) : undefined;
      if (simple !== undefined) {
        out += simple;
        continue;
      }
      const text = this._docLookup(code);
      out += text !== null ? text : pyChr(code);
    }
    return out;
  }
}

export function buildFontDecoder(loader, name, entry, doc) {
  const font = loader.resolve(entry);
  if (!(font instanceof Map)) return new FontDecoder(name, { doc });
  const subtype = font.get("Subtype") instanceof PdfName ? String(loader.resolve(font.get("Subtype"))) : "";
  const baseFontVal = loader.resolve(font.get("BaseFont"));
  const baseFont = baseFontVal !== undefined && baseFontVal !== null ? String(baseFontVal) : "";
  if (subtype === "Type0") {
    const encodingRaw = font.get("Encoding");
    const encoding = loader.resolve(encodingRaw);
    let cmap;
    if (encoding instanceof PdfName) {
      cmap = new CMapEncoding(true);
    } else if (encodingRaw instanceof PdfRef) {
      const data = loader.streamOf(encodingRaw);
      cmap = data ? parseCmapStream(data) : new CMapEncoding(true);
    } else {
      cmap = new CMapEncoding(true);
    }
    const descendants = loader.resolve(font.get("DescendantFonts"));
    let descendant = new Map();
    if (Array.isArray(descendants) && descendants.length) {
      const resolved = loader.resolve(descendants[0]);
      if (resolved instanceof Map) descendant = resolved;
    }
    const descriptor = descendant.get("FontDescriptor");
    let zawcodeGlyphs = null;
    if (doc.zawcodeProfiles && encoding instanceof PdfName && String(encoding) === "Identity-H") {
      const cidMap = loader.resolve(descendant.get("CIDToGIDMap"));
      const identityGids = cidMap == null || (cidMap instanceof PdfName && String(cidMap) === "Identity");
      const resolved = loader.resolve(descriptor);
      const program = identityGids && resolved instanceof Map ? loader.streamOf(resolved.get("FontFile2")) : null;
      const digest = program ? createHash("sha256").update(program).digest("hex") : null;
      const profile = digest && doc.zawcodeProfiles[digest];
      if (profile) {
        const template = profile.template ? doc.zawcodeTemplates?.[profile.template] : profile;
        if (!template) throw new Error(`Missing ZawCode draft template for ${digest}`);
        const alternatives = { ...(template.alternatives ?? {}), ...(profile.alternatives ?? {}) };
        const glyphs = { ...(template.glyphs ?? {}), ...(profile.glyphs ?? {}) };
        const orderGlyphs = { ...(template.orderGlyphs ?? {}), ...(profile.orderGlyphs ?? {}) };
        zawcodeGlyphs = new Map(Object.entries(glyphs)
          .filter(([gid]) => !Object.hasOwn(alternatives, gid))
          .map(([gid, value]) => [Number.parseInt(gid, 16), value]));
        for (const [gid, entry] of Object.entries(orderGlyphs)) {
          if (Object.hasOwn(alternatives, gid)) continue;
          const key = Number.parseInt(gid, 16);
          if (zawcodeGlyphs.has(key) && zawcodeGlyphs.get(key) !== entry.slot) zawcodeGlyphs.delete(key);
          else zawcodeGlyphs.set(key, entry.slot);
        }
      }
    }
    // A matched profile reads raw GIDs only. Other font resources retain
    // their own ToUnicode/encoding rather than inheriting this profile.
    const toUnicode = zawcodeGlyphs === null
      ? loader.tounicodeOf(font, { preserveSpaces: doc.kind === "font" }) : null;
    const ownGids = zawcodeGlyphs === null ? loader.reversedFontCmap(descriptor) : new Map();
    const decoder = new FontDecoder(name, {
      subtype, baseFont, isCid: true, cmap, toUnicode, ownGids, doc, zawcodeGlyphs,
      hasPdfEncoding: font.has("Encoding"), cidToGid: loader.cidToGid(descendant),
    });
    if (doc.kind === "font" && doc.visualUnicodeEnabled && hasVisualUnicodeConflicts(decoder)) {
      const resolved = loader.resolve(descriptor);
      const program = resolved instanceof Map ? loader.streamOf(resolved.get("FontFile2")) : null;
      decoder.visualUnicodeGlyphs = matchVisualUnicodeGlyphs(decoder, program);
    }
    return decoder;
  }

  const [encoding, declared] = buildSimpleEncoding(font.get("Encoding"), (v) => loader.resolve(v));
  const encodingDictionary = loader.resolve(font.get("Encoding"));
  const encodingHasDifferences = encodingDictionary instanceof Map
    && Array.isArray(loader.resolve(encodingDictionary.get("Differences")));
  const descriptor = loader.resolve(font.get("FontDescriptor"));
  const normalizedFont = normaliseFontName(baseFont);
  let bridge = null;
  if (doc.kind === "legacy" && descriptor instanceof Map
      && /^(?:wininnwa|arlarwade|amyanmar|ayar)/u.test(normalizedFont)) {
    const program = loader.streamOf(descriptor.get("FontFile2"));
    const digest = program ? createHash("sha256").update(program).digest("hex") : null;
    const toUnicodeStream = loader.streamOf(font.get("ToUnicode"));
    const toUnicodeSha256 = toUnicodeStream ? createHash("sha256").update(toUnicodeStream).digest("hex") : null;
    // The bridge describes this exact font resource and its encoding, not the
    // PDF file. Unmatched resources never inherit another subset's byte map.
    bridge = subsetFontBridge({
      fontSha256: digest, toUnicodeSha256, baseFont: normalizedFont,
      firstChar: font.get("FirstChar"), lastChar: font.get("LastChar"),
      hasEncoding: font.has("Encoding"),
    });
  }
  const confirmedRawRuns = bridge?.rawRuns || null;
  const ownGids = loader.reversedFontCmap(font.get("FontDescriptor"));
  const toUnicode = loader.tounicodeOf(font, { preserveSpaces: doc.kind === "font" });
  // Inside the legacy lane the font name is only a layout guard: a matched
  // subset profile wins; otherwise the name picks WinInnwa vs Ayar, and an
  // unknown face falls back to Ayar (legacyLayoutForFont).
  const fontLegacyCodePage = doc.kind === "legacy"
    ? (bridge?.codePage || legacyLayoutForFont(baseFont).codePage)
    : null;
  return new FontDecoder(name, {
    subtype, baseFont, isCid: false, toUnicode, encoding, hasEncoding: declared, encodingHasDifferences,
    hasPdfEncoding: font.has("Encoding"), ownGids, doc,
    confirmedRawRuns, fontLegacyCodePage,
  });
}


export function pageFontDecoders(loader, pageNum, pageGen, doc) {
  const cacheKey = `${pageNum},${pageGen}`;
  if (doc._pageFonts.has(cacheKey)) return doc._pageFonts.get(cacheKey);
  const decoders = new Map();
  for (const [name, entry] of loader.pageFontResources(pageNum, pageGen)) {
    const key = entry instanceof PdfRef ? entry.key() : `${pageNum},${pageGen},${name}`;
    let decoder = doc._decoders.get(key);
    if (decoder === undefined) {
      decoder = buildFontDecoder(loader, name, entry, doc);
      doc._decoders.set(key, decoder);
    }
    decoders.set(name, decoder);
  }
  doc._pageFonts.set(cacheKey, decoders);
  return decoders;
}


// FILE: pdf/pdf-image-coverage.js
/*
(PDF 18) PDF branch, position 18 in the chain - helper of the extraction (PDF 13).
This module works out whether an image placed on a page covers nearly the whole page, which is how scanned/image pages are told apart from digital text pages.
*/
import { PdfName, PdfRef, isNumeric, toNumber } from "./pdf-fonts.js";

// Both dimensions must cover at least 95% of the MediaBox. Pixel dimensions
// alone say nothing about how large an image was placed on a PDF page.
export const NEAR_PAGE_DIMENSION = 0.95;
const IDENTITY = [1, 0, 0, 1, 0, 0];

function matrixMultiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function axisAligned(m) {
  const eps = 1e-8;
  return (Math.abs(m[1]) < eps && Math.abs(m[2]) < eps)
    || (Math.abs(m[0]) < eps && Math.abs(m[3]) < eps);
}

function rectangle(m, x0 = 0, y0 = 0, x1 = 1, y1 = 1) {
  const points = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [
    m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5],
  ]);
  return [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1])),
    Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))];
}

function intersect(a, b) {
  if (!a || !b) return null;
  const box = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
  return box[2] > box[0] && box[3] > box[1] ? box : null;
}

function inherited(loader, pageNum, pageGen, key) {
  let page = loader.resolve(new PdfRef(pageNum, pageGen));
  const seen = new Set();
  for (let depth = 0; page instanceof Map && depth < 32; depth += 1) {
    if (page.has(key)) return loader.resolve(page.get(key));
    const parent = page.get("Parent");
    if (!(parent instanceof PdfRef) || seen.has(parent.key())) break;
    seen.add(parent.key());
    page = loader.resolve(parent);
  }
  return null;
}

function boxValue(loader, value) {
  const box = loader.resolve(value);
  if (!Array.isArray(box) || box.length !== 4 || !box.every(isNumeric)) return null;
  const [a, b, c, d] = box.map(toNumber);
  if (![a, b, c, d].every(Number.isFinite) || a === c || b === d) return null;
  return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
}

export class PageImageCollector {
  constructor(loader, pageNum, pageGen, operations) {
    this.loader = loader;
    this.operations = operations;
    this.media = boxValue(loader, inherited(loader, pageNum, pageGen, "MediaBox")) || [0, 0, 612, 792];
    this.resources = inherited(loader, pageNum, pageGen, "Resources");
    this.state = { matrix: [...IDENTITY], clip: [...this.media], clipKnown: true };
    this.stack = [];
    this.path = [];
    this.complexPath = false;
    this.pendingClip = false;
    this.images = [];
    this.forms = new Set();
  }

  addImage(name, isMask = false) {
    const { matrix, clip, clipKnown } = this.state;
    const placed = rectangle(matrix);
    const visible = intersect(intersect(placed, this.media), clip);
    if (!visible) return;
    const width = this.media[2] - this.media[0];
    const height = this.media[3] - this.media[1];
    const xCoverage = (visible[2] - visible[0]) / width;
    const yCoverage = (visible[3] - visible[1]) / height;
    this.images.push({
      name,
      bbox: visible,
      coverage: xCoverage * yCoverage,
      pageSized: !isMask && clipKnown && axisAligned(matrix)
        && xCoverage >= NEAR_PAGE_DIMENSION && yCoverage >= NEAR_PAGE_DIMENSION,
    });
  }

  form(entry, form, resources) {
    if (!(entry instanceof PdfRef) || this.forms.has(entry.key()) || this.forms.size >= 32) return;
    const data = this.loader.streamOf(entry);
    if (!data) return;
    this.forms.add(entry.key());
    const previous = this.state;
    const previousStack = this.stack;
    const previousPath = this.path;
    const previousComplex = this.complexPath;
    const previousClip = this.pendingClip;
    const matrix = this.loader.resolve(form.get("Matrix"));
    const nextMatrix = Array.isArray(matrix) && matrix.length === 6 && matrix.every(isNumeric)
      ? matrixMultiply(previous.matrix, matrix.map(toNumber)) : [...previous.matrix];
    const formBox = boxValue(this.loader, form.get("BBox"));
    const box = formBox ? rectangle(nextMatrix, ...formBox) : null;
    this.state = { matrix: nextMatrix, clip: box ? intersect(previous.clip, box) : previous.clip,
      clipKnown: previous.clipKnown && (!formBox || axisAligned(nextMatrix)) };
    this.stack = [];
    this.path = [];
    this.complexPath = false;
    this.pendingClip = false;
    const own = this.loader.resolve(form.get("Resources"));
    try {
      for (const [op, operands] of this.operations(data.toString("latin1"))) this.consume(op, operands, own instanceof Map ? own : resources);
    } finally {
      this.state = previous;
      this.stack = previousStack;
      this.path = previousPath;
      this.complexPath = previousComplex;
      this.pendingClip = previousClip;
      this.forms.delete(entry.key());
    }
  }

  consume(op, operands, resources = this.resources) {
    const state = this.state;
    if (op === "q") {
      this.stack.push({ matrix: [...state.matrix], clip: state.clip && [...state.clip], clipKnown: state.clipKnown });
    } else if (op === "Q") {
      if (this.stack.length) this.state = this.stack.pop();
    } else if (op === "cm" && operands.length >= 6 && operands.slice(-6).every(isNumeric)) {
      state.matrix = matrixMultiply(state.matrix, operands.slice(-6).map(toNumber));
    } else if (op === "re" && operands.length >= 4 && operands.slice(-4).every(isNumeric)) {
      const [x, y, w, h] = operands.slice(-4).map(toNumber);
      if (!axisAligned(state.matrix)) this.complexPath = true;
      this.path.push(rectangle(state.matrix, x, y, x + w, y + h));
    } else if (["m", "l", "c", "v", "y"].includes(op)) {
      this.complexPath = true;
    } else if (op === "W" || op === "W*") {
      this.pendingClip = true;
    } else if (["n", "S", "s", "f", "F", "f*", "B", "B*", "b", "b*"].includes(op)) {
      if (this.pendingClip) {
        if (!this.complexPath && this.path.length === 1) state.clip = intersect(state.clip, this.path[0]);
        else state.clipKnown = false;
      }
      this.path = [];
      this.complexPath = false;
      this.pendingClip = false;
    } else if (op === "BI") {
      this.addImage("inline");
    } else if (op === "Do" && operands.at(-1) instanceof PdfName) {
      const name = String(operands.at(-1));
      const xobjects = resources instanceof Map ? this.loader.resolve(resources.get("XObject")) : null;
      const entry = xobjects instanceof Map ? xobjects.get(name) : null;
      const object = this.loader.resolve(entry);
      const type = object instanceof Map ? this.loader.resolve(object.get("Subtype")) : null;
      if (String(type) === "Image") this.addImage(name, this.loader.resolve(object.get("ImageMask")) === true);
      else if (String(type) === "Form") this.form(entry, object, resources);
    }
  }
}


// FILE: pdf/pdf-lexer.js
/*
(PDF 15) PDF branch, position 15 in the chain - helper of the extraction (PDF 13).
This module is the PDF tokenizer: it reads a prepared file and turns names, numbers, strings, arrays and dictionaries into values the object loader can resolve.
*/
import fs from "node:fs";
import { PdfFloat, PdfHexBytes, PdfKeyword, PdfName } from "./pdf-fonts.js";

const BUFFER_SIZE = 64 * 1024;
const ESCAPES = new Map([
  [0x6e, "\n"], [0x72, "\r"], [0x74, "\t"], [0x62, "\b"], [0x66, "\f"],
  [0x28, "("], [0x29, ")"], [0x5c, "\\"],
]);
const whitespace = (c) => c === 0 || (c >= 9 && c <= 13) || c === 32;
const digit = (c) => c >= 48 && c <= 57;
const alpha = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const keywordChar = (c) => alpha(c) || digit(c) || c === 39 || c === 34 || c === 42;
const nameEnd = (c) => c < 0 || whitespace(c) || [40, 41, 60, 62, 91, 93, 123, 125, 47, 37].includes(c);
const inlineEnd = (c) => c < 0 || whitespace(c) || [91, 93, 60, 62, 47, 37, 40].includes(c);

class Latin1Builder {
  constructor() {
    this.buffer = Buffer.allocUnsafe(256);
    this.length = 0;
    this.parts = [];
  }

  add(value) {
    if (this.length === this.buffer.length) {
      if (this.buffer.length < BUFFER_SIZE) {
        const larger = Buffer.allocUnsafe(Math.min(BUFFER_SIZE, this.buffer.length * 2));
        this.buffer.copy(larger, 0, 0, this.length);
        this.buffer = larger;
      } else {
        this.parts.push(this.buffer.toString("latin1"));
        this.length = 0;
      }
    }
    this.buffer[this.length++] = value;
  }

  finish() {
    const last = this.buffer.toString("latin1", 0, this.length);
    if (!this.parts.length) return last;
    this.parts.push(last);
    return this.parts.join("");
  }
}

// The page commands live in a temporary file. Only a small read window and the
// current PDF token are held here; comments and inline images are skipped.
export class PdfFileLexer {
  constructor(fd, size) {
    this.fd = fd;
    this.size = size;
    this.pos = 0;
    this.buffer = Buffer.alloc(0);
    this.start = 0;
  }

  peek(ahead = 0) {
    const at = this.pos + ahead;
    if (at >= this.size) return -1;
    if (at < this.start || at >= this.start + this.buffer.length) {
      this.start = this.pos;
      this.buffer = Buffer.allocUnsafe(Math.min(BUFFER_SIZE, this.size - this.start));
      const read = fs.readSync(this.fd, this.buffer, 0, this.buffer.length, this.start);
      this.buffer = this.buffer.subarray(0, read);
      if (at >= this.start + read) return -1;
    }
    return this.buffer[at - this.start];
  }

  take() {
    const c = this.peek();
    if (c !== -1) this.pos += 1;
    return c;
  }

  skipComment() {
    while (this.pos < this.size) {
      this.peek();
      const offset = this.pos - this.start;
      const lf = this.buffer.indexOf(0x0a, offset);
      const cr = this.buffer.indexOf(0x0d, offset);
      const end = lf < 0 ? cr : cr < 0 ? lf : Math.min(lf, cr);
      if (end >= 0) { this.pos = this.start + end; return; }
      this.pos = this.start + this.buffer.length;
    }
  }

  skipInlineImage() {
    while (this.pos < this.size) {
      const c = this.peek();
      if (whitespace(c) && this.peek(1) === 69 && this.peek(2) === 73 && inlineEnd(this.peek(3))) {
        this.pos += 3;
        return;
      }
      this.pos += 1;
    }
  }

  literal() {
    let depth = 1;
    const out = new Latin1Builder();
    while (this.pos < this.size) {
      const c = this.take();
      if (c === 40) { depth += 1; out.add(c); continue; }
      if (c === 41) {
        depth -= 1;
        if (!depth) return out.finish();
        out.add(c);
        continue;
      }
      if (c === 13) {
        if (this.peek() === 10) this.pos += 1;
        out.add(10);
        continue;
      }
      if (c !== 92) { out.add(c); continue; }
      const next = this.take();
      if (next < 0) break;
      if (ESCAPES.has(next)) { out.add(ESCAPES.get(next).charCodeAt(0)); continue; }
      if (next >= 48 && next <= 55) {
        let value = next - 48;
        for (let index = 0; index < 2; index += 1) {
          const extra = this.peek();
          if (extra < 48 || extra > 55) break;
          value = value * 8 + this.take() - 48;
        }
        out.add(value & 0xff);
      } else if (next === 10) {
        // Backslash-newline is a line continuation.
      } else if (next === 13) {
        if (this.peek() === 10) this.pos += 1;
      } else out.add(next);
    }
    return out.finish();
  }

  hex() {
    const result = new Latin1Builder();
    let high = -1;
    while (this.pos < this.size) {
      const c = this.take();
      if (c === 62) {
        if (high !== -1) result.add(high << 4);
        return result.finish();
      }
      const value = c >= 48 && c <= 57 ? c - 48
        : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (value < 0) continue;
      if (high < 0) high = value;
      else { result.add((high << 4) | value); high = -1; }
    }
    return null;
  }

  number() {
    const start = this.pos;
    let raw = "";
    while (this.peek() === 43 || this.peek() === 45) raw += String.fromCharCode(this.take());
    let digits = 0;
    while (digit(this.peek())) { raw += String.fromCharCode(this.take()); digits += 1; }
    if (this.peek() === 46) {
      const dot = this.pos;
      this.pos += 1;
      let fractional = "";
      while (digit(this.peek())) fractional += String.fromCharCode(this.take());
      if (digits || fractional) raw += `.${fractional}`;
      else this.pos = dot;
    }
    if (!digits && !/\d/u.test(raw)) { this.pos = start; return null; }
    raw = raw.replace(/^\+*/u, "");
    if (raw.includes(".")) {
      const value = Number.parseFloat(raw);
      return new PdfFloat(Number.isNaN(value) ? 0 : value);
    }
    const value = Number.parseInt(raw, 10);
    return Number.isNaN(value) ? 0 : value;
  }

  nextToken() {
    while (this.pos < this.size) {
      const c = this.peek();
      if (whitespace(c)) { this.pos += 1; continue; }
      if (c === 37) { this.pos += 1; this.skipComment(); continue; }
      if (c === 47) {
        this.pos += 1;
        let name = "";
        while (!nameEnd(this.peek())) name += String.fromCharCode(this.take());
        return ["obj", new PdfName(name.replace(/#([0-9A-Fa-f]{2})/gu,
          (_whole, hex) => String.fromCharCode(Number.parseInt(hex, 16))))];
      }
      if (c === 60) {
        this.pos += 1;
        if (this.peek() === 60) { this.pos += 1; return ["dopen", null]; }
        const start = this.pos;
        const value = this.hex();
        if (value !== null) return ["obj", new PdfHexBytes(value)];
        this.pos = start;
        return ["kw", new PdfKeyword("<")];
      }
      if (c === 62 && this.peek(1) === 62) { this.pos += 2; return ["dclose", null]; }
      if (c === 91 || c === 93) { this.pos += 1; return [c === 91 ? "aopen" : "aclose", null]; }
      if (c === 123 || c === 125) { this.pos += 1; continue; }
      if (c === 40) { this.pos += 1; return ["obj", this.literal()]; }
      if (digit(c) || c === 43 || c === 45 || c === 46) {
        const value = this.number();
        if (value !== null) return ["obj", value];
      }
      if (alpha(c) || c === 39 || c === 34 || c === 42) {
        let word = "";
        while (keywordChar(this.peek())) word += String.fromCharCode(this.take());
        if (word === "true") return ["obj", true];
        if (word === "false") return ["obj", false];
        if (word === "null") return ["obj", null];
        return ["kw", new PdfKeyword(word)];
      }
      this.pos += 1;
      return ["kw", new PdfKeyword(String.fromCharCode(c))];
    }
    return null;
  }
}


// FILE: pdf/pdf-objects.js
/*
(PDF 12) PDF branch, position 12 in the chain - helper used by the instructions (PDF 11) and the extraction (PDF 13).
This module scans a prepared PDF file and indexes its indirect objects (number, generation, offset, dictionary), so other stages can jump straight to any object.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ValueError, pyInt, pyStripBytes } from "../pylib.js";

const READ_SIZE = 64 * 1024;
const STREAM_MARKER = Buffer.from("\nstream\n", "latin1");
const END_OBJECT = Buffer.from("endobj", "latin1");

function readAt(fd, offset, length) {
  const buffer = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, buffer, read, length - read, offset + read);
    if (!count) break;
    read += count;
  }
  return buffer.subarray(0, read);
}

class LineReader {
  constructor(fd, start, end) {
    this.fd = fd;
    this.position = start;
    this.end = end;
    this.pending = "";
  }

  next() {
    while (true) {
      const newline = this.pending.indexOf("\n");
      if (newline !== -1) {
        const line = this.pending.slice(0, newline).replace(/\r$/u, "");
        this.pending = this.pending.slice(newline + 1);
        return line;
      }
      if (this.position >= this.end) {
        if (!this.pending) return null;
        const line = this.pending;
        this.pending = "";
        return line;
      }
      const bytes = readAt(this.fd, this.position, Math.min(READ_SIZE, this.end - this.position));
      if (!bytes.length) throw new Error("PDF cross-reference table ended unexpectedly");
      this.position += bytes.length;
      this.pending += bytes.toString("latin1");
    }
  }
}

function startXref(fd, size) {
  const length = Math.min(size, READ_SIZE);
  const tail = readAt(fd, size - length, length).toString("latin1");
  const matches = [...tail.matchAll(/startxref\s+(\d+)\s+%%EOF/gu)];
  const offset = matches.length ? Number(matches.at(-1)[1]) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= size) {
    throw new Error("PDF has no readable cross-reference table; prepare it with qpdf first");
  }
  return offset;
}

// This reader expects the ordinary xref table produced by qpdf with object
// streams disabled. It keeps object offsets, not the PDF's object bodies.
export class PdfFileObjects {
  constructor(source, { maxObjects = Infinity } = {}) {
    this.fd = fs.openSync(source, "r");
    this.entries = new Map();
    this.rootKey = null;
    this.trailer = "";
    try {
      const size = fs.fstatSync(this.fd).size;
      const xref = startXref(this.fd, size);
      const reader = new LineReader(this.fd, xref, size);
      if (reader.next()?.trim() !== "xref") {
        throw new Error("PDF uses an xref stream; prepare it with qpdf first");
      }
      let line;
      while ((line = reader.next()) !== null) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith("trailer")) {
          this.trailer = line;
          while (!this.trailer.includes(">>")) {
            const next = reader.next();
            if (next === null) throw new Error("PDF trailer is incomplete");
            this.trailer += `\n${next}`;
          }
          break;
        }
        const section = /^(\d+)\s+(\d+)$/u.exec(line);
        if (!section) throw new Error("Invalid PDF cross-reference subsection");
        const first = Number(section[1]);
        const count = Number(section[2]);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(count) || count > maxObjects + 1) {
          throw new Error(`PDF exceeds the ${maxObjects} object cap`);
        }
        for (let index = 0; index < count; index += 1) {
          const entry = /^(\d+)\s+(\d+)\s+([nf])\b/u.exec(reader.next()?.trim() ?? "");
          if (!entry) throw new Error("Invalid PDF cross-reference entry");
          if (entry[3] !== "n") continue;
          const offset = Number(entry[1]);
          const generation = Number(entry[2]);
          if (!Number.isSafeInteger(offset) || offset < 0 || offset >= xref) {
            throw new Error("Invalid PDF object offset");
          }
          this.entries.set(`${first + index},${generation}`, { offset, end: xref });
          if (this.entries.size > maxObjects) throw new Error(`PDF exceeds the ${maxObjects} object cap`);
        }
      }
      if (!this.trailer || /\/Prev\b/u.test(this.trailer)) {
        throw new Error("PDF has incremental cross-references; prepare it with qpdf first");
      }
      const root = /\/Root\s+(\d+)\s+(\d+)\s+R/u.exec(this.trailer);
      if (root) this.rootKey = `${Number(root[1])},${Number(root[2])}`;
      const ordered = [...this.entries.values()].sort((a, b) => a.offset - b.offset);
      for (let index = 0; index + 1 < ordered.length; index += 1) ordered[index].end = ordered[index + 1].offset;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get size() { return this.entries.size; }
  has(key) { return this.entries.has(key); }

  // Only the object dictionary is needed to inspect streams. Do not read the
  // compressed image or page stream merely to resolve its dictionary.
  dictionary(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    let position = entry.offset;
    const chunks = [];
    let length = 0;
    while (position < entry.end) {
      const bytes = readAt(this.fd, position, Math.min(READ_SIZE, entry.end - position));
      if (!bytes.length) throw new Error(`PDF object ${key} ended unexpectedly`);
      chunks.push(bytes);
      length += bytes.length;
      position += bytes.length;
      const current = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
      const marker = current.indexOf(STREAM_MARKER);
      const header = /^\s*\d+\s+\d+\s+obj\b/u.exec(current.toString("latin1", 0, Math.min(current.length, 128)));
      if (!header) throw new Error(`Invalid PDF object header for ${key}`);
      if (marker !== -1) {
        entry.streamStart = entry.offset + marker + STREAM_MARKER.length;
        return pyStripBytes(current.subarray(header[0].length, marker));
      }
      if (position >= entry.end) {
        const end = current.lastIndexOf(END_OBJECT);
        if (end < header[0].length) throw new Error(`PDF object ${key} has no endobj`);
        return pyStripBytes(current.subarray(header[0].length, end));
      }
      // Avoid repeated concatenation if a non-stream object spans many blocks.
      if (chunks.length > 1) { chunks.length = 0; chunks.push(current); }
    }
    return undefined;
  }

  streamRange(key, length) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    this.dictionary(key);
    if (entry.streamStart === undefined || !Number.isSafeInteger(length) || length < 0
        || entry.streamStart + length > entry.end) {
      throw new Error(`Invalid PDF stream length for ${key}`);
    }
    return { fd: this.fd, start: entry.streamStart, length };
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const raw = readAt(this.fd, entry.offset, entry.end - entry.offset);
    const header = /^\s*\d+\s+\d+\s+obj\b/u.exec(raw.toString("latin1", 0, Math.min(raw.length, 128)));
    const end = raw.lastIndexOf(END_OBJECT);
    if (!header || end < header[0].length) throw new Error(`Invalid PDF object ${key}`);
    return pyStripBytes(raw.subarray(header[0].length, end));
  }

  *[Symbol.iterator]() {
    for (const key of this.entries.keys()) yield [key, this.dictionary(key)];
  }

  *values() {
    for (const [, value] of this) yield value;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

class FileView {
  constructor(fd) {
    this.fd = fd;
    this.length = fs.fstatSync(fd).size;
    this.offset = 0;
    this.buffer = Buffer.allocUnsafe(READ_SIZE);
    this.count = 0;
    this.searchBuffer = Buffer.allocUnsafe(READ_SIZE + END_OBJECT.length - 1);
  }

  byteAt(position) {
    if (position < this.offset || position >= this.offset + this.count) {
      this.offset = Math.floor(position / READ_SIZE) * READ_SIZE;
      this.count = fs.readSync(this.fd, this.buffer, 0, Math.min(READ_SIZE, this.length - this.offset), this.offset);
      if (!this.count) throw new Error("PDF ended while scanning its objects");
    }
    return this.buffer[position - this.offset];
  }

  text(start, end) {
    if (start >= this.offset && end <= this.offset + this.count) {
      return this.buffer.toString("latin1", start - this.offset, end - this.offset);
    }
    return readAt(this.fd, start, end - start).toString("latin1");
  }

  indexOf(needle, start) {
    let offset = start;
    let carry = 0;
    while (offset < this.length) {
      const count = fs.readSync(this.fd, this.searchBuffer, carry, Math.min(READ_SIZE, this.length - offset), offset);
      if (!count) break;
      const length = carry + count;
      const index = this.searchBuffer.subarray(0, length).indexOf(needle);
      if (index !== -1) return offset - carry + index;
      carry = Math.min(length, needle.length - 1);
      this.searchBuffer.copyWithin(0, length - carry, length);
      offset += count;
    }
    return -1;
  }
}

// Scan the original file without expanding object streams or decrypting it:
// Scraper classification must make its decision from the original source.
function scanPdfObjectOffsets(fd, maxObjects = Infinity) {
  const view = new FileView(fd);
  const entries = new Map();
  const isDigit = (byte) => byte >= 0x30 && byte <= 0x39;
  const isSpace = (byte) => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);
  let i = 0;
  let end = -1;
  let noMoreEnds = false;
  while (i < view.length) {
    if (!isDigit(view.byteAt(i))) { i += 1; continue; }
    let j = i;
    while (j < view.length && isDigit(view.byteAt(j))) j += 1;
    let k = j;
    while (k < view.length && isSpace(view.byteAt(k))) k += 1;
    if (k === j || k >= view.length || !isDigit(view.byteAt(k))) { i = j; continue; }
    let m = k;
    while (m < view.length && isDigit(view.byteAt(m))) m += 1;
    let p = m;
    while (p < view.length && isSpace(view.byteAt(p))) p += 1;
    if (p === m) { i = j; continue; }
    if (p + 3 <= view.length && view.text(p, p + 3) === "obj") {
      const start = p + 3;
      if (end < start && !noMoreEnds) {
        end = view.indexOf(END_OBJECT, start);
        noMoreEnds = end === -1;
      }
      if (end !== -1 && end >= start) {
        const key = `${pyInt(view.text(i, j))},${pyInt(view.text(k, m))}`;
        entries.set(key, { start, end });
        if (entries.size > maxObjects) throw new ValueError(`PDF exceeds the ${maxObjects} object cap`);
      }
      i = start;
    } else {
      i = j;
    }
  }
  return entries;
}

// File-backed view of the objects visible in the original PDF. Unlike the
// qpdf-prepared reader above, it deliberately does not expose compressed
// object-stream members to the Scraper's legacy classifier.
export class PdfScannedObjects {
  constructor(source, { maxObjects = Infinity } = {}) {
    this.fd = fs.openSync(source, "r");
    try {
      this.entries = scanPdfObjectOffsets(this.fd, maxObjects);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  get size() { return this.entries.size; }
  has(key) { return this.entries.has(key); }

  get(key) {
    const entry = this.entries.get(key);
    return entry ? pyStripBytes(readAt(this.fd, entry.start, entry.end - entry.start)) : undefined;
  }

  dictionary(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    let position = entry.start;
    let previous = Buffer.alloc(0);
    const chunks = [];
    let total = 0;
    while (position < entry.end) {
      const next = readAt(this.fd, position, Math.min(READ_SIZE, entry.end - position));
      if (!next.length) throw new Error(`PDF object ${key} ended unexpectedly`);
      const blockStart = position - previous.length;
      position += next.length;
      const block = previous.length ? Buffer.concat([previous, next]) : next;
      let marker = -1;
      let search = 0;
      while ((marker = block.indexOf("stream", search, "latin1")) !== -1) {
        const absolute = blockStart + marker;
        const before = marker ? block[marker - 1] : absolute === entry.start ? 0x20 : readAt(this.fd, absolute - 1, 1)[0];
        const after = block[marker + 6];
        if (after === undefined && position < entry.end) break;
        if ((before === 0x3e || before <= 0x20) && (after === 0x0a || after === 0x0d)) {
          const prefixLength = absolute - (position - next.length);
          if (prefixLength > 0) { chunks.push(next.subarray(0, prefixLength)); total += prefixLength; }
          // If the marker crosses a read boundary, remove its already-saved prefix.
          if (prefixLength < 0) total += prefixLength;
          let streamStart = absolute + 6;
          if (after === 0x0d) streamStart += 1;
          if (streamStart < entry.end && readAt(this.fd, streamStart, 1)[0] === 0x0a) streamStart += 1;
          entry.streamStart = streamStart;
          return pyStripBytes(Buffer.concat(chunks, total));
        }
        search = marker + 6;
      }
      chunks.push(next);
      total += next.length;
      previous = block.subarray(Math.max(0, block.length - 7));
    }
    return pyStripBytes(Buffer.concat(chunks, total));
  }

  streamRange(key, length) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.streamStart === undefined) this.dictionary(key);
    if (entry.streamStart === undefined || !Number.isSafeInteger(length) || length < 0
        || entry.streamStart + length > entry.end) throw new Error(`Invalid PDF stream length for ${key}`);
    return { fd: this.fd, start: entry.streamStart, length };
  }

  *[Symbol.iterator]() {
    for (const key of this.entries.keys()) yield [key, this.dictionary(key)];
  }

  *values() {
    for (const [, value] of this) yield value;
  }

  close() {
    if (this.fd !== null) {
      fs.closeSync(this.fd);
      this.fd = null;
    }
  }
}

// Buffer callers already own the bytes; put them on disk so they use the same
// file-backed object and page-content readers as path callers.
export function openPdfScannedObjects(source, options = {}) {
  let directory = null;
  let objects = null;
  try {
    let file = source;
    if (source instanceof Uint8Array) {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "linga-pdf-source-"));
      file = path.join(directory, "source.pdf");
      fs.writeFileSync(file, source, { mode: 0o600 });
    }
    objects = new PdfScannedObjects(file, options);
    return {
      objects,
      close() {
        objects.close();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    objects?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}


// FILE: pdf/pdf-optimize.js
/*
(PDF 34) PDF branch, position 34 in the chain - last step on written PDF output (PDF 32).
This module runs qpdf over a written output PDF to optimize it when optimization is enabled.
*/







import fs from "node:fs";
import { runQpdfFile } from "../../init/pdf/qpdf.js";

const OPTIMIZE_OFF = new Set(["0", "off", "false", "no"]);

export const pdfOptimizeEnabled = () =>
  !OPTIMIZE_OFF.has(String(process.env.PRASER_PDF_OPTIMIZE ?? "").trim().toLowerCase());

export async function writeOptimizedPdf(outPath, inputPath, log = () => {}) {
  if (!pdfOptimizeEnabled()) {
    fs.copyFileSync(inputPath, outPath);
    log("[+] PDF second pass: SKIPPED (PRASER_PDF_OPTIMIZE=0)");
    return { path: outPath, optimized: false, linearized: false };
  }
  try {
    const before = fs.statSync(inputPath).size;
    const { warnings } = await runQpdfFile(inputPath, outPath, [
      "--stream-data=compress", "--recompress-flate", "--compression-level=9",
      "--object-streams=generate", "--linearize",
    ]);
    const after = fs.statSync(outPath).size;
    const saved = before - after;
    const pct = before ? ((saved / before) * 100).toFixed(1) : "0.0";
    log(
      `[+] PDF second pass (qpdf): ${before.toLocaleString("en-US")} -> `
        + `${after.toLocaleString("en-US")} bytes (${saved >= 0 ? "-" : "+"}${Math.abs(Number(pct)).toFixed(1)}%), linearized`,
    );
    if (warnings) log(`[i] qpdf warning: ${warnings}`);
    return { path: outPath, optimized: true, linearized: true };
  } catch (error) {
    fs.copyFileSync(inputPath, outPath);
    log(`[!] PDF second pass failed, kept the first-pass file: ${error.message}`);
    return { path: outPath, optimized: false, linearized: false };
  }
}


// FILE: pdf/pdf-pages.js
/*
(PDF 27) PDF branch, position 27 in the chain - storage helper of the finishing and output steps (PDF 19, PDF 31).
This module is the page-piece store: it keeps each page's extracted text pieces on disk and serves them back page by page without holding a whole book in memory.
*/
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { countImpossiblePairs } from "../beautify/scan.js";

const require = createRequire(import.meta.url);

function differentLines(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  let changed = 0;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] ?? "") !== (right[index] ?? "")) changed += 1;
  }
  return changed;
}

// A page's drawing order need not be reading order. Store drawing pieces on
// disk so duplicate detection and spatial sorting don't retain the page text.
export class PdfPagePieces {
  constructor(directory) {
    let DatabaseSync;
    try {
      ({ DatabaseSync } = require("node:sqlite"));
    } catch (cause) {
      throw new Error("File-backed PDF extraction requires Node.js 22.13 or later", { cause });
    }
    this.file = path.join(directory, `page-pieces-${randomUUID()}.sqlite`);
    const fd = fs.openSync(this.file, "wx", 0o600);
    fs.closeSync(fd);
    try {
      this.db = new DatabaseSync(this.file);
      this.db.exec(`
        PRAGMA journal_mode=OFF;
        PRAGMA synchronous=OFF;
        PRAGMA temp_store=FILE;
        PRAGMA cache_size=-2048;
        PRAGMA mmap_size=0;
        CREATE TABLE pieces (id INTEGER PRIMARY KEY, y REAL, x REAL, size REAL, text TEXT, runs TEXT);
        CREATE TABLE unique_pieces (slot INTEGER PRIMARY KEY, y REAL, x REAL, size REAL, text TEXT, runs TEXT, line INTEGER, ord INTEGER);
        CREATE INDEX unique_x ON unique_pieces(x);
        CREATE INDEX unique_yx ON unique_pieces(y DESC, x ASC, slot ASC);
        CREATE TABLE line_anchors (id INTEGER PRIMARY KEY, y REAL);
        CREATE TABLE lines (id INTEGER PRIMARY KEY, x REAL, y REAL, size REAL, text TEXT);
        CREATE TABLE final_lines (id INTEGER PRIMARY KEY, x REAL, y REAL, size REAL, text TEXT);
      `);
      this.insertPiece = this.db.prepare("INSERT INTO pieces(y,x,size,text,runs) VALUES(?,?,?,?,?)");
      this.pieces = this.db.prepare("SELECT id,y,x,size,text,runs FROM pieces ORDER BY id");
      this.nearby = this.db.prepare("SELECT slot,y,x,text FROM unique_pieces WHERE x BETWEEN ? AND ? AND y BETWEEN ? AND ? ORDER BY slot");
      this.insertUnique = this.db.prepare("INSERT INTO unique_pieces(y,x,size,text,runs) VALUES(?,?,?,?,?)");
      this.updateUnique = this.db.prepare("UPDATE unique_pieces SET y=?,x=?,size=?,text=?,runs=? WHERE slot=?");
      this.sorted = this.db.prepare("SELECT slot,y,x FROM unique_pieces ORDER BY y DESC,x ASC,slot ASC");
      this.sortedLeft = this.db.prepare("SELECT slot,y,x FROM unique_pieces WHERE x < ? ORDER BY y DESC,x ASC,slot ASC");
      this.sortedRight = this.db.prepare("SELECT slot,y,x FROM unique_pieces WHERE x >= ? ORDER BY y DESC,x ASC,slot ASC");
      this.columnEvidence = this.db.prepare("SELECT x,y,length(trim(text)) AS chars FROM unique_pieces WHERE length(trim(text)) > 0 ORDER BY y DESC,x ASC");
      this.insertAnchor = this.db.prepare("INSERT INTO line_anchors(id,y) VALUES(?,?)");
      this.assignLine = this.db.prepare("UPDATE unique_pieces SET line=?,ord=? WHERE slot=?");
      this.ordered = this.db.prepare("SELECT p.line,a.y AS baseline,p.x,p.size,p.text,p.runs FROM unique_pieces p JOIN line_anchors a ON a.id=p.line ORDER BY p.line,p.x,p.ord");
      this.insertLine = this.db.prepare("INSERT INTO lines(id,x,y,size,text) VALUES(?,?,?,?,?)");
      this.readLines = this.db.prepare("SELECT id,x,y,size,text FROM lines ORDER BY id");
      this.insertFinal = this.db.prepare("INSERT INTO final_lines(id,x,y,size,text) VALUES(?,?,?,?,?)");
      this.readFinal = this.db.prepare("SELECT id,x,y,size,text FROM final_lines ORDER BY id");
      this.active = false;
    } catch (error) {
      this.db?.close();
      fs.rmSync(this.file, { force: true });
      throw error;
    }
  }

  begin(doc) {
    this.abort();
    this.db.exec("DELETE FROM pieces; DELETE FROM unique_pieces; DELETE FROM line_anchors; DELETE FROM lines; DELETE FROM final_lines; BEGIN");
    this.active = true;
    this.doc = doc;
    this.fontIds = new WeakMap();
    this.fonts = new Map();
    this.nextFont = 1;
  }

  encodeRuns(runs) {
    if (!Array.isArray(runs)) return null;
    return JSON.stringify(runs.map(([marker, text, confirmed, raw]) => {
      if (this.doc.kind !== "font" || !marker || typeof marker !== "object") return [marker, text, confirmed, raw];
      let id = this.fontIds.get(marker);
      if (!id) { id = this.nextFont++; this.fontIds.set(marker, id); this.fonts.set(id, marker); }
      return [id, text, confirmed, raw];
    }));
  }

  decodeRuns(raw) {
    if (raw == null) return null;
    const runs = JSON.parse(raw);
    if (this.doc.kind !== "font") return runs;
    return runs.map(([id, text, confirmed, raw]) => [typeof id === "number" ? this.fonts.get(id) : id, text, confirmed, raw]);
  }

  add([y, x, size, text, runs]) {
    this.insertPiece.run(y, x, size, text, this.encodeRuns(runs));
  }

  finish({ onConfirmedRepair = null, joinRuns, pageLeft = 0, pageWidth = 0, pageHeight = 0, hasTableRules = false }) {
    if (!this.active) throw new Error("No PDF page is being collected");
    let changedLines = 0;
    let impossibleBefore = 0;
    let impossibleAfter = 0;
    let hasRepair = false;
    for (const piece of this.pieces.iterate()) {
      let text = piece.text;
      let runs = this.decodeRuns(piece.runs);
      if (this.doc.kind === "legacy" && Array.isArray(runs)) {
        for (const run of runs) run[1] = run[2];
        const after = runs.map((run) => run[1]).join("");
        if (after !== text) hasRepair = true;
        changedLines += differentLines(text, after);
        impossibleBefore += countImpossiblePairs(text);
        impossibleAfter += countImpossiblePairs(after);
        text = after;
      }
      const encoded = this.encodeRuns(runs);
      let inserted = false;
      // A witnessed visual glyph may have decoded to an empty string in a
      // rejected ToUnicode map. It is not a duplicate of nearby visible text.
      const emptyVisualRun = !text && this.doc.kind === "font"
        && runs?.some(([font, , , raw]) => font?.visualUnicodeGlyphs && typeof raw === "string" && raw.length);
      if (!emptyVisualRun) {
        for (const old of this.nearby.iterate(piece.x - 1, piece.x + 1, piece.y - 1, piece.y + 1)) {
          if (Math.abs(piece.x - old.x) > 1 || Math.abs(piece.y - old.y) > 1) continue;
          if (text === old.text || old.text.includes(text)) { inserted = true; break; }
          if (old.text && text.includes(old.text)) {
            this.updateUnique.run(piece.y, piece.x, piece.size, text, encoded, old.slot);
            inserted = true;
            break;
          }
        }
      }
      if (!inserted) this.insertUnique.run(piece.y, piece.x, piece.size, text, encoded);
    }
    if (hasRepair) onConfirmedRepair?.({ summary: { changedLines, impossibleBefore, impossibleAfter } });

    // A landscape sheet may contain two book pages side by side. When both
    // halves have substantial text over overlapping vertical ranges, keep
    // their lines separate and read the left half before the right. Without
    // that evidence retain the usual top-to-bottom page order.
    let spread = false;
    const middle = pageLeft + pageWidth / 2;
    if (!hasTableRules && pageWidth >= pageHeight * 1.25 && pageHeight > 0) {
      const halves = [0, 1].map(() => ({ count: 0, low: Infinity, high: -Infinity, y: null, chars: 0 }));
      const finishBaseline = (half) => {
        if (half.y === null || half.chars < 20) return;
        half.count += 1;
        half.low = Math.min(half.low, half.y);
        half.high = Math.max(half.high, half.y);
      };
      for (const piece of this.columnEvidence.iterate()) {
        if (piece.x < pageLeft || piece.x > pageLeft + pageWidth) continue;
        const half = halves[piece.x < middle ? 0 : 1];
        if (half.y === null || Math.abs(piece.y - half.y) > 3) {
          finishBaseline(half);
          half.y = piece.y;
          half.chars = 0;
        }
        half.chars += piece.chars;
      }
      halves.forEach(finishBaseline);
      const overlap = Math.min(halves[0].high, halves[1].high) - Math.max(halves[0].low, halves[1].low);
      spread = halves.every((half) => half.count >= 5 && half.high - half.low >= pageHeight * 0.2)
        && overlap >= pageHeight * 0.15;
    }
    const groups = spread
      ? [this.sortedLeft.iterate(middle), this.sortedRight.iterate(middle)] : [this.sorted.iterate()];
    let line = 0;
    let ordinal = 0;
    for (const group of groups) {
      let currentY = null;
      for (const piece of group) {
        if (currentY === null || Math.abs(piece.y - currentY) > 3) {
          currentY = piece.y;
          line += 1;
          this.insertAnchor.run(line, currentY);
        }
        this.assignLine.run(line, ordinal++, piece.slot);
      }
    }

    let current = null;
    let ordered = [];
    const flush = () => {
      if (!current) return;
      const text = joinRuns(ordered, this.doc);
      this.insertLine.run(current.id, current.x, current.y, current.size, text);
      ordered = [];
    };
    for (const piece of this.ordered.iterate()) {
      if (!current || current.id !== piece.line) {
        flush();
        current = { id: piece.line, x: piece.x, y: piece.baseline, size: piece.size };
      } else current.size = Math.max(current.size, piece.size);
      ordered.push([piece.x, piece.size, piece.text, this.decodeRuns(piece.runs)]);
    }
    flush();
    this.db.exec("COMMIT");
    this.active = false;
    return this;
  }

  *lines() {
    for (const row of this.readLines.iterate()) yield [row.x, row.y, row.size, row.text];
  }

  clearFinal() { this.db.exec("DELETE FROM final_lines"); }

  putFinal(index, [x, y, size, text]) { this.insertFinal.run(index + 1, x, y, size, text); }

  *finalLines() {
    for (const row of this.readFinal.iterate()) yield [row.x, row.y, row.size, row.text];
  }

  abort() {
    if (!this.active) return;
    this.db.exec("ROLLBACK");
    this.active = false;
  }

  close() {
    if (!this.db) return;
    this.abort();
    this.db.close();
    this.db = null;
    fs.rmSync(this.file, { force: true });
    for (const suffix of ["-journal", "-shm", "-wal"]) fs.rmSync(`${this.file}${suffix}`, { force: true });
  }
}


// FILE: pdf/pdf-render.js
/*
(PDF 36) PDF branch, position 36 in the chain - page renderer used when a page must be looked at as an image.
This module renders PDF pages (or regions of them) to PNG using a canvas, for image-page handling and the repair stage.
*/
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";





let canvasApiPromise = null;
function loadCanvas() {
  if (!canvasApiPromise) {
    canvasApiPromise = import("@napi-rs/canvas").catch((cause) => {
      canvasApiPromise = null;
      throw new Error(
        "canvas render requested but @napi-rs/canvas is not installed " +
          "(optional dependency; install it to enable OCR/image render lanes): " +
          `${cause?.message || cause}`,
        { cause },
      );
    });
  }
  return canvasApiPromise;
}

let pdfjsPromise = null;
let pdfjsAssetRoot = null;

async function pdfjs() {
  if (!pdfjsPromise) {
    const moduleUrl = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjsAssetRoot = fileURLToPath(new URL("../..", moduleUrl));
    pdfjsPromise = import(moduleUrl).catch((cause) => {
      pdfjsPromise = null;
      throw new Error(`PDF.js renderer is unavailable: ${cause?.message || cause}`, { cause });
    });
  }
  return pdfjsPromise;
}

function asBytes(source) {
  if (source instanceof Uint8Array) return new Uint8Array(source);
  throw new TypeError("PDF source must be a file path, Buffer or Uint8Array");
}

function fileRangeTransport(api, input) {
  const size = fs.statSync(input).size;
  const fd = fs.openSync(input, "r");
  return new class extends api.PDFDataRangeTransport {
    #closed = false;

    constructor() {
      super(size, new Uint8Array(0), true, path.basename(input));
    }

    requestDataRange(begin, end) {
      if (this.#closed) return;
      const bytes = new Uint8Array(end - begin);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(fd, bytes, offset, bytes.length - offset, begin + offset);
        if (!count) throw new Error("Unexpected end of PDF while reading a range");
        offset += count;
      }
      this.onDataRange(begin, bytes);
    }

    abort() {
      if (!this.#closed) {
        this.#closed = true;
        fs.closeSync(fd);
      }
    }
  }();
}

export async function openPdf(source, options = {}) {
  const api = await pdfjs();
  const transport = typeof source === "string" ? fileRangeTransport(api, source) : null;
  try {
    const task = api.getDocument({
      ...(transport
        ? { range: transport, disableStream: true, disableAutoFetch: true }
        : { data: asBytes(source) }),
      isEvalSupported: false,
      useSystemFonts: true,
      stopEventLoop: true,
      wasmUrl: `${pdfjsAssetRoot}wasm/`,
      cMapUrl: `${pdfjsAssetRoot}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${pdfjsAssetRoot}standard_fonts/`,
      ...options,
    });
    const doc = await task.promise;
    if (typeof doc.destroy !== "function") {
      Object.defineProperty(doc, "destroy", { value: () => task.destroy() });
    }
    return doc;
  } catch (error) {
    transport?.abort();
    throw error;
  }
}

export async function renderPageCanvas(page, scale = 3, { maxPixels = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
    throw new RangeError("PDF render scale must be greater than zero and at most 8");
  }
  const viewport = page.getViewport({ scale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > maxPixels) {
    throw new Error(`PDF render exceeds the ${maxPixels} pixel cap`);
  }
  const { createCanvas } = await loadCanvas();
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport, canvas }).promise;
  return { canvas, viewport, width, height, scale };
}







export async function renderPdfPagePng(source, pageNumber, {
  scale = 3,
  maxPixels = Number.MAX_SAFE_INTEGER,
} = {}) {
  const doc = await openPdf(source);
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) throw new RangeError(`Invalid PDF page ${pageNumber}`);
    const page = await doc.getPage(pageNumber);
    try {
      const rendered = await renderPageCanvas(page, scale, { maxPixels });
      return {
        png: rendered.canvas.toBuffer("image/png"),
        canvas: rendered.canvas,
        width: rendered.width,
        height: rendered.height,
        scale,
      };
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}







export async function renderPdfRegionPng(source, pageNumber, bbox, {
  scale = 3, maxPixels = Number.MAX_SAFE_INTEGER,
} = {}) {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(Number.isFinite)) {
    throw new TypeError("PDF image region must be a four-number bounding box");
  }
  const doc = await openPdf(source);
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) throw new RangeError(`Invalid PDF page ${pageNumber}`);
    const page = await doc.getPage(pageNumber);
    try {
      const rendered = await renderPageCanvas(page, scale, { maxPixels });
      // PDF.js exposes point conversion; transform every corner so the crop
      // also follows page rotation and non-zero page origins.
      const [left, bottom, right, top] = bbox;
      const corners = [[left, bottom], [left, top], [right, bottom], [right, top]]
        .map(([x, y]) => rendered.viewport.convertToViewportPoint(x, y));
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const x0 = Math.max(0, Math.floor(Math.min(...xs)));
      const y0 = Math.max(0, Math.floor(Math.min(...ys)));
      const x1 = Math.min(rendered.width, Math.ceil(Math.max(...xs)));
      const y1 = Math.min(rendered.height, Math.ceil(Math.max(...ys)));
      if (x1 <= x0 || y1 <= y0) throw new Error("PDF image region is outside the visible page");
      const { createCanvas } = await loadCanvas();
      const crop = createCanvas(x1 - x0, y1 - y0);
      crop.getContext("2d").drawImage(rendered.canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
      return { png: crop.toBuffer("image/png"), width: x1 - x0, height: y1 - y0, scale };
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}

export function cropCanvasRgba(canvas, bbox, { scale = 1, pad = 0 } = {}) {
  const x0 = Math.max(0, Math.floor((bbox.x0 - pad) * scale));
  const y0 = Math.max(0, Math.floor((bbox.y0 - pad) * scale));
  const x1 = Math.min(canvas.width, Math.ceil((bbox.x1 + pad) * scale));
  const y1 = Math.min(canvas.height, Math.ceil((bbox.y1 + pad) * scale));
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  return { width, height, data: canvas.getContext("2d").getImageData(x0, y0, width, height).data };
}


export async function decodeImageRgba(bytes) {
  const { createCanvas, loadImage } = await loadCanvas();
  const image = await loadImage(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(data) };
}

export async function pdfPageCount(source) {
  const doc = await openPdf(source);
  try {
    return doc.numPages;
  } finally {
    await doc.destroy();
  }
}

export async function pageHasRasterImage(source, pageNumber) {
  const api = await pdfjs();
  const doc = await openPdf(source);
  try {
    if (pageNumber < 1 || pageNumber > doc.numPages) return false;
    const page = await doc.getPage(pageNumber);
    try {
      const operators = await page.getOperatorList();
      const imageOps = new Set([
        api.OPS.paintImageMaskXObject,
        api.OPS.paintImageXObject,
        api.OPS.paintInlineImageXObject,
        api.OPS.paintImageXObjectRepeat,
        api.OPS.paintImageMaskXObjectRepeat,
        api.OPS.paintSolidColorImageMask,
      ]);
      return operators.fnArray.some((op) => imageOps.has(op));
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}






export async function pageTextCharacters(page) {
  const content = await page.getTextContent({ disableNormalization: true, includeMarkedContent: false });
  const viewport = page.getViewport({ scale: 1 });
  const styles = content.styles || {};
  const chars = [];
  for (const item of content.items) {
    if (!item || typeof item.str !== "string" || !item.str) continue;
    const text = [...item.str];
    const tx = item.transform || [1, 0, 0, 1, 0, 0];
    const fontHeight = Math.max(1, Math.hypot(tx[2], tx[3]));
    const totalWidth = Math.max(0.01, Number(item.width) || Math.hypot(tx[0], tx[1]) * text.length);
    const perChar = totalWidth / text.length;



    const style = styles[item.fontName] || null;
    for (let index = 0; index < text.length; index += 1) {
      const pdfX0 = tx[4] + perChar * index;
      const pdfX1 = tx[4] + perChar * (index + 1);
      const first = viewport.convertToViewportPoint(pdfX0, tx[5]);
      const second = viewport.convertToViewportPoint(pdfX1, tx[5] + fontHeight);
      chars.push({
        code: text[index].codePointAt(0),
        text: text[index],
        bbox: {
          x0: Math.min(first[0], second[0]),
          y0: Math.min(first[1], second[1]),
          x1: Math.max(first[0], second[0]),
          y1: Math.max(first[1], second[1]),
        },
        fontName: item.fontName || "",
        fontAscent: style ? style.ascent : null,
        fontDescent: style ? style.descent : null,
      });
    }
  }
  return chars;
}


// FILE: pdf/pdf-stream.js
/*
(PDF 6) PDF branch, position 6 in the chain - after the source runner (PDF 5).
This module runs one PDF job end to end: it prepares the file (decrypt and object-stream checks, PDF 7 to 9), streams every page (PDF 10), assembles the page records, and builds the final result.
*/
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectPdfResult, markPdfImagePages, processPageRecord, streamPdfPages } from "../decoding/source-decoding.js";
import { runQpdfFile } from "../../init/pdf/qpdf.js";
import { copyPdfPrefix, findPdfEnd } from "./pdf-tail.js";
import { renderPdfPagePng } from "./pdf-render.js";
import { PdfTextSink } from "./pdf-text-sink.js";
import { writePageStore } from "../io/write.js";
import { PageStoreWriter } from "../io/emit.js";
import { PosScanner } from "../beautify/scan.js";
import { PDF_PARSING_PATHS } from "./pdf-fonts.js";
import { startRecord, note, appendRecord, registerPath } from "../provenance.js";
import { REGISTER_LOG } from "../../_path.js";
import { normalizePageToFile, pageLayoutLines } from "../decoding/finalized-cmap.js";
import { scoreText } from "../decoding/praised/judgement.js";
import { markOrderAligned, isUnicodeLaneDecision } from "../decoding/praised/judgement.js";
import { mendZawCodeTextWithPos, requestScanLineSvgs } from "../beautify/repair.js";
import { createOriginalPdfCache } from "../original-pdf-cache.js";
import { normalize } from "../../../Architecture/Engine/MonoSyllabism/map/loader.js";
import {
  MAX_INPUT_BYTES, MAX_INPUT_MB, MAX_PAGES, MAX_TEXT_CHARS, OWNER_PARSER_WORKER,
} from "../limits/local.js";

async function preparePdf(input, prepared, directory, generalized) {
  const prepare = (source) => runQpdfFile(source, prepared, [
    "--password=", "--decrypt", "--object-streams=disable",
    ...(generalized ? ["--decode-level=generalized", "--stream-data=compress"] : ["--stream-data=preserve"]),
  ]);
  try {
    try {
      await prepare(input);
    } catch (cause) {
      if (!/can.t find startxref/iu.test(String(cause?.message))) throw cause;
      const end = findPdfEnd(input);
      if (!end || end >= fs.statSync(input).size) throw cause;
      const trimmed = path.join(directory, "trimmed.pdf");
      copyPdfPrefix(input, trimmed, end);
      await prepare(trimmed);
    }
  } catch (cause) {
    if (/invalid password|password.*incorrect|requires a password/iu.test(String(cause?.message))) {
      throw new Error("This PDF needs a password to open; supply an unprotected copy.", { cause });
    }
    throw cause;
  }
}

// First circle / parsing finish: lane module -> parser -> myanmar-score ->
// beautify -> WASM normalize. A correct-scored Unicode page passes through
// beautify untouched. Only a
// ZawCode-like page (Unicode codepoints, high Myanmar score, order still
// crossed) is beautified here, before the POS scanner and output writer. The
// mend itself is POS-confirmed per token, so a high-but-imperfect page score
// is enough to call it; low-score pages are retained for the next stage.
async function beautifyParsedPage(parsedText, page, applyCleanup) {
  if (!applyCleanup || !parsedText) return parsedText;
  if (page.parsingPath === PDF_PARSING_PATHS.LEGACY) return parsedText;
  if (!isUnicodeLaneDecision(page.decision, page.category)) return parsedText;
  const score = scoreText(parsedText);
  if (!score.marks || (markOrderAligned(parsedText) && score.score >= 0.99)) return parsedText;
  if (score.score < 0.95) return parsedText;
  const mended = await mendZawCodeTextWithPos(parsedText);
  return mended.text;
}

async function runPdfStreamAttempt(msg, { manual = false, pdfImages = false, generalized = false } = {}) {
  const directory = fs.mkdtempSync(msg.workDir
    ? path.join(msg.workDir, "pdf-") : path.join(os.tmpdir(), "linga-pdf-job-"));
  let keepDirectory = false;
  let sink = null;
  let storeWriter = null;
  let scanner = null;
  let originalPdfCache = null;
  let imageDir = null;
  let keepImages = false;
  const imageFiles = [];
  try {
    let input = msg.inPath;
    if (input) {
      if (fs.statSync(input).size > MAX_INPUT_BYTES) {
        throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
      }
    } else {
      const data = msg.data instanceof Uint8Array ? msg.data : msg.data ? new Uint8Array(msg.data) : null;
      if (!data) throw new Error("worker: no input data");
      if (data.byteLength > MAX_INPUT_BYTES) throw new Error(`Parser input exceeds the ${MAX_INPUT_MB} MB cap`);
      input = path.join(directory, "input.pdf");
      fs.writeFileSync(input, data, { mode: 0o600 });
    }
    // The input door may already have prepared this file (msg.prepared:
    // qpdf ran over the landed tmp at BindInput). Preparing again would
    // only rewrite the same bytes; seek in the door's file instead. The
    // generalized retry always prepares its own way, regardless.
    const prepared = msg.prepared === true && !generalized ? input : path.join(directory, "prepared.pdf");
    if (prepared !== input) await preparePdf(input, prepared, directory, generalized);
    // One original-PDF handle for this job. Scan does not know the PDF;
    // after it collects broken lines, repair sends their SVG requests to
    // this cache, which is the part that owns PDF -> SVG export.
    originalPdfCache = createOriginalPdfCache({
      sourcePdf: input, preparedPdf: prepared, directory,
    });

    const source = msg.filename ?? (msg.inPath ? path.basename(msg.inPath) : "");
    const provenance = startRecord(source || msg.inPath || "");
    const warnings = [];
    const pagePaths = new Set();
    const noOutput = !msg.outPath;
    const outputExt = noOutput ? null : path.extname(msg.outPath).toLowerCase();
    const textOutput = !noOutput && (outputExt === "" || outputExt === ".txt");
    const pageScratch = path.join(directory, "pages");
    fs.mkdirSync(pageScratch, { mode: 0o700 });
    const [, totalPages, pages] = streamPdfPages(prepared, () => {}, {
      diskPages: true,
      layoutPages: noOutput || outputExt === ".docx",
      scratchDir: pageScratch,
      sourceEncoding: msg.sourceEncoding ?? "auto",
      provenance,
    });
    if (totalPages > MAX_PAGES) {
      pages.return?.();
      throw new Error(`PDF exceeds the ${MAX_PAGES} page cap`);
    }
    const counts = { ZAWGYI: 0, UNICODE: 0, UNKNOWN: 0 };
    let pageNumber = 0;
    let textChars = 0;
    const reports = noOutput ? [] : null;
    // Manual OCR modifies page text later; scan that final text instead.
    if (!manual && !noOutput) scanner = new PosScanner({ directory });
    if (!noOutput && !manual && textOutput) {
      sink = new PdfTextSink(directory, { includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER });
    } else if (!noOutput) {
      storeWriter = new PageStoreWriter(directory);
    }
    try {
      for (const page of pages) {
        pageNumber += 1;
        const text = page.text;
        textChars += text.chars;
        if (textChars > MAX_TEXT_CHARS) throw new Error(`PDF extracted text exceeds the ${MAX_TEXT_CHARS} character cap`);
        counts[page.category in counts ? page.category : "UNKNOWN"] += 1;
        if (page.parsingPath === PDF_PARSING_PATHS.LEGACY) pagePaths.add("wininnwa");
        else if (page.decision === "zawcode") pagePaths.add("zawcode");
        else if (page.category === "ZAWGYI") pagePaths.add("zawgyi-one");
        else if (page.category === "UNICODE") pagePaths.add("unicode");
        if (page.warnings) warnings.push(...page.warnings);
        if (noOutput) {
          reports.push(processPageRecord({
            ...page, text: [...text.chunks()].join(""), lines: [...page.lines],
          }, false, () => {}, true, msg.sourceEncoding ?? "auto"));
          continue;
        }
        let marker = "";
        if (pdfImages && page.hasImg) {
          imageDir ??= fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"));
          const id = String(imageFiles.length + 1).padStart(4, "0");
          const target = path.join(imageDir, `${id}-page${pageNumber}.png`);
          try {
            const { png } = await renderPdfPagePng(prepared, pageNumber);
            fs.writeFileSync(target, png, { mode: 0o600 });
            imageFiles.push({ id, path: target });
            marker = `\n[[IMAGE_${id}]]`;
          } catch {
            // Keep the page text if its image cannot be rendered, as before.
          }
        }
        let firstCirclePage = null;
        try {
          // Legacy-lane pages call nothing behind the layout parse: no
          // beautify, no Normalize. Cmap-lane pages always get Normalize
          // behind their ZawCode / Rabbit / aligned finish.
          if (!manual && page.parsingPath !== PDF_PARSING_PATHS.LEGACY) {
            const parsedText = [...text.chunks()].join("");
            const beautifiedText = await beautifyParsedPage(
              parsedText, page, msg.applyCleanup !== false,
            );
            firstCirclePage = normalizePageToFile([beautifiedText], {
              directory,
              normalize: (line) => normalize(line),
            });
          }
          const output = firstCirclePage ?? text;
          if (scanner) await scanner.writePage(pageNumber, output.chunks());
          function* chunks() {
            yield* output.chunks();
            if (marker) yield marker;
          }
          if (storeWriter) {
            const layout = { lines: () => page.lines ?? [] };
            storeWriter.addPage({
              text: chunks(),
              lines: firstCirclePage && page.lines
                ? pageLayoutLines(layout, output, page.lineCount) : (page.lines ?? []),
              wh: page.wh, images: page.images ?? [], hasImg: page.hasImg === true,
            });
          } else {
            sink.addPage(chunks());
          }
        } finally { firstCirclePage?.close(); }
      }
    } finally {
      pages.return?.();
      storeWriter?.close();
    }

    const linearized = path.join(directory, "source-linearized.pdf");
    let rasterSource = linearized;
    let linearizationWarning = null;
    try {
      await runQpdfFile(prepared, linearized, ["--linearize", "--object-streams=disable", "--stream-data=preserve"]);
    } catch (error) {
      linearizationWarning = String(error?.message || error);
      rasterSource = prepared;
    }
    note(provenance, {
      detection: counts,
      output: msg.outPath,
      sourceLinearization: linearizationWarning
        ? { linearized: false, error: linearizationWarning } : { linearized: true },
    });
    if (noOutput) {
      const job = collectPdfResult(reports, totalPages, source || "upload.pdf");
      if (linearizationWarning) job.linearizationError = linearizationWarning;
      if (pdfImages) {
        imageDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-img-"));
        job.imageFiles = await markPdfImagePages(rasterSource, job, imageDir);
        keepImages = job.imageFiles.length > 0;
      }
      return { result: job };
    }
    const common = {
      filename: source || null,
      pages: pageNumber,
      counts,
      encodingPath: pagePaths.size === 1 ? [...pagePaths][0] : null,
      ...(msg.includePreview === true ? { metadata: {}, changes: [] } : {}),
      ...(pdfImages ? { imageFiles, ...(imageFiles.length ? { imageDir } : {}) } : {}),
      ...(warnings.length ? { pageWarnings: warnings } : {}),
      ...(linearizationWarning ? { linearizationWarning } : {}),
    };
    if (manual) {
      keepDirectory = true;
      return {
        ...common,
        deferredOutput: true,
        pageStore: storeWriter.store,
        internalPdf: { path: rasterSource, dir: directory },
        provenance,
      };
    }
    const written = sink ? sink.finish(msg.outPath, counts, source)
      : await writePageStore(msg.outPath, storeWriter.store, {
        directory, counts, source, includeText: msg.includeText === true, owner: OWNER_PARSER_WORKER,
      });
    const posScan = scanner ? await scanner.finish() : null;
    let svg = null;
    if (posScan?.memory?.length) {
      const requested = await requestScanLineSvgs(posScan, originalPdfCache, {
        sourcePdf: source || null,
      });
      const { requests, pending, ...rest } = requested;
      svg = { ...rest, requests: requests.length, pending: pending?.length ?? 0 };
    }
    appendRecord(provenance, { file: registerPath(REGISTER_LOG) });
    keepImages = imageFiles.length > 0;
    return { ...common, ...written, ...(posScan ? { posScan } : {}), ...(svg ? { svg } : {}) };
  } finally {
    await scanner?.close();
    originalPdfCache?.close();
    sink?.close();
    storeWriter?.close();
    if (imageDir && !keepImages) fs.rmSync(imageDir, { recursive: true, force: true });
    if (!keepDirectory) fs.rmSync(directory, { recursive: true, force: true });
  }
}

export async function runPdfStream(msg, options = {}) {
  try {
    return await runPdfStreamAttempt(msg, options);
  } catch (error) {
    if (error?.code !== "PDF_CONTENT_DECODE_REQUIRED" || options.generalized) throw error;
    // Less common filter chains require qpdf's generalized decoder. Retry the
    // whole job so the original checkpoint and page decisions are unchanged.
    return runPdfStreamAttempt(msg, { ...options, generalized: true });
  }
}


// FILE: pdf/pdf-tail.js
/*
(PDF 9) PDF branch, position 9 in the chain - helper of the preparation step (PDF 8).
This module finds the true end of a PDF (the last startxref/EOF pair) in bounded reverse reads, and copies a clean prefix of the file when the tail is damaged or padded.
*/
import fs from "node:fs";

const BLOCK_SIZE = 64 * 1024;

// Some PDFs have very long comments after the last EOF. Find the last complete
// startxref/EOF pair in bounded reverse reads rather than loading the PDF.
export function findPdfEnd(source) {
  const fd = fs.openSync(source, "r");
  try {
    const size = fs.fstatSync(fd).size;
    let end = size;
    let following = Buffer.alloc(0);
    while (end > 0) {
      const start = Math.max(0, end - BLOCK_SIZE);
      const block = Buffer.allocUnsafe(end - start);
      const count = fs.readSync(fd, block, 0, block.length, start);
      if (count !== block.length) throw new Error("PDF tail ended unexpectedly");
      const bytes = following.length ? Buffer.concat([block, following]) : block;
      const text = bytes.toString("latin1");
      const matches = [...text.matchAll(/startxref\s+(\d+)\s+%%EOF/gu)];
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const match = matches[index];
        const xref = Number(match[1]);
        const absolute = start + match.index;
        if (Number.isSafeInteger(xref) && xref >= 0 && xref < absolute) {
          return absolute + match[0].length;
        }
      }
      following = Buffer.from(bytes.subarray(0, Math.min(bytes.length, BLOCK_SIZE)));
      end = start;
    }
    return null;
  } finally { fs.closeSync(fd); }
}

export function copyPdfPrefix(source, target, length) {
  if (!Number.isSafeInteger(length) || length < 1) throw new RangeError("Invalid PDF length");
  const input = fs.openSync(source, "r");
  let output = null;
  try {
    output = fs.openSync(target, "wx", 0o600);
    const buffer = Buffer.allocUnsafe(BLOCK_SIZE);
    let position = 0;
    while (position < length) {
      const count = fs.readSync(input, buffer, 0, Math.min(buffer.length, length - position), position);
      if (!count) throw new Error("PDF ended while copying its valid prefix");
      let written = 0;
      while (written < count) {
        const n = fs.writeSync(output, buffer, written, count - written);
        if (!n) throw new Error("Could not write the PDF temporary file");
        written += n;
      }
      position += count;
    }
  } finally {
    fs.closeSync(input);
    if (output !== null) fs.closeSync(output);
  }
}


// FILE: pdf/pdf-text-sink.js
/*
(PDF 29) PDF branch, position 29 in the chain - writing helper of the stream runner (PDF 6).
This module is the text sink: it appends finished page text to the job's output text file within the job's size limits.
*/
import fs from "node:fs";
import path from "node:path";
import { MAX_TEXT_CHARS } from "../limits/local.js";

function writeAll(fd, value) {
  const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  let offset = 0;
  while (offset < bytes.length) offset += fs.writeSync(fd, bytes, offset, bytes.length - offset);
}

export function copyTextFile(file, fd) {
  const source = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let length;
    while ((length = fs.readSync(source, buffer, 0, buffer.length, null)) > 0) {
      writeAll(fd, buffer.subarray(0, length));
    }
  } finally {
    fs.closeSync(source);
  }
}

function headerFor(counts, source, total) {
  return `# Source: ${source || "-"}\n# Pages: ${total}\n` +
    `# Detection: ${counts.ZAWGYI ?? 0} Zawgyi, ${counts.UNICODE ?? 0} Unicode, ${counts.UNKNOWN ?? 0} unknown\n` +
    "#".repeat(50) + "\n\n";
}

export class PdfTextSink {
  constructor(directory, { includeText = false, owner = false } = {}) {
    this.bodyPath = path.join(directory, "txt-body");
    this.joinedPath = includeText ? path.join(directory, "txt-joined") : null;
    this.body = fs.openSync(this.bodyPath, "wx", 0o600);
    try {
      this.joined = this.joinedPath ? fs.openSync(this.joinedPath, "wx", 0o600) : null;
    } catch (error) {
      fs.closeSync(this.body);
      this.body = null;
      throw error;
    }
    this.owner = owner;
    this.pages = 0;
    this.lineCount = 0;
    this.pageTextChars = 0;
    this.textChars = 0;
    this.textBytes = 0;
  }

  addPage(chunks) {
    if (this.body == null) throw new Error("TXT sink is closed");
    if (this.pages) {
      this.textChars += 2;
      this.textBytes += 2;
      if (this.joined != null) writeAll(this.joined, "\n\n");
    }
    this.pages += 1;
    writeAll(this.body, `--- Page ${this.pages} ---\n`);
    let hasText = false;
    let nonempty = false;
    let newlines = 0;
    for (const chunk of chunks) {
      if (!chunk) continue;
      nonempty = true;
      hasText ||= /\S/u.test(chunk);
      this.pageTextChars += chunk.length;
      this.textChars += chunk.length;
      if (!this.owner && this.pageTextChars > MAX_TEXT_CHARS) {
        throw new Error(`Output text exceeds the ${MAX_TEXT_CHARS} character cap`);
      }
      this.textBytes += Buffer.byteLength(chunk, "utf8");
      for (const character of chunk) if (character === "\n") newlines += 1;
      writeAll(this.body, chunk);
      if (this.joined != null) writeAll(this.joined, chunk);
    }
    if (nonempty) this.lineCount += newlines + 1;
    writeAll(this.body, "\n\n");
    return hasText;
  }

  finish(outPath, counts, source) {
    this.close();
    const out = path.extname(outPath) ? outPath : `${outPath}.txt`;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const output = fs.openSync(out, "w");
    try {
      writeAll(output, headerFor(counts, source, this.pages));
      copyTextFile(this.bodyPath, output);
    } finally {
      fs.closeSync(output);
    }
    return {
      file: out,
      lineCount: this.lineCount,
      mimeType: "text/plain",
      textChars: this.textChars,
      textBytes: this.textBytes,
      ...(this.joinedPath ? { text: fs.readFileSync(this.joinedPath, "utf8") } : {}),
    };
  }

  close() {
    if (this.body != null) fs.closeSync(this.body);
    if (this.joined != null) fs.closeSync(this.joined);
    this.body = null;
    this.joined = null;
  }
}


// FILE: pdf/pdf-writer.js
/*
(PDF 33) PDF branch, position 33 in the chain - low-level helper of the renderer (PDF 32).
This module is the small PDF writer used to build the output PDF file object by object.
*/
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { TtfFont } from "../codepage/ttf.js";

function writeAll(fd, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
    if (!count) throw new Error("Could not write the PDF output");
    offset += count;
  }
}

function copyFileTo(file, write) {
  const source = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let count;
    while ((count = fs.readSync(source, buffer, 0, buffer.length, null)) > 0) {
      write(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(source);
  }
}

const PT_PER_MM = 72 / 25.4;


const FLOAT_TOLERANCE = 1e-9;
const floatEq = (a, b) => Math.abs(a - b) <= FLOAT_TOLERANCE;


const A4_W_PT = 595.28;
const A4_H_PT = 841.89;
const MARGIN_1CM_MM = 9.999999999999998;
const C_MARGIN_MM = 0.9999999999999998;
const B_MARGIN_20MM = 19.999999999999996;

export class PdfWriter {
  constructor(directory) {
    this.directory = directory;
    this.pageFile = path.join(directory, "pdf-page-commands");
    this.pageFd = fs.openSync(this.pageFile, "wx", 0o600);
    this.pageOffset = 0;
    this.k = PT_PER_MM;
    this.pageWpt = A4_W_PT;
    this.pageHpt = A4_H_PT;
    this.w = this.pageWpt / this.k;
    this.h = this.pageHpt / this.k;
    this.lMargin = MARGIN_1CM_MM;
    this.rMargin = MARGIN_1CM_MM;
    this.tMargin = MARGIN_1CM_MM;
    this.cMargin = C_MARGIN_MM;
    this.bMargin = B_MARGIN_20MM;
    this.autoPageBreak = true;
    this.pageBreakTrigger = this.h - this.bMargin;

    this.x = this.lMargin;
    this.y = this.tMargin;
    this.fonts = new Map();     
    this.fontOrder = [];        
    this.current = null;        
    this.fontSizePt = 12;
    this.fontSize = 12 / this.k;
    this.charSpacing = 0;
    this.textColor = [0, 0, 0];
    this.fallbackFamilies = [];

    this.pages = [];
    this.page = null;
    this.pageNo = 0;
    this.footerFn = null;
    this.fontSetOnPage = false;   
    this.fontFamily = "";       
    this.fontStyle = "";        
    this._inFooter = false;
  }

  
  setAutoPageBreak(auto, margin) {
    this.autoPageBreak = auto;
    if (auto) {
      this.bMargin = margin === undefined ? this.bMargin : (margin * B_MARGIN_20MM) / 20;
      this.pageBreakTrigger = this.h - this.bMargin;
    }
  }

  setFooter(fn) { this.footerFn = fn; }

  
  addPage() {
    this.fontSetOnPage = false;
    const snap = { charSpacing: this.charSpacing };
    if (this.page) this._endPage();
    this._beginpage();
    if (snap.charSpacing !== 0) this.setCharSpacing(snap.charSpacing);
  }
  _beginpage() {
    this.pageNo += 1;
    this.page = { start: this.pageOffset, length: 0, fonts: new Set() };
    this.pages.push(this.page);
    this._out("2 J");
    this._out(`${(0.2 * this.k).toFixed(2)} w`);
    this.x = this.lMargin;
    this.y = this.tMargin;
    this.fontFamily = "";
    this.charSpacing = 0;   
  }

  _endPage() {
    
    
    if (this.footerFn) {
      this._inFooter = true;
      try { this.footerFn(this); } finally { this._inFooter = false; }
    }
    this.page.length = this.pageOffset - this.page.start;
    this.page = null;
  }

  _out(s) {
    if (!this.page) throw new Error("No page open — call addPage() first");
    const bytes = Buffer.from(`${s}\n`, "latin1");
    writeAll(this.pageFd, bytes);
    this.pageOffset += bytes.length;
  }

  close() {
    if (this.pageFd != null) fs.closeSync(this.pageFd);
    this.pageFd = null;
  }

  
  addFont(family, style, file) {
    
    
    const key = `${family.toLowerCase()}${style}`;
    if (this.fonts.has(key)) return this.fonts.get(key);
    if (!fs.existsSync(file)) return null; 
    const entry = { key, family, style, file, font: new TtfFont(file), index: 0 };
    this.fonts.set(key, entry);
    this.fontOrder.push(entry);
    entry.index = this.fontOrder.length; 
    return entry;
  }

  
  setFont(family, style = "", sizePt = null) {
    let fam = family || this.fontFamily;
    fam = fam.toLowerCase();
    let size = sizePt;
    if (!size) size = this.fontSizePt;            
    const fontkey = `${fam}${style}`;
    if (this.fontFamily === fam && this.fontStyle === style
      && floatEq(this.fontSizePt, size)
      && (this.current === null || this.current.key === fontkey)) {
      return this.current;                        
    }
    const entry = this.fonts.get(fontkey);
    if (!entry) {
      throw new Error(`Font "${family}" with style "${style}" is not included`);
    }
    this.fontFamily = fam;
    this.fontStyle = style;
    this.fontSizePt = size;
    this.fontSize = size / this.k;
    this.current = entry;
    this.fontSetOnPage = false;
    return entry;
  }

  
  setFallbackFonts(families) {
    this.fallbackFamilies = [];
    for (const fam of families) {
      const low = String(fam).toLowerCase();
      for (const e of this.fontOrder) {
        if (e.key.startsWith(low) && !this.fallbackFamilies.includes(e)) {
          this.fallbackFamilies.push(e);
        }
      }
    }
  }

  
  setCharSpacing(v) {
    if (this.charSpacing === v) return;
    this.charSpacing = v;
    if (this.pageNo > 0) this._out(`BT ${v.toFixed(2)} Tc ET`);
  }

  setTextColor(r, g, b) { this.textColor = [r, g, b]; }

  setXY(x, y) { this.x = x; this.y = y; }
  setY(y) { this.y = y < 0 ? this.h + y : y; }
  setX(x) { this.x = x; }

  ln(h = null) {
    this.y += h === null ? this.fontSize : h;
    this.x = this.lMargin;
  }

  
  
  cell(w, h, text = "", opts = {}) {
    const { align = "L", newX = "RIGHT", newY = "TOP" } = opts;
    if (this.autoPageBreak && !this._inFooter && this.y + h > this.pageBreakTrigger) this.addPage();
    if (w === 0) w = this.w - this.rMargin - this.x;
    const primary = this.current;
    const fallbacks = this.fallbackFamilies.filter((e) => e !== primary);

    
    
    
    const runs = [];
    for (const ch of String(text)) {
      const cp = ch.codePointAt(0);
      let chosen = primary.font.hasCodepoint(cp) ? primary : null;
      if (!chosen) {
        const withChar = fallbacks.filter((e) => e.font.hasCodepoint(cp));
        chosen = withChar.find((e) => e.style === primary.style) ?? primary;
      }
      const last = runs[runs.length - 1];
      if (last && last.font === chosen) last.chars.push(ch);
      else runs.push({ font: chosen, chars: [ch] });
    }
    if (!runs.length) runs.push({ font: primary, chars: [] });

    
    let widthPt = 0;
    runs.forEach((run, i) => {
      const n = run.chars.length;
      let wpt = run.font.font.textWidthPt(run.chars.join(""), this.fontSizePt);
      if (this.charSpacing !== 0) {
        wpt += i !== 0 ? this.charSpacing * n : this.charSpacing * (n - 1);
      }
      widthPt += wpt;
    });
    const styledWidth = widthPt / this.k;
    let dx;
    if (align === "R") dx = w - this.cMargin - styledWidth;
    else if (align === "C" || align === "J") dx = (w - styledWidth) / 2;
    else dx = this.cMargin;

    const tx = (this.x + dx) * this.k;
    const ty = (this.h - this.y - 0.5 * h - 0.3 * this.fontSize) * this.k;
    const [r, g, b] = this.textColor;
    const colored = r !== 0 || g !== 0 || b !== 0;

    const parts = [`BT ${tx.toFixed(2)} ${ty.toFixed(2)} Td`];
    
    
    const sizeStr = this.fontSizePt.toFixed(2);
    if (!this.fontSetOnPage && runs[0].chars.length && runs[0].font !== primary) {
      parts.push(`/F${primary.index} ${sizeStr} Tf`);
      this.fontSetOnPage = true;
    } else if (!this.fontSetOnPage) {
      this._out(`BT /F${primary.index} ${sizeStr} Tf ET`);
      this.fontSetOnPage = true;
    }
    if (colored) parts.push(`${(r / 255).toFixed(4)} ${(g / 255).toFixed(4)} ${(b / 255).toFixed(4)} rg`);

    
    let curFont = primary;
    for (const run of runs) {
      if (!run.chars.length) continue;
      this.page.fonts.add(run.font);
      if (run.font !== curFont) {
        parts.push(`/F${run.font.index} ${sizeStr} Tf`);
        curFont = run.font;
      }
      let hex = "";
      for (const ch of run.chars) {
        const cp = ch.codePointAt(0);
        run.font.font.usedCps.add(cp);
        hex += run.font.font.glyphId(cp).toString(16).padStart(4, "0");
      }
      parts.push(`<${hex}> Tj`);
    }
    if (parts.length === 1) parts.push("<> Tj");
    const line = parts.join(" ") + " ET";
    this._out(colored ? `q ${line} Q` : line);

    if (newX === "LMARGIN" || newX === "START") this.x = this.lMargin;
    else if (newX === "RIGHT" || newX === "END") this.x += w;
    if (newY === "NEXT") this.y += h;
  }

  
  async output(outPath) {
    if (this.page) this._endPage();
    this.close();
    const used = new Set();
    for (const p of this.pages) for (const f of p.fonts) used.add(f);
    const fonts = this.fontOrder.filter((f) => used.has(f));
    const out = fs.openSync(outPath, "wx", 0o600);
    let pos = 0;
    const offsets = [];
    const push = (value) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "latin1");
      writeAll(out, bytes);
      pos += bytes.length;
    };
    const obj = (id, body, stream = null) => {
      offsets[id] = pos;
      push(`${id} 0 obj\n${body}\n`);
      if (stream !== null) {
        push("stream\n");
        push(stream);
        push("\nendstream\n");
      }
      push("endobj\n");
    };
    const fileObj = (id, body, file) => {
      offsets[id] = pos;
      push(`${id} 0 obj\n${body}\nstream\n`);
      copyFileTo(file, push);
      push("\nendstream\nendobj\n");
    };

    try {
      push(Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1"));
      const nPages = this.pages.length || 1;
      const catalogId = 1;
      const pagesId = 2;
      const fontBase = 3;
      const pageBase = fontBase + fonts.length * 5;
      const total = pageBase + nPages * 2 - 1;

      obj(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
      offsets[pagesId] = pos;
      push(`${pagesId} 0 obj\n<< /Type /Pages /Kids [`);
      for (let i = 0; i < nPages; i += 1) push(`${i ? " " : ""}${pageBase + i * 2} 0 R`);
      push(`] /Count ${nPages} >>\nendobj\n`);

      for (let i = 0; i < fonts.length; i += 1) {
        const f = fonts[i];
        const entry = f.font;
        const type0Id = fontBase + i * 5;
        const cidId = type0Id + 1;
        const descId = type0Id + 2;
        const fileId = type0Id + 3;
        const touId = type0Id + 4;
        const scale = 1000 / entry.unitsPerEm;

        const wArr = [];
        for (let g = 0; g < entry.numGlyphs; g += 1) {
          wArr.push(Math.round((entry.advanceWidths[g] ?? 0) * scale));
        }
        const cps = [...entry.usedCps].filter((cp) => entry.glyphId(cp) !== 0).sort((a, b) => a - b);
        const blocks = [];
        for (let k = 0; k < cps.length; k += 100) {
          const slice = cps.slice(k, k + 100);
          blocks.push(`${slice.length} beginbfchar\n`
            + slice.map((cp) => `<${entry.glyphId(cp).toString(16).padStart(4, "0")}> <${cp.toString(16).padStart(4, "0")}>`).join("\n")
            + "\nendbfchar");
        }
        const touText = [
          "/CIDInit /ProcSet findresource begin",
          "12 dict begin", "begincmap",
          "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
          "/CMapName /Adobe-Identity-UCS def", "/CMapType 2 def",
          "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange",
          ...blocks,
          "endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end",
        ].join("\n");
        const tou = zlib.deflateSync(Buffer.from(touText, "latin1"));
        const fontSize = fs.statSync(f.file).size;
        const bb = entry.bbox.map((v) => Math.round(v * scale));

        obj(type0Id, `<< /Type /Font /Subtype /Type0 /BaseFont /${entry.name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${touId} 0 R >>`);
        obj(cidId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${entry.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /CIDToGIDMap /Identity /DW 1000 /W [0 [${wArr.join(" ")}]] >>`);
        obj(descId, `<< /Type /FontDescriptor /FontName /${entry.name} /Flags 4 /FontBBox [${bb.join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(entry.ascent * scale)} /Descent ${Math.round(entry.descent * scale)} /CapHeight ${Math.round(entry.ascent * scale)} /StemV 80 /StemH 60 /FontFile2 ${fileId} 0 R >>`);
        fileObj(fileId, `<< /Length ${fontSize} /Length1 ${fontSize} >>`, f.file);
        obj(touId, `<< /Length ${tou.length} /Filter /FlateDecode >>`, tou);
      }

      const fontRes = fonts.map((f) => `/F${f.index} ${fontBase + fonts.indexOf(f) * 5} 0 R`).join(" ");
      const compressed = path.join(this.directory, "pdf-page-deflate");
      for (let i = 0; i < this.pages.length; i += 1) {
        const p = this.pages[i];
        const pageId = pageBase + i * 2;
        const contId = pageId + 1;
        obj(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWpt} ${this.pageHpt}] `
          + `/Resources << /ProcSet [/PDF /Text] /Font << ${fontRes} >> >> /Contents ${contId} 0 R >>`);
        await pipeline(
          fs.createReadStream(this.pageFile, { start: p.start, end: p.start + p.length - 1 }),
          zlib.createDeflate(),
          fs.createWriteStream(compressed, { flags: "w", mode: 0o600 }),
        );
        const size = fs.statSync(compressed).size;
        fileObj(contId, `<< /Length ${size} /Filter /FlateDecode >>`, compressed);
      }

      const xrefPos = pos;
      push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
      for (let id = 1; id <= total; id += 1) {
        push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
      }
      push(`trailer\n<< /Size ${total + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
    } finally {
      fs.closeSync(out);
    }
    return outPath;
  }
}


// FILE: provenance.js
/*
(Support 25) Shared support, no chain position - provenance records.
This module starts and appends per-job provenance records: what was parsed, from where, and which decisions were taken.
*/







































import fs from "node:fs";
import path from "node:path";

const RULE = "\u2500".repeat(60);

const off = () => /^(0|false|no|off)$/iu.test(String(process.env.PRASER_REGISTER ?? ""));





export function startRecord(source = "") {
  return {
    source: source ? path.basename(source) : "",
    sourcePath: source || "",
    at: new Date().toISOString(),
    pages: null,
    detection: null,
    metadata: null,
    fonts: null,
    codepage: null,
    scan: null,
    output: null,
  };
}



export function note(record, facts) {
  if (!record || !facts) return record;
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}



export function registerPath(fallback) {
  const chosen = String(process.env.PRASER_REGISTER ?? "").trim();
  return chosen && !off() ? chosen : fallback;
}





export function appendRecord(record, { file, log = () => {} } = {}) {
  if (!record || off() || !file) return null;
  const entry = [
    RULE,
    record.source || "(unnamed)",
    record.at,
    RULE,
    JSON.stringify(record, null, 2),
    "",
    "",
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, entry, "utf8");
    return file;
  } catch (error) {
    log(`[-] Register not written (${error.message})`);
    return null;
  }
}


// FILE: rule/rabbit.js
/*
(PDF 23) PDF branch, position 23 in the chain - text helper of the finishing step (PDF 19).
This module provides the Rabbit Zawgyi-to-Unicode conversion exports the pipeline imports.
*/
// Minimal rabbit stub.
// Original rabbit.js was never in the JS repo; this provides the
// createRabbitStream and Rabbit exports so pipeline.js and
// finalized-cmap.js can import them.
export function createRabbitStream(output, { preserveSpaces = false } = {}) {
  return {
    push(chunk, final = false) {
      if (final) return;
      if (typeof output === "function") output(chunk);
    },
  };
}

export const Rabbit = {
  zg2uni(text) {
    return text;
  },
};


// FILE: rule/unicode-evidence.js
/*
(PDF 26) PDF branch, position 26 in the chain - text helper of the finishing step (PDF 19).
This module protects valid regional Unicode Myanmar runs (Mon and extension signs) so Burmese-only cleanup and ordering never rewrite them.
*/
// These are valid Unicode Myanmar extensions, including Mon vowel signs.
// Several occupy the same code points that Zawgyi fonts used for other glyphs.
const REGIONAL = /[\u1033-\u1035\u1050-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F]/u;
const MYANMAR_RUN = /[\u1000-\u109F\uA9E0-\uA9FF\uAA60-\uAA7F\u200B-\u200D]+/gu;

// Do not apply Burmese-only cleanup or ordering inside a regional run. Leave
// the entire run intact, including contextual marks and joiners; unrelated
// spans can still use the caller's normal processing.
export function preserveRegionalRuns(text, transform) {
  if (typeof text !== "string" || !REGIONAL.test(text)) return transform(text);
  let result = "";
  let cursor = 0;
  for (const match of text.matchAll(MYANMAR_RUN)) {
    if (!REGIONAL.test(match[0])) continue;
    if (match.index > cursor) result += transform(text.slice(cursor, match.index));
    result += match[0];
    cursor = match.index + match[0].length;
  }
  return cursor < text.length ? result + transform(text.slice(cursor)) : result;
}


// FILE: rule/zawcode-order.js
/*
(PDF 21) PDF branch, position 21 in the chain - text helper of the finishing step (PDF 19).
This module arranges ZawCode/Zawgyi mark order into Unicode order for a page's text.
*/
import { getMasterMapData } from "./clean.js";

const E = "\u1031";
const AA = "\u102C";
const RA = "\u103C";

let engineBases = null;
function isEngineBase(ch) {
  if (!ch) return false;
  if (engineBases === null) {
    const bases = getMasterMapData().MMap?.Base;
    if (!Array.isArray(bases)) throw new Error("Engine master is missing MMap.Base");
    engineBases = new Set(bases);
  }
  return engineBases.has(ch);
}

// Index each line once. Position 0 is the unchanged character immediately
// before a pattern (or a virtual boundary at the start of a line).
export function arrangeZawCodeOrder(text) {
  if (typeof text !== "string") throw new TypeError("Expected text");
  // The caller applies this result only in the ZawCode lane; comparisons use a copy.
  const chars = Array.from(String(text ?? "").replace(/\u200b/gu, ""));
  const out = [];

  for (let i = 0; i < chars.length;) {
    const current = chars[i];
    const next = chars[i + 1];
    const after = chars[i + 2];
    const fourth = chars[i + 3];
    const fifth = chars[i + 4];

    // The position immediately before a pattern must not be e.
    if (chars[i - 1] !== E) {
      if (current === E && next === RA && isEngineBase(after) && fourth === E && isEngineBase(fifth)) {
        out.push(after, RA, E, fifth, E);
        i += 5;
        continue;
      }
      if (current === E && isEngineBase(next) && isEngineBase(after) && fourth === AA) {
        out.push(next, E, after, AA);
        i += 4;
        continue;
      }
      if (next === AA && after === RA && isEngineBase(current) && isEngineBase(fourth)) {
        out.push(current, AA, fourth, RA);
        i += 4;
        continue;
      }
      if (current === RA && isEngineBase(next) && after === E && fourth === RA && isEngineBase(fifth)) {
        out.push(next, RA, fifth, RA, E);
        i += 5;
        continue;
      }
      if (current === E && isEngineBase(next) && after === AA) {
        out.push(next, AA, E);
        i += 3;
        continue;
      }
      if (current === E && next === RA && isEngineBase(after)) {
        out.push(after, RA, E);
        i += 3;
        continue;
      }
      if (current === RA && isEngineBase(next)) {
        out.push(next, RA);
        i += 2;
        continue;
      }
      if (current === E && isEngineBase(next)) {
        out.push(next, E);
        i += 2;
        continue;
      }
    }

    out.push(current);
    i += 1;
  }
  return out.join("");
}

// Arrange only after a ZawCode scan verdict. Output normalization happens
// separately, after parsing and any image text have been merged.
export function orderZawCodePages(pages, report, { path = null } = {}) {
  if (path !== "zawcode" || !report) return pages;
  const orderTextLines = (text) => arrangeZawCodeOrder(String(text ?? ""));

  return pages.map((page) => {
    const originalText = String(page?.text ?? "");
    let lines = page?.lines;
    let text;
    if (Array.isArray(lines)) {
      const originalLines = lines.map((line) => String(line[3] ?? "")).join("\n");
      lines = lines.map((line) => {
        const ordered = [...line];
        ordered[3] = orderTextLines(line[3]);
        return ordered;
      });
      text = originalLines === originalText
        ? lines.map((line) => line[3]).join("\n")
        : orderTextLines(originalText);
    } else {
      text = orderTextLines(originalText);
    }
    const linesChanged = Array.isArray(lines)
      && lines.some((line, i) => line[3] !== page.lines[i][3]);
    if (text === originalText && !linesChanged) return page;
    return { ...page, text, ...(Array.isArray(lines) ? { lines } : {}) };
  });
}


// FILE: type/output.js
/*
(PDF 2) PDF branch, position 2 in the chain - helper of the worker entry (PDF 1), also used by the OCR worker.
This module normalizes the requested output type (pdf, docx or txt) on worker jobs so every later stage sees one clean value.
*/
import path from "node:path";

export const OUTPUT_TYPES = new Set(["pdf", "docx", "txt"]);

export function normalizeOutputType(output) {
  if (output === undefined || output === null || output === "") return "txt";
  const normalized = String(output).trim().toLowerCase().replace(/^\./, "");
  if (!OUTPUT_TYPES.has(normalized)) {
    throw new TypeError(`Unsupported output "${output}" (use "pdf", "docx", or "txt")`);
  }
  return normalized;
}

// The requested output type owns the extension of the path the worker
// writes, so downstream writers choose txt/docx/pdf from the trigger's
// output field instead of from whatever suffix a caller happened to use.
export function withOutputType(msg = {}) {
  const output = normalizeOutputType(msg.output ?? msg.outputFormat ?? msg.outputType);
  if (!msg.outPath) return { ...msg, output };
  const ext = path.extname(msg.outPath);
  if (ext.toLowerCase() === `.${output}`) return { ...msg, output };
  const base = ext ? msg.outPath.slice(0, -ext.length) : msg.outPath;
  return { ...msg, output, outPath: `${base}.${output}` };
}


// FILE: type/requested.js
/*
(PDF 31) PDF branch, position 31 in the chain - after all pages are finished (PDF 19).
This module writes the final output: it takes the finished pages and produces the requested txt, docx or pdf file (PDF 32).
*/
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeDocxLayout, writeDocxPlain, writePdf } from "./render.js";
import { PdfTextSink } from "../pdf/pdf-text-sink.js";
import { layoutLines, pageRecords, textChunks } from "./emit.js";
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



// FILE: worker/converter.js
/*
(PDF 1) PDF branch, position 1 in the chain - the converter worker thread where a PDF job starts.
This module runs inside a worker thread spawned by the Manager pool. It receives the job object, works out whether the input is PDF or DOCX, and hands PDF work to the converter-side PDF entry (PDF 3).
*/
import { parentPort } from "node:worker_threads";
import { runFromPdf } from "../decoding/from-pdf.js";
import { runFromDocx } from "../decoding/from-docx.js";
import { withOutputType } from "./output-type.js";

if (!parentPort) {
  throw new Error("converter.js must be run as a worker thread");
}

function firstBytes(msg = {}) {
  const bytes = msg.data ?? msg.bytes ?? msg.object?.bytes ?? msg.object?.data;
  return bytes instanceof Uint8Array ? bytes : null;
}

function kindFromName(name) {
  const ext = String(name ?? "").toLowerCase().split(".").pop();
  return ext === "pdf" || ext === "docx" ? ext : null;
}

// The converter owns the PDF/DOCX choice: callers send key:"converter" and
// do not pick a file-format worker. Prefer the actual bytes, then an explicit
// kind/input field, then the filename/object path.
export function detectConverterKind(msg = {}) {
  const bytes = firstBytes(msg);
  if (bytes && bytes.length >= 5
    && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
    && bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return "pdf"; // "%PDF-"
  }
  if (bytes && bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return "docx"; // ZIP container ("PK"), which is what a DOCX is.
  }

  const declared = String(msg.kind ?? msg.inputKind ?? msg.inputFormat ?? "")
    .trim()
    .toLowerCase();
  if (declared === "pdf" || declared === "docx") return declared;

  return kindFromName(msg.filename)
    ?? kindFromName(msg.inPath)
    ?? kindFromName(msg.object?.path)
    ?? kindFromName(msg.object?.filename);
}

async function run(msg = {}) {
  // Default converter behavior: detect the input type here, inside the
  // worker. The caller only sends key:"converter" plus the desired output
  // type; it never picks a PDF worker or a DOCX worker.
  const job = withOutputType(msg);
  const kind = detectConverterKind(job);
  if (kind === "docx") return runFromDocx({ ...job, kind });
  if (kind === "pdf") return runFromPdf({ ...job, kind });
  throw new Error("converter worker could not detect PDF or DOCX input");
}

parentPort.on("message", async (msg) => {
  const { id } = msg ?? {};
  try {
    const result = await run(msg);
    if (result && typeof result === "object" && "result" in result && !("file" in result)) {
      parentPort.postMessage({ id, ok: true, result: result.result });
      return;
    }
    parentPort.postMessage({ id, ok: true, ...result });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error
        ? { name: err.name, message: err.message, stack: err.stack }
        : { name: "Error", message: String(err) },
    });
  }
});


// FILE: worker/limit.js
/*
(Support 23) Shared support, no chain position - the local caller's limit profile.
This module defines the size, page and text caps for trusted local stream callers, read from environment variables with hard maximums.
*/
// Local limits (local caller — stream-based)
// Split from shared 03-limits.js — local caller has looser caps because the
// caller already holds the stream/object and the parser never touches the
// original source path directly.
import { isMainThread, workerData } from 'node:worker_threads';
import { ValueError } from '../pylib.js';

// Local stream owner is trusted: the caller opened the stream themselves.
export const OWNER_PARSER_WORKER = !isMainThread && workerData?.parserOwner === true;

export function positiveLimit(name, fallback, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(String(raw))) {
    throw new ValueError(`${name} must be a positive integer`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ValueError(`${name} must be between 1 and ${maximum}`);
  }
  return value;
}

export function resourceLimit(name, fallback, maximum) {
  return OWNER_PARSER_WORKER ? Infinity : positiveLimit(name, fallback, maximum);
}

// Local caller caps: looser than site because the caller is trusted
// (CLI, Python, internal service) and supplies the stream directly.
export const MAX_INPUT_MB = resourceLimit('LOCAL_UPLOAD_MAX_MB', 128, 4096);
export const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
export const MAX_PAGES = resourceLimit('LOCAL_MAX_PAGES', 20_000, 1_000_000);
export const MAX_TEXT_CHARS = resourceLimit('LOCAL_MAX_TEXT_CHARS', 50_000_000, 2_000_000_000);

export const WORKER_TIMEOUT_MS = positiveLimit('LOCAL_TIMEOUT_MS', 300_000, 3_600_000);
export const OCR_BASE_TIMEOUT_MS = positiveLimit(
  'LOCAL_OCR_TIMEOUT_MS',
  300_000,
  3_600_000,
);
export const WORKER_HEAP_MB = positiveLimit('LOCAL_WORKER_HEAP_MB', 512, 2048);
export const MAX_OCR_PIXELS = resourceLimit('LOCAL_MAX_OCR_PIXELS', 80_000_000, 200_000_000);

export const MAX_OCR_PAGES = resourceLimit('LOCAL_MAX_OCR_PAGES', 100, 1000);
export const OCR_PAGE_TIMEOUT_MS = positiveLimit('LOCAL_OCR_PAGE_MS', 30_000, 300_000);

export function ocrTimeoutMs(pages = 0) {
  const n = Number.isSafeInteger(pages) && pages > 0 ? Math.min(pages, MAX_OCR_PAGES) : 1;
  return OCR_BASE_TIMEOUT_MS + n * OCR_PAGE_TIMEOUT_MS;
}


// FILE: worker/ocr.js
/*
(OCR 1) OCR branch, position 1 in the chain - the OCR worker thread where an OCR job starts.
This module runs inside a worker thread spawned by the Manager pool and passes each OCR message to the OCR operations (OCR 2).
*/
import { parentPort } from "node:worker_threads";
import { handleOcrMessage } from "../ocr/ocr-ops.js";
import { withOutputType } from "./output-type.js";

if (!parentPort) {
  throw new Error("ocr.js must be run as a worker thread");
}

parentPort.on("message", async (msg) => {
  const { id } = msg ?? {};
  try {
    // A trigger/dispatcher OCR job arrives as job:"ocr"; the OCR operations
    // module names that same file-OCR operation op:"ocr". Existing low-level
    // op/type messages keep their original shape.
    const job = withOutputType(msg ?? {});
    const message = job.job === "ocr" && !job.op && !job.type
      ? { ...job, op: "ocr" }
      : job;
    const res = await handleOcrMessage(message);
    if (res && typeof res === "object" && "file" in res) {
      parentPort.postMessage({ id, ok: true, ...res });
    } else {
      parentPort.postMessage({ id, ok: true, result: res });
    }
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
