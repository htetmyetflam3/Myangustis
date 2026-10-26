/**
 * FILE: Parsed/parser/text/repair.mjs
 *
 * Dictionary-arbitrated repair of homoglyph confusions.
 *
 * Several Myanmar code points share a single glyph in legacy faces -- ဝ/၀,
 * ရ/၇, ဉ/ဥ. A legacy code page has to resolve each shared glyph to one side,
 * and when it picks the wrong one the text is left with a character that
 * looks right and reads wrong. `scan.mjs`'s `digit` rule reports one case of
 * this (a digit flanked by letters) but it is one-directional: a LETTER
 * standing where a digit belongs is invisible to it, and ဉ/ဥ is outside it
 * entirely.
 *
 * Repairing by rule is unsafe -- ၀ is often a genuine digit and ဝ a genuine
 * letter -- so the dictionary arbitrates instead:
 *
 *   1. the token must NOT already be a word
 *   2. exactly ONE homoglyph-swapped variant must BE a word
 *   3. if two or more variants resolve, change nothing
 *
 * Under those conditions a repair cannot invent a word that was not already
 * in the dictionary, and cannot choose between competing readings.
 *
 * Measured over mm-grammar.pdf (445 pages, 3952 unknown tokens): 67 repaired,
 * 0 ambiguous. The dictionary never returned two candidates.
 */
import fs from "node:fs";
import path from "node:path";
import { MAP_DIR } from "../core/paths.mjs";
import { scanText, scanBrokenSpans } from "./scan.mjs";
import {
  orderText, unmixZawCodeMarks, retraceZawCodeMarks, settleZawCodeAhE,
  medialFollows, reorderMarks,
} from "./cleanup.mjs";
import { scoreText, isIndex } from "./mm-score.mjs";

const DATA = JSON.parse(fs.readFileSync(path.join(MAP_DIR, "homoglyphs.json"), "utf8"));

/** [a, b] pairs, usable in either direction. */
export const HOMOGLYPH_PAIRS = DATA.pairs.map(([a, b]) => [a, b]);

/** Every single-character swap, both directions, as [from, to]. */
const SWAPS = HOMOGLYPH_PAIRS.flatMap(([a, b]) => [[a, b], [b, a]]);

/** Tokens are Myanmar letters, marks and digits -- the same run scan.mjs uses. */
const MM_RUN = /[\u1000-\u1049\u105a-\u109f]+/gu;

/**
 * Every distinct token reachable by homoglyph swaps: all occurrences of a
 * character replaced together, and each occurrence replaced on its own.
 */
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

/**
 * The single dictionary-resolving variant of `token`, or null when the token
 * is already a word, nothing resolves, or more than one does.
 */
