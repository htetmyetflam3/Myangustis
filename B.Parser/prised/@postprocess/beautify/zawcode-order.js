/*
Beautify branch - the ZawCode rules. When judgement's evidence says a
page is ZawCode (the swapping rule matches more than one slot), beautify
calls these rules: the swapping rule itself (arrangeZawCodeOrder,
orderZawCodePages) and the ZawCode mend rules below it (zawCodeGuard,
mendZawCodeText, beautifyFromScanVerdict). These rules rewrite text;
deciding stays in @rule/judgement.js.
*/
import {
  getMasterMapData, orderText, unmixZawCodeMarks, retraceZawCodeMarks,
  settleZawCodeAhE, medialFollows, reorderMarks,
} from "./clean.js";
import { scoreText, isIndex } from "../../@rule/mm-score.js";
import { scanText, scanBrokenSpans } from "../init.js";

const MM_RUN = /[\u1000-\u1049\u105a-\u109f]+/gu;

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
  // No character is stripped here: zero-width characters ride
  // through the swap untouched, wherever they fall.
  const chars = Array.from(String(text ?? ""));
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
        // ာ / ါ can never stand in front of ေ: the swap puts the
        // base, then ေ, then ာ (base + ေ + ာ), never base + ာ + ေ.
        // (ြ / ျ CAN stand in front of ေ - see the ြ rules above.)
        out.push(next, E, after);
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


/*
DO NOT collapse the two scanning phases into one - that is how this
design gets lost. The scan used inside this beautify step is a string
walking method: a sliding-window walk over the raw characters
(scanText / scanBrokenSpans below) that spots orphan marks, impossible
pairs and stray marks directly in the string. The "scan" of the NEXT
chain is a different phase: it runs the Engine (BindEngine POS) over
finished text and only looks for the tokens the Engine tags unknown -
word{F} - in that tagged output; it never walks the raw string. Same
word "scan", two phases, two different inputs. Keep them separate.
*/
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
