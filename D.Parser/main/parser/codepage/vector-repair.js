/**
 * FILE: Parsed/parser/codepage/vector-repair.mjs
 *
 * RECOVER THE GLYPHS THE CMAP CANNOT NAME, BY SHAPE.
 *
 * THE DEFECT. Some embedded subsets name every glyph they draw except a
 * handful, and for those the /ToUnicode carries whitespace as filler. The
 * decoder then does the honest thing and emits nothing at all -- so the
 * reader sees
 *
 *     အကီးအကဲ        when the page says  အကြီးအကဲ
 *
 * The medial ra ြ (U+103C) is simply absent. It is not mis-decoded, it is
 * dropped. On the 4414-page book this is 0.9% of glyphs and it lands on
 * exactly the codes 239 / 241 / 247 -- which is why whole words come out
 * wrong while most of the page reads fine.
 *
 * THE FIX. Those glyphs are not missing from the FILE. The subset still
 * carries their outlines -- the shapes were always there, only their names
 * were missing. So read the outline, ask the 339-face witness corpus what
 * byte that shape sits at, and decode the answer. Nothing is rendered, no
 * canvas, no JPEG, no OCR: this is the file's own vector data.
 *
 * WHY IT IS SAFE. The repair is consulted ONLY where the decoder produced
 * the empty string. It cannot displace a glyph that already decoded, so the
 * 99.1% that works is untouched by construction.
 *
 * Two things it must get right, both learned the hard way:
 *
 *   DISTANCE LEADS THE VOTE. Ranking candidates by vote count instead of
 *   shape distance is what destroyed these medials in the first place (see
 *   the comment at the ranking in outline-vote.mjs).
 *
 *   THE ANSWER IS IN PRE-BASE ORDER. WinInnwa writes a medial BEFORE the
 *   consonant it belongs to, so a voted ြ arrives as အြကီး and has to be
 *   moved behind the က to read အကြီး.
 */

import fs from "node:fs";
import path from "node:path";

import { TtfFont, glyphContours } from "../read/glyf.mjs";
import { glyphSignature } from "../shape/contour.mjs";
import { parseTtfCmap } from "../core/ttf-cmap.mjs";
import {
  pickEmbeddedFont, hasMyanmarGlyphs, parsePdfObjects, getStream,
  parseToUnicodeStream, extractPageLines, findRootPages, collectPages,
} from "../read/pdf-extract.mjs";
import {
  FontResourceLoader, DocumentDecoding, pageFontDecoders, PdfRef,
  detectLegacyLayoutFonts,
} from "../read/pdf-fonts.mjs";
import { englishLikeness } from "../text/mm-score.mjs";
import { crowdVote, loadWitnesses } from "./outline-vote.mjs";
import { WININNWA_LEGACY_CODE_PAGE } from "./registry.mjs";
import { emitEvent } from "../../../../Bridge/logen/core.js";

const WITNESS_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  "..", "jason-map", "vector", "font-witnesses.json",
);

/** U+103C ြ, U+103B ျ, U+103D ွ, U+103E ှ -- the four medials. */
const MEDIALS = "\u103C\u103B\u103D\u103E";
/** U+1039 virama, the conjunct marker. */
const VIRAMA = "\u1039";
/** A consonant, U+1000..U+1021. */
const CONSONANT = /[\u1000-\u1021]/;

let witnessCache = null;

/**
 * The witness corpus, read once per process.
 *
 * 339 faces is ~18 MB of JSON; loading it per page would dominate the run.
 */
export function witnessesFor(file = WITNESS_FILE) {
  if (!witnessCache) {
    witnessCache = loadWitnesses(file, { readFile: (p) => fs.readFileSync(p) });
  }
  return witnessCache;
}

/**
 * Move a voted medial behind the consonant it belongs to.
 *
 * WinInnwa lays a medial out BEFORE its consonant, so the raw voted text
 * reads အြကီး where the reader wants အကြီး. Two spellings turn up in the
 * corpus and both have to be handled:
 *
 *   medial + consonant            -> consonant + medial
 *   medial + virama + consonant   -> consonant + medial
 *
 * The second form is the one the book actually uses. The virama is dropped
 * because the medial, not a conjunct, was what the shape meant.
 *
 * A virama that was NOT preceded by a medial is left strictly alone --
 * ကမ္ဘာ keeps its ္, since that one is a real conjunct.
 */
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

/** The outline of one glyph id, normalised the way the witnesses are. */
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