export function repairToken(token, words) {
  if (!words || !words.size || words.has(token)) return null;
  const hits = homoglyphVariants(token).filter((v) => words.has(v));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Repair homoglyph confusions across a whole text.
 * Returns { text, repairs } where repairs is [{ from, to, count }].
 */
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

/**
 * Split a number that extraction glued onto a word.
 *
 * Table-of-contents and index lines lose their dot leaders during
 * extraction, so the page number joins the heading and the whole token
 * misses the dictionary -- သဒ္ဒါ၁, ဝဂ်၃၈, မျိုး၁၀၅, and in numbered lists the
 * marker leads instead: ၁။သဒ္ဒါ.
 *
 * The dictionary arbitrates exactly as it does for homoglyphs: a split is
 * applied only when the token is not already a word and stripping the digit
 * run from ONE end leaves a word. If both ends would work the token is left
 * alone. Over mm-grammar.pdf that is 108 trailing and 330 leading splits
 * with zero ambiguous cases.
 *
 * Returns [word, digits] in reading order, or null.
 */
export function splitGluedNumber(token, words) {
  if (!words || !words.size || words.has(token)) return null;
  const tail = /^(.*?)([\u1040-\u1049]+)$/u.exec(token);
  const head = /^([\u1040-\u1049]+)(.*)$/u.exec(token);
  const tailOk = Boolean(tail && tail[1] && words.has(tail[1]));
  const headOk = Boolean(head && head[2] && words.has(head[2]));
  if (tailOk && headOk) return null;        // ambiguous, change nothing
  if (tailOk) return [tail[1], tail[2]];
  if (headOk) return [head[1], head[2]];
  return null;
}

/**
 * Apply both repairs across a text: homoglyph swaps first, then glued
 * numbers. Returns { text, repairs, splits }.
 */
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

/*
 * ZawCode mend, applied ONLY where the scanner points.
 *
 * The pure candidates (cleanup.mjs's unmixZawCodeMarks and
 * retraceZawCodeMarks, and the arbitrated variant sets below) are
 * destructive on finished Unicode — မြေတော် would lose its ြ to တ, and
 * အဆကို would retrace to အကြို. What separates the damaged နြေပီ from
 * the healthy မြေတော် is the scan verdict itself: နြေပီ flags (နြေ
 * covers no dictionary segment), မြေတော် / ကြေနပ် / ကြေးဇူး come back
 * clean. So no candidate goes looking for work: scanBrokenSpans hands
 * over the exact token coordinates the scan flagged, a rewrite is kept
 * only when it re-scans strictly cleaner than the span it replaces, and
 * the splice runs back-to-front so earlier coordinates stay valid. The
 * one exception is the fenced frames at the end — three shapes the scan
 * provably cannot flag, verified at the glyph level and rewritten only
 * at a token's edge. Everything else the scan did not flag is
 * byte-identical going out.
 *
 * This is the "repair driven by what the scan found" the slot below asks
 * for, kept as its own named rule and NOT folded into the generic
 * repairText: the worker reaches it only on the separated `zawcode`
 * path, behind that path's scan verdict.
 *
 * Returns { text, repairs } where repairs is [{ from, to, count }], the
 * same shape as repairHomoglyphs.
 */
const MEND_GATE_RULES = ["orphan", "impossible", "stray", "virama", "unknown"];

function gateHits(token, words, standalone) {
  const rep = scanText(token, { dictionary: words, standalone, perRule: 1 });
  return MEND_GATE_RULES.reduce((n, k) => n + (rep[k]?.total ?? 0), 0);
}

/**
 * The readable-result guard that splits ZawCode-stored Unicode out of the
 * Unicode/cmap reading. It judges text, never a font name: the same raw
 * cmap sample is read two ways — as finished Unicode (`orderText`) and
 * through the ZawCode stored-order rule first
 * (`orderText(unmixZawCodeMarks(...))`). The structural score alone cannot
 * separate them on the real ယဲ့နင် source (both readings 0.999 over
 * the probe pages); the dictionary scan gate can (pipeline guard sample
 * 116 -> 110; on the finished page text 70 -> 60), while applying the
 * same crossed reading to the finished mm-grammar / bg-mlc-1-1 texts
 * moves their gates the other way (219 -> 272, 532 -> 558).
 * Zawgyi-cmap readings never reach the split: sample/test score
 * 0.878/0.881 as ordered Unicode, far under the 0.99 floor.
 */
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

/*
 * The remaining candidates cover what the pure rules cannot write down:
 * glyphs that left NO character behind (their /ToUnicode is the space
 * filler, so the decoder drew nothing), and the plain-ို half of the
 * lying ligature. Traced on the ယဲ့နင် source:
 *
 *   MyanmarText gid 429  ြ dropped   ကြောင့် -> ကောင့်, ကြသည် -> ကသည်
 *   MyanmarText gid 510  ူ dropped   သူတို့ -> သတို့, လူ -> လ
 *   MyanmarText gid 511  ု dropped   ကျိုး -> ကျိး, ပြု -> ပြ
 *   MyanmarText gid 705  ှ dropped   မြှား -> မြား, ညှိုး -> ညိုး
 *   MyanmarText gid 516  ွှ dropped  လွှား -> လား
 *   stacked seconds (္စ ္တ ္ဒ …) named without their ္: ကိစ္စ -> ကိစစ
 *   MyanmarText gid 509  ု read as ို: ရုတ်တရက် -> ရိုတ်တရက်, ခု -> ခို
 *
 * A dropped character has no position to rewrite, so these candidates
 * INSERT one character at every legal site (or, for gid 509, drop the
 * spurious ိ at one ို at a time) and the dictionary arbitrates exactly
 * as it does for homoglyphs: the mend applies only when exactly ONE
 * variant re-scans strictly cleaner. Host sets are the attested ones,
 * not the full inventory — the ှ and ွှ drops occur behind a handful of
 * consonants in the subsets that drop them, and an insertion offered
 * everywhere it is legal invents words (လျိုချင်း -> လျှိုချင်း).
 */
const MEND_MEDIALS = new Set(["\u103B", "\u103C", "\u103D", "\u103E"]); // ျ ြ ွ ှ
const MEND_VOWEL_MARKS = new Set([
  "\u102B", "\u102C", "\u102D", "\u102E", "\u102F", "\u1030", "\u1031",
  "\u1032", "\u1033", "\u1034", "\u1035",
]);
const MEND_HA_HOSTS = new Set(["\u1019", "\u100A", "\u101B"]); // မ ည, and ရ for ရှိ -> ရိ
const MEND_WA_HA_HOSTS = new Set(["\u101C", "\u101B", "\u100A", "\u1014", "\u1019"]); // လ ရ ည န မ
const MEND_STACK_SECONDS = new Set([
  "\u1001", "\u1005", "\u1006", "\u1010", "\u1012", "\u1013", "\u1015",
  "\u1018", "\u1019",
]); // ခ စ ဆ တ ဒ ဓ ပ ဘ မ

/* Cluster spans over a char array: a base plus the marks behind it,
   stopping where a virama stacks the next base (that base is its own
   insertion site). */
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

/** Every token one dropped character away from `token`. */
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
    const closed = marks.includes("\u103A"); // ်: a final takes no vowel
    const vowelFree = !marks.some((m) => MEND_VOWEL_MARKS.has(m));
    if (medialFollows("\u103C", base) && !marks.includes("\u103C")) add(cl.start + 1, "\u103C"); // ြ
    if (MEND_HA_HOSTS.has(base) && !marks.includes("\u103E")) add(cl.start + 1, "\u103E"); // ှ
    if (MEND_WA_HA_HOSTS.has(base) && !marks.includes("\u103D") && !marks.includes("\u103E")) {
      add(cl.start + 1, "\u103D\u103E"); // ွှ
    }
    // ူ: never behind a base whose own ေ stands in front of it — that is
    // the lion's shape (ခြေ|သ့, from ခြင်္သေ့ with the င်္ conjunct
    // dropped), and inserting there manufactures a pronoun.
    if (vowelFree && !closed && chars[cl.start - 1] !== "\u1031") add(medialEnd, "\u1030");
    const uFree = !marks.some((m) => [
      "\u102B", "\u102C", "\u102E", "\u102F", "\u1030", "\u1031", "\u1032",
    ].includes(m));
    if (uFree && !closed) {
      let pos = medialEnd;
      if (chars[pos] === "\u102D") pos += 1; // behind a real ိ: ကျိး -> ကျိုး
      add(pos, "\u102F"); // ု
    }
  }
  for (let i = 0; i + 1 < chars.length; i += 1) {
    if (isIndex(chars[i]) && isIndex(chars[i + 1]) && MEND_STACK_SECONDS.has(chars[i + 1])) {
      add(i + 1, "\u1039"); // the stacked second's lost virama
    }
  }
  variants.delete(token);
  return [...variants];
}

