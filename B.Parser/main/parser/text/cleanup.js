

































import { loadMapJson } from "../core/json-map.js";
import { MARK_ORDER as PRIORITY, isIndex } from "./mm-score.js";

const DATA = loadMapJson("cleanup.json");






const GLUE = new Set(DATA.glue);






const IMPOSTER_REPS = DATA.reps;

const REPLACEMENT = Symbol("replacement");

function buildImposterTrie(reps) {
  const trie = new Map();
  for (const [from, to] of reps) {
    let node = trie;
    for (const ch of from) {
      if (!node.has(ch)) node.set(ch, new Map());
      node = node.get(ch);
    }
    node.set(REPLACEMENT, to);
  }
  return trie;
}

const IMPOSTER_TRIE = buildImposterTrie(IMPOSTER_REPS);








const SINGLE_CHAR_ONLY = IMPOSTER_REPS.every(([from]) => Array.from(from).length === 1);
const IMPOSTER_TABLE = SINGLE_CHAR_ONLY ? new Map(IMPOSTER_REPS) : null;









export function cleanImposters(t) {
  if (!t) return t;

  if (IMPOSTER_TABLE !== null) {
    let out = "";
    for (const ch of t) out += IMPOSTER_TABLE.get(ch) ?? ch;
    return out;
  }

  const chars = Array.from(t);
  const n = chars.length;
  const out = [];
  let i = 0;
  while (i < n) {
    let node = IMPOSTER_TRIE;
    let j = i;
    let lastMatch = -1;
    let replacement = null;
    while (j < n && node.has(chars[j])) {
      node = node.get(chars[j]);
      j += 1;
      if (node.has(REPLACEMENT)) {
        lastMatch = j;
        replacement = node.get(REPLACEMENT);
      }
    }
    if (replacement !== null) {
      out.push(replacement);
      i = lastMatch;
    } else {
      out.push(chars[i]);
      i += 1;
    }
  }
  return out.join("");
}


















const PREBASE_MARKS = new Set(["\u1031", "\u103C"]);


const MEDIALS = new Set(["\u103B", "\u103C", "\u103D", "\u103E"]);
















const MEDIAL_HOSTS = {
  "\u103B": "\u1000\u1001\u1002\u1003\u1004\u1005\u1007\u100A\u100B\u100E\u100F\u1010\u1011\u1012\u1013\u1014\u1015\u1016\u1017\u1018\u1019\u101A\u101C\u101D\u101E\u101F",
  "\u103C": "\u1000\u1001\u1002\u1004\u1005\u100A\u1010\u1011\u1012\u1014\u1015\u1016\u1017\u1019\u101A",
  "\u103D": "\u1000\u1001\u1002\u1004\u1005\u1006\u1007\u100A\u100F\u1010\u1011\u1012\u1013\u1014\u1015\u1016\u1017\u1018\u1019\u101A\u101B\u101C\u101D\u101E\u101F",
  "\u103E": "\u1004\u1009\u100A\u100F\u1014\u1019\u101A\u101B\u101C\u101D\u1020",
};







export function medialFollows(medial, consonant) {
  const hosts = MEDIAL_HOSTS[medial];
  return hosts !== undefined && hosts.includes(consonant);
}




























let INVENTORY = null;
function inventory() {
  if (INVENTORY === null) {
    try {
      const d = loadMapJson("burmese-inventory.json");
      INVENTORY = new Set(d.syllables || []);
    } catch {
      INVENTORY = new Set();
    }
  }
  return INVENTORY;
}




function candidateIsReal(chars, j) {
  const inv = inventory();
  if (inv.size === 0) return true;
  const parts = [chars[j], "\u1031"];
  let seenConsonant = false;
  for (let k = j + 1; k < chars.length; k += 1) {
    const ch = chars[k];
    if (ch === " " || ch === "\n") break;
    if (isIndex(ch)) {
      if (seenConsonant) break;
      seenConsonant = true;
    }
    parts.push(ch);
  }
  return inv.has(reorderMarks(parts.join("")));
}