/**
 * Ask the corpus what text a glyph id carries.
 *
 * @param fonts     [{ TtfFont, name }] the embedded programs to look in
 * @param gid       the glyph id the content stream drew
 * @param witnesses the loaded corpus
 * @returns {{ text: string, byte: number|null, distance: number, agreement: number, font: string }|null}
 */
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

/**
 * Build gid -> text for the glyphs the decoder could not name.
 *
 * `blind` is that set, gathered by a probe pass over the first pages. Only
 * these ids are voted on, so the cost is a handful of shapes against the
 * corpus rather than the whole font.
 *
 * @param {{objects: Map, getStream: Function}} source
 * @param {Iterable<number>} blind  glyph ids that decoded to nothing
 * @param {{ log?: Function, witnesses?: Array }} options
 */
export function buildVectorRepair(source, blind, { log = () => {}, witnesses = null } = {}) {
  const ids = [...new Set([...blind].map(Number).filter((n) => Number.isFinite(n) && n > 0))];
  if (!ids.length) return null;

  const corpus = witnesses || witnessesFor();
  if (!corpus.length) {
    log("[!] vector repair: no witness corpus loaded");
    return null;
  }

  /* WHICH FONTS MAY VOTE. Only the family the document actually draws
     Burmese with.

     A merged PDF carries several unrelated families and their glyph ids
     are NOT comparable -- in this book gid 241 is the medial ra in the
     eleven upm=900 Myanmar3 subsets, and the letter ဆ in the two upm=2048
     subsets. Asking every font and keeping the closest match therefore
     picked the wrong family, because the wrong answer happened to sit at
     0.0293 and the right one at 0.0476. Distance is only meaningful
     between shapes drawn by the same hand.

     So: take the family of the primary embedded font -- the one the
     pipeline already trusts, chosen by pickEmbeddedFont -- and let only
     subsets sharing its unitsPerEm and carrying Myanmar glyphs vote. */
  /* The family's unitsPerEm, taken from the primary embedded font -- the
     one pickEmbeddedFont already chose for the document. Callers that
     have it to hand may pass it as `source.primary`. */
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

/* ── the document-scale build: text path 5 ─────────────────────────────
   AUTO-BUILD A CODE PAGE FROM THE FONT'S OWN OUTLINES.

   buildVectorRepair above recovers the handful of glyph ids a decoder
   cannot name. This is the same machinery at document scale, for the
   text path PATHS.md calls (5): a candidate code page for a document
   whose legacy face no registered table was written for, built by
   outline instead of by name.

   It replaces the pixel builder that used to supply this candidate
   (buildVectorLegacyLayout, PDF.js crops against the labelled sheets).
   That is raster-to-SVG, and raster-to-SVG is the OCR repair stage
   only -- for a digital page the outlines are already in the file, so
   nothing here renders a page. shape/contour.mjs normalises every
   glyph to its own bounding box, so the comparison is of shape only;
   the one-scale-factor rule (A4 at 72 dpi) binds the traced specimen
   sheets on the OCR lane, which this path never opens.

   The bridge from a content-stream code to its outline is the one the
   decoder itself uses, walked backwards: the font's /ToUnicode names
   the code's byte seat (the masquerade code point the registry tables
   are keyed by), and the embedded program's cmap -- in these subsets
   usually the Mac format-0 table -- names the glyph id the code draws.
   glyphId(code) on the subset is that second half; looking a registry
   BYTE up in it instead reads whatever glyph the subsetter parked at
   that number, which is a different question entirely.

   Only DISPUTED seats are voted on (bytes the registered layouts give
   different Myanmar for); agreement needs no evidence. A seat's shape
   goes to the witness crowd, the crowd answers with the byte it draws
   that shape at, and the WinInnwa table names that byte -- measured on
   the fixtures, that naming recovers the letter under EITHER document
   convention (bg-mlc: crowd byte == seat 90/103; mm-grammar's Ayar
   faces: correct letter 36-40 per face against 1-10 the other way),
   which is the same convention voteGlyph already runs on. The
   decisions then vote a registered base layout and fill only its
   absent slots, exactly as the pixel builder did, and the result is a
   candidate table: resolve.mjs scores it beside the registered ones,
   so a weak build cannot bypass the quality floor. */

function isMyanmarOutput(text) {
  return Boolean(text) && [...text].some((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0x1000 && cp <= 0x109f;
  });
}

/* Subsets of one face share a name once the six-letter subset prefix is
   stripped -- the same normalisation the decode-time font gate applies
   (FontDecoder._isSelectedLegacyFont), so grouping here and gating
   there can never disagree about which faces are one face. */
function normalizedFaceName(baseFont) {
  return String(baseFont || "")
    .replace(/^[A-Z]{6}\+/u, "")
    .replace(/[^A-Za-z0-9]+/gu, "")
    .toLowerCase();
}

/**
 * Build the vector candidate layout from the embedded outlines.
 *
 * @param source  PDF bytes (or a path's bytes already read by the caller)
 * @param layouts Map name -> Map(byte -> text), the registered code pages
 * @returns the vectorLayout candidate { name, table, fontName, sourceFont,
 *          sourceBaseFonts, decisions, confidence, matched, baseLayout,
 *          votes } or null when no face could be decided from outlines.
 */
export function buildVectorOutlineLayout(source, layouts, {
  probePages = 6,
  minDecisions = 4,
  objects = null,
  legacyFonts = null,
  log = () => {},
  witnesses = null,
} = {}) {
  /* Ledger for the whole build, emitted ONCE at whichever exit is taken
     -- same channel and outcome vocabulary as the pixel builder it
     replaces, so a build that abstained can be told from one that
     decided without resubmitting the file. */
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
  // Agreement needs no vote: only the disputed seats cost an outline.
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

  /* ONE-SIDED ENGLISH CHECK, before any shape work: a face whose own
     /ToUnicode text reads as valid English is a real Latin face, never
     the Myanmar keyboard face -- its outlines match the corpus's Latin
     glyphs at their home bytes and would outvote the body face on
     distance alone (measured: DejaVu in bg-mlc claims 43-49 disputed
     seats at better median distance than WinInnwa's own). The pixel
     builder learned this from PDF.js text runs; the probe here is the
     parser's own extraction -- the per-resource decoders pageFontDecoders
     caches on the document are wrapped once, so the text each face
     produces over the probe pages is collected under its /BaseFont.
     One-sided as ever: too little signal is never "english", so a
     face that says almost nothing keeps its outlines in the vote. */
  const englishFaces = new Set();
  /* How much text each face drew on the probe pages. The pixel builder
     could only ever pick a face its crops came from -- a face on the
     probe pages -- and chooseCodePage scores the candidate on that
     same window, so a winner the probe pages never draw with scores 0
     however many outlines it decided elsewhere in the book (measured:
     mm-grammar's Amyanmar subsets out-decide Arlarwade document-wide,
     but the opening pages are Arlarwade). Probe volume is therefore
     the winner key below, with decisions as the tiebreak. */
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

  /* The candidate faces: every flagged legacy font that is not an
     English face, grouped by base name, each with the /ToUnicode that
     seats its codes and the program that draws them. A face with no
     usable /ToUnicode cannot seat its glyphs, and a program no TTF
     reader can open (a CFF, say) has no outlines to vote with -- both
     abstain, which is what keeps a name-only font out of the build. */
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
        /* One vote per seat per face: subsets of a face are the same
           drawing hand, so re-voting the seat from a second subset
           repeats the measurement instead of adding evidence (and on
           a many-subset book it is the difference between ~70 votes
           and ~1000). A seat this subset could not claim stays open
           for the next subset. */
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
        /* Distance leads, as everywhere in this layer: when two subsets
           of the face draw the seat, the closer outline's claim stands. */
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

  // Let the outline decisions vote which complete registered layout
  // supplies unresolved slots. Scanner-local repairs may later replace
  // a disputed slot.
  const layoutVotes = layoutEntries.map(([name, table]) => {
    let votes = 0;
    for (const [code, text] of evidence.decisions) if (table.get(code) === text) votes += 1;
    return { name, table, votes };
  }).sort((a, b) => b.votes - a.votes);
  L.decisions = evidence.decisions.size;
  L.winnerVotes = layoutVotes[0]?.votes ?? 0;
  if (!layoutVotes.length || layoutVotes[0].votes === 0) return done("zero-votes");
  const table = new Map(layoutVotes[0].table);
  // A single glyph's vote is not allowed to overturn a complete known
  // layout: outline evidence chooses the base layout and fills only
  // absent slots. Actual contradictory slots are resolved later at
  // scanner-flagged regions, where the whole cluster supplies context.
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
    // The parser's font matcher tolerates six-letter subset prefixes
    // (EAAAAA+WinInnwa); sourceBaseFonts extends the gate with every
    // subset of the face whose outlines earned the layout. No metrics
    // resolution is needed -- the build read the font dicts itself, so
    // the names here are the document's own /BaseFont values, earned
    // by shape whether or not the repository has ever seen them.
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