/** Every token with one ို read back as the plain ု gid 509 draws. */
export function zawCodeSpuriousIVariants(token) {
  const out = new Set();
  let idx = -1;
  while ((idx = token.indexOf("\u102D\u102F", idx + 1)) >= 0) {
    out.add(token.slice(0, idx) + "\u102F" + token.slice(idx + 2));
  }
  out.delete(token);
  return [...out];
}

/*
 * One flagged token through the candidate ladder. The pure rules go
 * first (unmix, then the glyph traceback, then each composition), the
 * arbitrated variant sets after them, and the အ-stranded ေ last. First
 * candidate whose rescan is strictly cleaner than the token's own wins;
 * the variant sets additionally demand a UNIQUE winner, the homoglyph
 * contract — two insertions that both clean up are two readings, and
 * the mend does not choose between readings.
 */
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

/*
 * The frames: three damage shapes the scanner cannot flag at all,
 * because the damaged token still segments into real words — သတို့ is
 * သ + တို့ to the dictionary, အေရး is အေ + ရး, and သ့ is itself a word.
 * These are the proofreader's words, verified glyph by glyph above
 * (gid 510's dropped ူ; the အ-stranded ေ), and fenced to match:
 *
 *   token-initial position only — where the proofreader's hits are, and
 *     where the lion (ခြေသ့, mid-token behind ခြေ) can never stand;
 *   the token must not itself be a dictionary word — which is also what
 *     protects ကသည်, a real word wearing ကြသည်'s damage;
 *   the rewritten token must rescan fully clean.
 *
 * Mid-token damage of the same origin that also scans clean
 * (ကျင်ငကံသူ as ကျင် + င + ကံ + သူ) is deliberately NOT chased here: with
 * both readings segmenting, no fence separates damage from text.
 */
