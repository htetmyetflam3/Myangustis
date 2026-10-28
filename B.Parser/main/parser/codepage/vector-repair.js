





































import fs from "node:fs";
import path from "node:path";

import { loadMapJson, mapNameForPath } from "../core/json-map.js";
import { VECTOR_MAP_DIR } from "../../../_path.js";

import { TtfFont, glyphContours } from "../read/glyf.js";
import { glyphSignature } from "../shape/contour.js";
import { parseTtfCmap } from "../core/ttf-cmap.js";
import {
  pickEmbeddedFont, hasMyanmarGlyphs, parsePdfObjects, getStream,
  parseToUnicodeStream, extractPageLines, findRootPages, collectPages,
} from "../read/pdf-extract.js";
import {
  FontResourceLoader, DocumentDecoding, pageFontDecoders, PdfRef,
  detectLegacyLayoutFonts,
} from "../read/pdf-fonts.js";
import { englishLikeness } from "../text/mm-score.js";
import { crowdVote, loadWitnesses } from "./outline-vote.js";
import { WININNWA_LEGACY_CODE_PAGE } from "./registry.js";
import { emitEvent } from "../../../../Bridge/logen/core.js";

const WITNESS_FILE = path.join(VECTOR_MAP_DIR, "font-witnesses.json");


const MEDIALS = "\u103C\u103B\u103D\u103E";

const VIRAMA = "\u1039";

const CONSONANT = /[\u1000-\u1021]/;

let witnessCache = null;






export function witnessesFor(file = WITNESS_FILE) {
  if (!witnessCache) {
    witnessCache = loadWitnesses(file, {
      readFile: (p) => fs.readFileSync(p),
      readJson: (p) => {
        const name = mapNameForPath(p);
        return name ? loadMapJson(name) : JSON.parse(fs.readFileSync(p, "utf8"));
      },
    });
  }
  return witnessCache;
}

















export function reorderPreBase(text) {
  if (!text) return text;
  const chars = [...text];
  let out = "";
  let i = 0;
  while (i < chars.length) {
    const c = chars[i];
    if (MEDIALS.includes(c)) {
      if (chars[i + 1] === VIRAMA && CONSONANT.test(chars[i + 2] || "")) {
        out += chars[i + 2] + c;
        i += 3;
        continue;
      }
      if (CONSONANT.test(chars[i + 1] || "")) {
        out += chars[i + 1] + c;
        i += 2;
        continue;
      }
    }
    out += c;
    i += 1;
  }
  return out;
}


function signatureFor(font, gid, samples) {
  let raw;
  try {
    raw = glyphContours(font, gid);
  } catch {
    return null;
  }
  if (!raw || !raw.length) return null;
  const upm = font.unitsPerEm || 1000;
  return glyphSignature(
    raw.map((c) => c.map((p) => [p.x / upm, p.y / upm])),
    { samples },
  );
}









export function voteGlyph(fonts, gid, witnesses, { claimLimit = 0.06 } = {}) {
  const samples = witnesses[0]?.byByte.values().next().value?.points?.[0]?.length ?? 8;
  let winner = null;
  for (const entry of fonts) {
    const observed = signatureFor(entry.font, gid, samples);
    if (!observed) continue;
    const result = crowdVote(observed, witnesses, { claimLimit });
    if (!result || result.byte === null) continue;
    const text = WININNWA_LEGACY_CODE_PAGE.get(result.byte);
    if (!text) continue;
    if (!winner || result.best < winner.distance) {
      winner = {
        text: reorderPreBase(text),
        raw: text,
        byte: result.byte,
        distance: result.best,
        agreement: result.agreement ?? 0,
        font: entry.name,
      };
    }
  }
  return winner;
}












