/*
(Repair 3) Repair branch, position 3 in the chain - text fixing used inside the repair stage (Repair 2).
This module beautifies tokens: it splits glued numbers and fixes homoglyph mistakes using the master word data.
*/


























import { loadMapJson } from "../../@core/runtime/json-map.js";

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



