function zawCodeFrameFix(token, words, standalone) {
  const candidates = [];
  if (token.startsWith("\u101e\u1010\u102d\u102f\u1037")) { // သတို့
    candidates.push("\u101e\u1030" + token.slice(1));
  } else if (token.startsWith("\u101e\u1037") && token.length > 2) { // သ့…
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
  // The same damaged token recurs down a page; its verdict cannot change.
  const cache = new Map();
  const mendCached = (token) => {
    if (!cache.has(token)) cache.set(token, mendZawCodeToken(token, words, standalone));
    return cache.get(token);
  };
  for (let s = spans.length - 1; s >= 0; s -= 1) {
    const { start, end, token } = spans[s];
    // A flagged token can hold healthy clusters beside the damaged one
    // (ဖြေးညှင်းစွာ: ဖြေး is finished, only the covering fails). The pure
    // rules cannot tell them apart, the scanner can: a rewrite is kept
    // only when it re-scans strictly cleaner than what it replaces.
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

/**
 * The slot behind the scan verdict.
 *
 * Order in the worker (worker/runtime.mjs): dictionary repairs -> scanText
 * verdict on the wininnwa / ayar / vector / zawcode paths -> THIS rule ->
 * write. A repair driven by what the scan found belongs here and nowhere
 * else, so the scan never grows a second, hidden repair hand inside
 * itself.
 *
 * One rule fills the slot today: on the separated `zawcode` path, the
 * scan-coordinate mend above — stored-order unmixing, the glyph
 * traceback for the subsets whose /ToUnicode lies (which the outline
 * repair cannot reach: those glyphs decode to something plausible, so
 * it is never consulted), and its fenced frames for the shapes that
 * segment too well to flag. Pure Unicode needs no such rule — a correct
 * reading scans clean — and the other verdict paths keep the pass-through:
 * their repairs are the code-page/shape traceback upstream, not a
 * behind-scan rewrite. Page text and layout lines are mended with the
 * same accepted token replacements, so the TXT and DOCX writers cannot
 * disagree about what was repaired.
 */
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
    // Page text and layout lines are assembled separately (and the
    // earlier dictionary repairs touch text only), so a repaired page
    // token can fail to appear verbatim in any line. On those pages the
    // lines get their own scan-coordinate mend rather than silently
    // keeping the damage for the layout writer.
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