function opensCluster(chars, i) {
  let j = i;
  while (j < chars.length && PREBASE_MARKS.has(chars[j])) j += 1;
  if (j >= chars.length || !isIndex(chars[j])) return false;

  const prev = i > 0 ? chars[i - 1] : undefined;
  if (prev === undefined) return true;












  if (isIndex(prev) && MEDIALS.has(chars[i]) && !medialFollows(chars[i], prev)) return true;












  if (isIndex(prev) && chars[i] === "\u1031") {






















    if (!candidateIsReal(chars, j)) return false;
    const rank = PRIORITY.get(prev);
    return rank === undefined ? true : PRIORITY.get(chars[i]) < rank;
  }
  if (isIndex(prev)) return false;

















  const rank = PRIORITY.get(prev);
  if (rank === undefined) return true;


  return PRIORITY.get(chars[i]) < rank;
}


export function movePrebaseMarks(t) {
  if (!t || typeof t !== "string") return "";
  const chars = Array.from(t);
  const out = [];
  let i = 0;
  const n = chars.length;
  while (i < n) {
    const ch = chars[i];





    if (PREBASE_MARKS.has(ch) && opensCluster(chars, i)) {
      const marks = [];
      while (i < n && PREBASE_MARKS.has(chars[i])) {
        marks.push(chars[i]);
        i += 1;
      }
      out.push(chars[i]);
      i += 1;


      out.push(...marks);
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}


export function reorderMarks(t) {
  if (!t || typeof t !== "string") return "";

  const chars = Array.from(t);
  const out = [];
  let i = 0;
  const n = chars.length;




  while (i < n) {
    const ch = chars[i];
    if (isIndex(ch)) {
      out.push(ch);
      i += 1;







      const marks = [];
      const seenPriorities = new Set();
      while (i < n) {
        const nxt = chars[i];
        if (isIndex(nxt)) break;
        const p = PRIORITY.get(nxt);
        if (p === undefined) break;
        if (!seenPriorities.has(p)) {
          seenPriorities.add(p);
          marks.push(nxt);
        }
        i += 1;
      }

      if (marks.length) {
        marks.sort((a, b) => PRIORITY.get(a) - PRIORITY.get(b));
        out.push(...marks);
      }
    } else {
      out.push(ch);
      i += 1;
    }
  }

  return out.join("");
}








































const ZAWCODE_PREBASE = new Set(["\u1031", "\u103B", "\u103C", "\u103D", "\u103E"]);

export function unmixZawCodeMarks(t) {
  if (!t || typeof t !== "string") return "";

  const chars = Array.from(t);
  const out = [];
  let carry = [];
  let i = 0;
  const n = chars.length;

  while (i < n) {
    const ch = chars[i];
    if (isIndex(ch)) {
      const base = ch;
      let marks = [...carry];
      carry = [];
      const seenPriorities = new Set(marks.map((m) => PRIORITY.get(m)));
      let pointer = marks.reduce((mx, m) => Math.max(mx, PRIORITY.get(m) ?? 0), 0);
      i += 1;



      let raBehindBase = false;
      while (i < n) {
        const nxt = chars[i];
        if (isIndex(nxt)) break;
        const p = PRIORITY.get(nxt);
        if (p === undefined) break;

        if ((nxt === "\u1031" || nxt === "\u103C") && p < pointer) {
          while (i < n && ZAWCODE_PREBASE.has(chars[i])) {
            carry.push(chars[i]);
            i += 1;
          }
          break;
        }

        if (nxt === "\u103C") raBehindBase = true;
        if (!seenPriorities.has(p)) {
          seenPriorities.add(p);
          marks.push(nxt);
        }
        if (p > pointer) pointer = p;
        i += 1;
      }

      if (raBehindBase && i < n && isIndex(chars[i]) && marks.includes("\u1031")) {
        carry = marks.filter((m) => MEDIALS.has(m));
        marks = marks.filter((m) => !MEDIALS.has(m));
      }

      marks.sort((a, b) => PRIORITY.get(a) - PRIORITY.get(b));
      out.push(base, ...marks);
    } else if (ZAWCODE_PREBASE.has(ch) && (() => {
      let k = i;
      while (k < n && ZAWCODE_PREBASE.has(chars[k])) k += 1;
      return k < n && isIndex(chars[k]);
    })()) {
      carry.push(ch);
      i += 1;
    } else {
      out.push(...carry);
      carry = [];
      out.push(ch);
      i += 1;
    }
  }

  out.push(...carry);
  return out.join("");
}
























































const TRACE_U = "\u102F";
const TRACE_I = "\u102D";
const TRACE_ANUSVARA = "\u1036";
const TRACE_E = "\u1031";
const TRACE_RA = "\u103C";
const TRACE_ASAT = "\u103A";
const TRACE_AI = "\u1032";
const TRACE_DOT = "\u1037";
const TRACE_WA = "\u103D";
const TRACE_CARRIER = "\u1021";

export function retraceZawCodeMarks(t) {
  if (!t || typeof t !== "string") return "";

  let s = t.split(TRACE_I + TRACE_U + TRACE_ANUSVARA).join(TRACE_U + TRACE_ANUSVARA);
  s = s.split(TRACE_WA + TRACE_I + TRACE_AI + TRACE_DOT).join(TRACE_I + TRACE_DOT);





  let chars = Array.from(s);
  const paired = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === TRACE_E && i + 2 < chars.length
      && isIndex(chars[i + 1]) && chars[i + 2] === TRACE_RA) {
      paired.push(chars[i + 1]);
      let j = i + 2;
      while (j < chars.length && MEDIALS.has(chars[j])) {
        paired.push(chars[j]);
        j += 1;
      }
      paired.push(TRACE_E);
      i = j - 1;
      continue;
    }
    paired.push(chars[i]);
  }




  chars = paired;
  const carried = [];
  for (let i = 0; i < chars.length; i += 1) {
    const standin = chars[i];
    const host = chars[i + 1];
    const isStandin = standin === "\u1004" || standin === "\u1006" || standin === "\u1000";
    if (isStandin && host !== undefined && isIndex(host)
      && medialFollows(TRACE_RA, host)
      && (standin !== "\u1000" || host === "\u1000")
      && (standin !== "\u1006" || host === "\u1000")
      && chars[i + 2] !== TRACE_RA
      && chars[i + 2] !== TRACE_ASAT) {
      carried.push(host, TRACE_RA);
      i += 1;
      continue;
    }
    carried.push(standin);
  }

  return reorderMarks(carried.join(""));
}

