export function buildVectorRepair(source, blind, { log = () => {}, witnesses = null } = {}) {
  const ids = [...new Set([...blind].map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return null;

  const corpus = witnesses || witnessesFor();
  if (!corpus.length) {
    log("[!] vector repair: no witness corpus loaded");
    return null;
  }


















  let primary = source.primary;
  if (primary === undefined || primary === null) {
    try {
      const [, bytes] = pickEmbeddedFont(source.objects, source.fontRefs || []);
      if (bytes && bytes.length) primary = new TtfFont(bytes).unitsPerEm;
    } catch { /* fall through: no primary means no family filter */ }
  }
  const sameFamily = (upm, hasMyanmar) =>
    upm !== undefined && hasMyanmar
    && (primary === null || primary === undefined || upm === primary);

  const fonts = [];
  for (const ref of source.fontRefs || []) {
    let bytes;
    try {
      bytes = source.getStream(source.objects, ref[0], ref[1]);
    } catch {
      continue;
    }
    if (!bytes || !bytes.length) continue;
    try {
      const font = new TtfFont(bytes);
      if (!sameFamily(font.unitsPerEm, hasMyanmarGlyphs(parseTtfCmap(bytes)))) continue;
      fonts.push({ font, name: `${ref[0]},${ref[1]}` });
    } catch {
      /* Not a TTF we can read (a CFF, say); skip it. */
    }
  }
  if (!fonts.length) {
    log("[!] vector repair: no embedded font program could be read");
    return null;
  }

  const byGid = new Map();
  const stats = { asked: ids.length, recovered: 0, fonts: fonts.length };
  for (const gid of ids) {
    const hit = voteGlyph(fonts, gid, corpus);
    if (!hit) {
      log(`    vector repair: gid ${gid} -- no witness claimed it`);
      continue;
    }
    byGid.set(gid, hit.text);
    stats.recovered += 1;
    log(`    vector repair: gid ${gid} -> ${JSON.stringify(hit.text)}`
      + ` (byte ${hit.byte}, d=${hit.distance.toFixed(4)}, `
      + `agreement ${(hit.agreement * 100).toFixed(0)}%)`);
  }

  if (!byGid.size) return null;
  return { byGid, stats, details: byGid };
}









































function isMyanmarOutput(text) {
  return Boolean(text) && [...text].some((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0x1000 && cp <= 0x109f;
  });
}





function normalizedFaceName(baseFont) {
  return String(baseFont || "")
    .replace(/^[A-Z]{6}\+/u, "")
    .replace(/[^A-Za-z0-9]+/gu, "")
    .toLowerCase();
}










export function buildVectorOutlineLayout(source, layouts, {
  probePages = 6,
  minDecisions = 4,
  objects = null,
  legacyFonts = null,
  log = () => {},
  witnesses = null,
} = {}) {




  const L = {
    layouts: 0, codes: 0, disputed: 0, faces: 0, glyphsVoted: 0,
    glyphsClaimed: 0, decisions: 0, winnerVotes: 0, outcome: "built",
  };
  const done = (outcome, extra = {}) => {
    emitEvent("vote", { ...L, ...extra, outcome });
    return null;
  };

  const layoutEntries = [...layouts];
  L.layouts = layoutEntries.length;
  if (layoutEntries.length < 2) return done("too-few-layouts");
  const disputed = new Set();
  const allCodes = new Set(layoutEntries.flatMap(([, table]) => [...table.keys()]));
  L.codes = allCodes.size;
  for (const code of allCodes) {
    const values = [...new Set(layoutEntries.map(([, table]) => table.get(code)).filter(isMyanmarOutput))];
    if (values.length > 1) disputed.add(code);
  }
  L.disputed = disputed.size;

  if (!disputed.size) return done("no-dispute");

  const objs = objects || parsePdfObjects(
    Buffer.isBuffer(source) ? source : Buffer.from(source));
  const refs = legacyFonts
    || detectLegacyLayoutFonts(objs, getStream, parseToUnicodeStream);
  if (!refs.length) return done("no-legacy-fonts");

  const corpus = witnesses || witnessesFor();
  if (!corpus.length) {
    log("[!] Vector auto-layout: no witness corpus loaded");
    return done("no-witnesses");
  }
  const samples = corpus[0]?.byByte.values().next().value?.points?.[0]?.length ?? 8;

  const loader = new FontResourceLoader(objs, getStream, parseTtfCmap, parseToUnicodeStream);













  const englishFaces = new Set();








  const probeChars = new Map();
  {
    const pagesObj = findRootPages(objs);
    const allPages = pagesObj ? collectPages(objs, pagesObj) : [];
    if (allPages.length) {
      const doc = new DocumentDecoding("tounicode");
      doc.loader = loader;
      const textByFace = new Map();
      const wrapped = new WeakSet();
      const wrap = (decoder) => {
        if (!decoder || wrapped.has(decoder) || !decoder.baseFont) return;
        wrapped.add(decoder);
        const original = decoder.decode.bind(decoder);
        decoder.decode = (data) => {
          const out = original(data);
          if (out) {
            textByFace.set(decoder.baseFont,
              (textByFace.get(decoder.baseFont) || "") + out);
          }
          return out;
        };
      };
      for (const [pnum, pgen] of allPages.slice(0, probePages)) {
        try {
          for (const decoder of pageFontDecoders(loader, pnum, pgen, doc).values()) wrap(decoder);
          extractPageLines(objs, pnum, pgen, doc);
        } catch { /* a probe page that will not parse tells us nothing more */ }
      }
      for (const [baseFont, text] of textByFace) {
        probeChars.set(baseFont, text.length);
        if (englishLikeness(text).verdict === "english") englishFaces.add(baseFont);
      }
      if (englishFaces.size) {
        log(`[i] English face${englishFaces.size > 1 ? "s" : ""} excluded from the Myanmar vote: `
          + `${[...englishFaces].map((f) => JSON.stringify(f)).join(", ")}`);
      }
    }
  }







  const groups = new Map();
  for (const ref of refs) {
    const dict = loader.objectValue(ref);
    if (!(dict instanceof Map)) continue;
    const baseFont = String(loader.resolve(dict.get("BaseFont")) ?? "");
    if (!baseFont || englishFaces.has(baseFont)) continue;
    const tu = loader.tounicodeOf(dict);
    if (!tu || !tu.size) continue;
    const desc = loader.resolve(dict.get("FontDescriptor"));
    let prog = null;
    if (desc instanceof Map) {
      for (const key of ["FontFile2", "FontFile3", "FontFile"]) {
        const fileRef = desc.get(key);
        if (fileRef instanceof PdfRef) { prog = loader.streamOf(fileRef); break; }
      }
    }
    if (!prog || !prog.length) continue;
    let font;
    try { font = new TtfFont(prog); } catch { continue; }
    const key = normalizedFaceName(baseFont);
    const group = groups.get(key) || {
      baseFonts: [], faces: [], decisions: new Map(), confidence: new Map(),
      distance: 0, probeChars: 0,
    };
    if (!group.baseFonts.includes(baseFont)) {
      group.baseFonts.push(baseFont);
      group.probeChars += probeChars.get(baseFont) || 0;
    }
    group.faces.push({ font, tu });
    groups.set(key, group);
  }
  L.faces = groups.size;

  for (const group of groups.values()) {
    for (const { font, tu } of group.faces) {
      for (const [code, str] of tu) {
        if (!str || [...str].length !== 1) continue;
        const seat = str.codePointAt(0);
        if (!disputed.has(seat)) continue;






        if (group.decisions.has(seat)) continue;
        const gid = font.glyphId(code);
        if (!gid) continue;
        const observed = signatureFor(font, gid, samples);
        if (!observed) continue;
        L.glyphsVoted += 1;
        const result = crowdVote(observed, corpus, { claimLimit: 0.06 });
        if (!result || result.byte === null) continue;
        const letter = WININNWA_LEGACY_CODE_PAGE.get(result.byte);
        if (!isMyanmarOutput(letter)) continue;
        L.glyphsClaimed += 1;


        const prev = group.confidence.get(seat);
        if (!prev || result.best < prev.distance) {
          group.decisions.set(seat, letter);
          group.confidence.set(seat, {
            distance: result.best,
            votes: result.votes,
            agreement: result.agreement ?? 0,
            byte: result.byte,
          });
        }
      }
    }
    for (const c of group.confidence.values()) group.distance += c.distance;
  }

  const winners = [...groups.values()]
    .filter((g) => g.decisions.size >= minDecisions)
    .sort((a, b) => (b.probeChars - a.probeChars)
      || (b.decisions.size - a.decisions.size) || (a.distance - b.distance));
  if (!winners.length) {
    log(groups.size === 0 && englishFaces.size
      ? "[i] Vector auto-layout abstained: every candidate face reads as English (no Myanmar keyboard face)"
      : "[i] Vector auto-layout abstained: too few outline decisions from the embedded fonts");
    return done(groups.size === 0 && englishFaces.size
      ? "abstained-all-english" : "abstained-too-few-decisions");
  }
  const evidence = winners[0];




  const layoutVotes = layoutEntries.map(([name, table]) => {
    let votes = 0;
    for (const [code, text] of evidence.decisions) if (table.get(code) === text) votes += 1;
    return { name, table, votes };
  }).sort((a, b) => b.votes - a.votes);
  L.decisions = evidence.decisions.size;
  L.winnerVotes = layoutVotes[0]?.votes ?? 0;
  if (!layoutVotes.length || layoutVotes[0].votes === 0) return done("zero-votes");
  const table = new Map(layoutVotes[0].table);




  for (const [code, text] of evidence.decisions) {
    if (!table.has(code)) table.set(code, text);
  }
  const baseName = layoutVotes[0].name;
  const displayName = baseName.toLowerCase() === "wininnwa"
    ? "WinInnwa"
    : baseName.charAt(0).toUpperCase() + baseName.slice(1);
  emitEvent("vote", {
    ...L, outcome: "built", baseLayout: baseName, tableSize: table.size,
  });

  const result = {
    name: `vector:${displayName}`,
    table,






    fontName: baseName,
    sourceFont: evidence.baseFonts[0],
    sourceBaseFonts: evidence.baseFonts,
    decisions: evidence.decisions,
    confidence: evidence.confidence,
    matched: evidence.decisions.size,
    baseLayout: baseName,
    votes: layoutVotes.map(({ name, votes }) => [name, votes]),
  };
  log(`[+] Vector auto-layout built from ${result.matched} outline vote(s) in font ${JSON.stringify(result.sourceFont)}; `
    + `base ${JSON.stringify(result.baseLayout)}`
    + (evidence.baseFonts.length > 1
      ? `; face subsets ${evidence.baseFonts.map((f) => JSON.stringify(f)).join(", ")}` : ""));
  return result;
}
