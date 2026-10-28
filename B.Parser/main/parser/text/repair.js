

























import { loadMapJson } from "../core/json-map.js";
import { scanText, scanBrokenSpans } from "./scan.js";
import {
  orderText, unmixZawCodeMarks, retraceZawCodeMarks, settleZawCodeAhE,
  medialFollows, reorderMarks,
} from "./cleanup.js";
import { scoreText, isIndex } from "./mm-score.js";

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





export function repairToken(token, words) {
  if (!words || !words.size || words.has(token)) return null;
  const hits = homoglyphVariants(token).filter((v) => words.has(v));
  return hits.length === 1 ? hits[0] : null;
}





export function repairHomoglyphs(text, words) {
  if (!text || !words || !words.size) return { text, repairs: [] };
  const tally = new Map();
  const out = String(text).replace(MM_RUN, (token) => {
    const fixed = repairToken(token, words);
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
  if (!words || !words.size || words.has(token)) return null;
  const tail = /^(.*?)([\u1040-\u1049]+)$/u.exec(token);
  const head = /^([\u1040-\u1049]+)(.*)$/u.exec(token);
  const tailOk = Boolean(tail && tail[1] && words.has(tail[1]));
  const headOk = Boolean(head && head[2] && words.has(head[2]));
  if (tailOk && headOk) return null;
  if (tailOk) return [tail[1], tail[2]];
  if (headOk) return [head[1], head[2]];
  return null;
}





export function repairText(text, words) {
  const first = repairHomoglyphs(text, words);
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
  const rep = scanText(token, { dictionary: words, standalone, perRule: 1 });
  return MEND_GATE_RULES.reduce((n, k) => n + (rep[k]?.total ?? 0), 0);
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
  const wins = (cand) => (cand && cand !== token && gateHits(cand, words, standalone) < own ? cand : null);
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

export function mendZawCodeText(text, words, standalone = []) {
  if (!text || !words || !words.size) return { text, repairs: [] };
  const spans = scanBrokenSpans(String(text), { dictionary: words, standalone });
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




    const fixed = mendCached(token);
    if (!fixed) continue;
    tallyAdd(token, fixed);
    out = out.slice(0, start) + fixed + out.slice(end);
  }
  out = out.replace(MM_RUN, (token) => {
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






















export function repairFromScanVerdict(pages, report, words, { path = null, standalone = [] } = {}) {
  if (path !== "zawcode" || !report || !words || !words.size) return pages;
  return pages.map((page) => {
    const text = page?.text || "";
    if (!text) return page;
    const mended = mendZawCodeText(text, words, standalone);
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
        mendZawCodeText(String(lineText ?? ""), words, standalone).text,
      ]);
    }
    return { ...page, text: mended.text, ...(lines ? { lines } : {}) };
  });
}