export function settleZawCodeAhE(t) {
  if (!t || typeof t !== "string") return "";
  const chars = Array.from(t);
  const out = [];
  for (let i = 0; i < chars.length; i += 1) {
    if (chars[i] === TRACE_E && out.length && out[out.length - 1] === TRACE_CARRIER
      && i + 1 < chars.length && isIndex(chars[i + 1])) {
      out.push(chars[i + 1]);
      let j = i + 2;
      while (j < chars.length && MEDIALS.has(chars[j])) {
        out.push(chars[j]);
        j += 1;
      }
      out.push(TRACE_E);
      i = j - 1;
      continue;
    }
    out.push(chars[i]);
  }
  return reorderMarks(out.join(""));
}














export function normalizeText(t) {
  if (!t || typeof t !== "string") return "";
  let out = "";
  for (const ch of t.normalize("NFC")) {
    if (!GLUE.has(ch)) out += ch;
  }
  return out;
}














export function orderText(t) {
  return dropImpossibleMarks(reorderMarks(movePrebaseMarks(normalizeText(t))));
}








export function cleanupText(t) {
  return dropImpossibleMarks(reorderMarks(cleanImposters(normalizeText(t))));
}


























const AFTER_E_IMPOSSIBLE = new Set([
  "\u102D",
  "\u102F",
  "\u1030",
  "\u1036",
]);

export function dropImpossibleMarks(t) {
  if (!t || typeof t !== "string") return "";
  const chars = Array.from(t);
  const out = [];
  for (let i = 0; i < chars.length; i += 1) {
    const ch = chars[i];
    out.push(ch);
    if (ch !== "\u1031") continue;
    let j = i + 1;
    while (j < chars.length && AFTER_E_IMPOSSIBLE.has(chars[j])) j += 1;
    i = j - 1;
  }
  return out.join("");
}
