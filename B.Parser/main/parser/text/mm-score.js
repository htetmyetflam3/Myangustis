


import { loadMapJson } from "../core/json-map.js";







const DATA = loadMapJson("mm-score.json");

export const MARKS = new Set(DATA.marks.map((c) => c.codePointAt(0)));





export const MARK_ORDER = new Map(Object.entries(DATA.priority));

export function isIndex(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return (cp >= 0x1000 && cp <= 0x1021) || cp === 0x1025 || cp === 0x1027;
}

export function isMark(ch) {
  return !!ch && MARKS.has(ch.codePointAt(0));
}

export function isMyanmar(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  return cp >= 0x1000 && cp <= 0x109f;
}

export function myanmarRatio(text) {
  if (!text) return 0.0;
  const chars = Array.from(text);
  let n = 0;
  for (const ch of chars) if (isMyanmar(ch)) n += 1;
  return n / chars.length;
}


function* walk(text) {
  let attached = false;
  let run = [];
  for (const ch of text) {
    const mark = isMark(ch);
    yield { ch, attached, run };
    if (isIndex(ch)) {
      attached = true;
      run = [];
    } else if (mark) {
      if (attached) run.push(ch);
    } else {
      attached = false;
      run = [];
    }
  }
}

export function orphanMarkRate(text) {
  let total = 0;
  let bad = 0;
  for (const { ch, attached } of walk(text)) {
    if (isMark(ch)) {
      total += 1;
      if (!attached) bad += 1;
    }
  }
  return total ? bad / total : 0.0;
}

export function duplicateMarkRate(text) {
  let total = 0;
  let dup = 0;
  for (const { ch, attached, run } of walk(text)) {
    if (isMark(ch) && attached) {
      total += 1;
      if (run.includes(ch)) dup += 1;
    }
  }
  return total ? dup / total : 0.0;
}

export function orderViolationRate(text) {
  let pairs = 0;
  let bad = 0;
  let run = null;
  for (const ch of text) {
    if (isIndex(ch)) {
      run = [];
      continue;
    }
    if (MARKS.has(ch.codePointAt(0))) {
      if (run !== null) {
        run.push(ch);
        if (run.length > 1) {
          pairs += 1;
          if (MARK_ORDER.get(run[run.length - 2]) > MARK_ORDER.get(run[run.length - 1])) {
            bad += 1;
          }
        }
      }
      continue;
    }
    run = null;
  }
  return pairs ? bad / pairs : 0.0;
}


export function scoreText(text) {
  const chars = Array.from(text);
  let marks = 0;
  for (const ch of chars) if (isMark(ch)) marks += 1;
  if (!marks) {
    return { score: 0.0, orphan: 0.0, disorder: 0.0, duplicate: 0.0, marks: 0, myanmarRatio: myanmarRatio(text) };
  }
  const orphan = orphanMarkRate(text);
  const disorder = orderViolationRate(text);
  return {
    score: 1.0 - Math.max(orphan, disorder),
    orphan,
    disorder,
    duplicate: duplicateMarkRate(text),
    marks,
    myanmarRatio: myanmarRatio(text),
  };
}




























const COMMON_ENGLISH = new Set(("the of and a to in is you that it he was for on are as with his they i at be this "
  + "have from or one had by word but not what all were we when your can said there use an each which she do how "
  + "their if will up other about out many then them these so some her would make like him into time has look two "
  + "more write go see number no way could people my than first water been call who its now find long down day did "
  + "get come made may part update volume volumes three commission ministry education government language union "
  + "myanmar grammar mlc jan feb mar apr jun jul aug sep oct nov dec am pm").split(" "));

const VOWELLESS_OK = new Set(["shh", "hmm", "grr", "brr", "psst", "tsk", "cwm", "nth"]);
const IMPOSSIBLE_PAIRS = new Set([
  "bq", "cq", "gq", "hq", "jq", "kq", "lq", "mq", "pq", "vq", "wq", "xq", "yq", "zq",
  "qg", "qh", "qj", "qk", "ql", "qm", "qo", "qr", "qs", "qv", "qw", "qx", "qy", "qz",
  "jz", "jx", "vx", "xz", "bz", "pz", "vz", "wz", "kx", "cx", "bx", "fx", "gx", "hx",
  "mx", "px", "dx", "qq", "yy",
]);
const isAsciiLetter = (ch) => (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z");

export function englishLikeness(text) {
  const sample = String(text || "");


  const runs = [];
  let cur = "";
  for (const ch of sample) {
    if (isAsciiLetter(ch)) cur += ch;
    else if (cur) { runs.push(cur); cur = ""; }
  }
  if (cur) runs.push(cur);
  const letters = runs.reduce((n, w) => n + w.length, 0);
  if (!runs.length) return { verdict: null, letters: 0, runs: 0, commonRatio: 0, violationRate: 0, maxRun: 0, hasSpaces: false };

  const maxRun = Math.max(...runs.map((w) => w.length));
  const hasSpaces = runs.length > 1 && /[ ]/.test(sample);
  const wordRuns = runs.filter((w) => w.length >= 2).map((w) => w.toLowerCase());
  const common = wordRuns.filter((w) => COMMON_ENGLISH.has(w)).length;
  const commonRatio = wordRuns.length ? common / wordRuns.length : 0;

  let violations = 0;
  for (const w of runs) {
    const lower = w.toLowerCase();
    const acronym = w.length <= 6 && w === w.toUpperCase();
    if (!acronym && lower.length >= 3 && !VOWELLESS_OK.has(lower) && !/[aeiouy]/.test(lower)) violations += 1;
    if (/(.)\1\1\1/.test(lower)) violations += 2;
    for (let i = 0; i + 1 < lower.length; i += 1) {
      if (IMPOSSIBLE_PAIRS.has(lower.slice(i, i + 2))) violations += 1;
      if (lower[i] === "q" && lower[i + 1] !== "u") violations += 1;
    }
    if (lower.length > 16) violations += 1;
    if (lower.length > 20) violations += 1;
    if (lower.length > 45) violations += 2;
  }
  const violationRate = letters ? violations / letters : 1;

  let verdict = null;
  if (letters >= 12) {
    if (commonRatio >= 0.15 && violationRate <= 0.02 && maxRun <= 20) verdict = "english";
    else if (commonRatio >= 0.08 && hasSpaces && violationRate <= 0.01 && maxRun <= 16) verdict = "english";
    else if (violationRate > 0.03 && commonRatio < 0.05) verdict = "not-english";
    else if (!hasSpaces && maxRun > 20 && commonRatio < 0.05) verdict = "not-english";
    else if (commonRatio > 0 && commonRatio < 0.05 && violationRate > 0.015) verdict = "not-english";
    else if (commonRatio === 0 && letters >= 24 && runs.length >= 4) verdict = "not-english";
  }
  return { verdict, letters, runs: runs.length, commonRatio, violationRate, maxRun, hasSpaces };
}
