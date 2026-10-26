/**
 * FILE: Parsed/parser/codepage/outline-vote.mjs
 *
 * DECIDE A CODE PAGE FROM OUTLINES. No rendering, no JPEG, no OCR.
 *
 * THE ARGUMENT. For a digital PDF the shapes are already vectors -- the
 * embedded font program carries them. The previous route rendered the page
 * to a canvas, compressed it to JPEG at quality 92, decoded it, thresholded
 * it to binary and compared 48x48 masks. Every one of those steps destroys
 * information that was exact to begin with, to recover a shape the file was
 * already carrying losslessly.
 *
 * THE EVIDENCE CHAIN. Three facts, and the third is the test:
 *
 *   the embedded font says    byte -> outline       (what the PDF draws)
 *   a candidate code page says byte -> text         (what it would mean)
 *   a reference font says      text -> outline      (what that should look like)
 *
 * If the candidate is right, the embedded outline for a byte and the
 * reference outline for the text it claims must be the same shape. Score
 * every candidate that way; the one that explains the most bytes wins.
 *
 * This is also why it can stand in for OCR on an old digital PDF. OCR
 * exists to recover text from pixels. A PDF with a legacy embedded font
 * has no pixel problem -- it has an encoding problem, and the outlines are
 * right there. Nothing needs to be recognised, only matched.
 *
 * WHAT IT CANNOT DO. A scanned page has no embedded font, so there is
 * nothing here to read; that remains the OCR path's job.
 */
import { glyphSignature, contourDistance, topologyMatches } from '../shape/contour.mjs';

const a_isTopologyMismatch = (x, y) => !topologyMatches(x, y);
import { TtfFont, glyphContours } from '../read/glyf.mjs';

/** Outlines for a font, keyed however the caller asks: by byte, or by text. */
function signaturesFor(font, lookups) {
  const upm = font.unitsPerEm || 1000;
  const out = new Map();
  for (const [key, code] of lookups) {
    const gid = font.glyphId(code);
    if (!gid) continue;
    const raw = glyphContours(font, gid);
    if (!raw || !raw.length) continue;
    const signature = glyphSignature(raw.map((c) => c.map((p) => [p.x / upm, p.y / upm])));
    if (signature) out.set(key, signature);
  }
  return out;
}

/**
 * Score one code page against an embedded font.
 *
 * `agreed` is the count of bytes where the embedded outline and the
 * reference outline for the claimed text are the same shape. `refused` is
 * where they disagree on TOPOLOGY -- a different number of closed
 * contours, which is not a near miss but a different letter, and is the
 * strongest single piece of evidence against a candidate.
 */
export function scoreCodePage(embedded, reference, codePage, { maxDistance = 0.09, topologyPenalty = 0.03 } = {}) {
  let agreed = 0;
  let refused = 0;
  let tested = 0;
  let distanceSum = 0;
  const disagreements = [];

  for (const [code, text] of codePage) {
    const mine = embedded.get(code);
    const theirs = reference.get(text);
    if (!mine || !theirs) continue;
    tested += 1;
    const d = contourDistance(mine, theirs, { topologyPenalty });
    if (!Number.isFinite(d)) { refused += 1; continue; }
    if (a_isTopologyMismatch(mine, theirs)) refused += 1;
    distanceSum += d;
    if (d <= maxDistance) agreed += 1;
    else if (disagreements.length < 12) disagreements.push(`${text}(0x${code.toString(16)})`);
  }

  return {
    tested,
    agreed,
    refused,
    score: tested ? agreed / tested : 0,
    meanDistance: tested - refused > 0 ? distanceSum / (tested - refused) : null,
    disagreements,
  };
}

/**
 * Which code page does this embedded font use?
 *
 * @param embeddedBytes the font program lifted out of the PDF
 * @param codePages     Map name -> Map(byte -> text)
 * @param referenceFont a Unicode font that draws the text correctly
 */
export function voteByOutline(embeddedBytes, codePages, referenceFont, options = {}) {
  let embeddedFont;
  try {
    embeddedFont = new TtfFont(embeddedBytes);
  } catch (error) {
    return { chosen: null, reason: `embedded font unreadable: ${error.message}`, ranking: [] };
  }

  /* Every byte any candidate mentions, looked up once in the embedded
     font -- the work does not repeat per candidate. */
  const bytes = new Set();
  const texts = new Set();
  for (const [, table] of codePages) {
    for (const [code, text] of table) { bytes.add(code); texts.add(text); }
  }

  const embedded = signaturesFor(embeddedFont, [...bytes].map((b) => [b, b]));
  if (embedded.size === 0) {
    return { chosen: null, reason: 'embedded font has no glyphs at these byte codes', ranking: [] };
  }

  const reference = signaturesFor(
    referenceFont instanceof TtfFont ? referenceFont : new TtfFont(referenceFont),
    [...texts].filter((t) => [...t].length === 1).map((t) => [t, t.codePointAt(0)]),
  );

  const ranking = [];
  for (const [name, table] of codePages) {
    ranking.push({ name, ...scoreCodePage(embedded, reference, table, options) });
  }
  ranking.sort((a, b) => b.score - a.score || (a.meanDistance ?? 9) - (b.meanDistance ?? 9));

  const best = ranking[0];
  const runnerUp = ranking[1];
  const margin = runnerUp ? best.score - runnerUp.score : 1;

  return {
    chosen: best && best.score > 0 ? best.name : null,
    score: best?.score ?? 0,
    margin,
    glyphsRead: embedded.size,
    ranking,
    reason: best && best.score > 0 ? null : 'no candidate explained any byte',
  };
}

/* ── identify the font itself ─────────────────────────────────────────
   DIAGNOSTIC ONLY. Naming the face is useful when you are investigating a
   document, but it is NOT how a slot gets decided -- see the crowd vote
   below, which is the rule this project actually runs on. Asking "which code page do these outlines fit"
   compares a decorative legacy face against a reference face, and faces
   genuinely draw letters differently -- measured, that scores 10-21% and
   separates candidates by only a few points.

   Asking "WHICH FONT IS THIS" compares like with like, and the answer is
   not close. An embedded font matched against the 403 recovered faces
   finds itself at distance 0.00000, with the next nearest at 0.129 -- a
   margin thirty times wider than the gap between two confusable letters.

   Once the face is known its code page is known, so the encoding question
   answers itself. That is why the font set had to be recovered: the
   identification needs something to identify against. */

const PROBE_BYTES = [0x6B, 0x6D, 0x70, 0x61, 0x65, 0x74, 0x75, 0x6F, 0x63, 0x64, 0x67, 0x69];

/** Byte -> outline signature for one font, over the probe bytes. */
export function fontFingerprint(source, { bytes = PROBE_BYTES } = {}) {
  let font;
  try {
    font = source instanceof TtfFont ? source : new TtfFont(source);
  } catch {
    return null;
  }
  const upm = font.unitsPerEm || 1000;
  const print = new Map();
  for (const code of bytes) {
    const gid = font.glyphId(code);
    if (!gid) continue;
    const raw = glyphContours(font, gid);
    if (!raw || !raw.length) continue;
    const signature = glyphSignature(raw.map((c) => c.map((p) => [p.x / upm, p.y / upm])));
    if (signature) print.set(code, signature);
  }
  return print.size ? print : null;
}

/**
 * Which known face is this embedded font?
 *
 * @param embedded   fingerprint of the font lifted from the PDF
 * @param candidates [{ name, fingerprint, codePage? }]
 */
export function identifyFont(embedded, candidates, { minBytes = 6, topologyPenalty = 0.03 } = {}) {
  if (!embedded) return { name: null, reason: 'no readable outlines in the embedded font', ranking: [] };

  const ranking = [];
  for (const candidate of candidates) {
    let n = 0;
    let sum = 0;
    for (const [code, mine] of embedded) {
      const theirs = candidate.fingerprint?.get(code);
      if (!theirs) continue;
      const d = contourDistance(mine, theirs, { topologyPenalty });
      if (Number.isFinite(d)) { sum += d; n += 1; }
    }
    if (n >= minBytes) ranking.push({ name: candidate.name, distance: sum / n, bytes: n, codePage: candidate.codePage ?? null });
  }
  ranking.sort((a, b) => a.distance - b.distance);

  const best = ranking[0];
  const margin = ranking[1] ? ranking[1].distance - best.distance : Infinity;
  return {
    name: best?.name ?? null,
    distance: best?.distance ?? null,
    margin,
    codePage: best?.codePage ?? null,
    ranking: ranking.slice(0, 5),
    reason: best ? null : 'no candidate shared enough bytes',
  };
}

/* ── the crowd vote ──────────────────────────────────────────────────
   THE OWNER'S RULE, restated here because it is the one that decides:

     a slot is settled by MANY AGREEING WITNESSES, not by one confident
     match. Two fonts claiming "this ink is က" at 90% are WEAKER evidence
     than ten fonts claiming က at 80%.

   So the question is never "which font is this". It is "how many faces
   claim this shape is က, and how close is each claim". A face is a
   witness; its code page turns its byte into a letter; the letter with
   the most witnesses wins.

   Why it beats naming the face: Myanmar legacy fonts are largely
   re-badged clones of one another. Measured on the bg-mlc fixture,
   WININNWA scored 0.00467 and SOFTC___ 0.00625 -- a margin of 0.0016,
   far too thin to name one and act on it. But both agree on what the
   BYTE means, and so do a hundred others, and that agreement is solid
   even though the identification is not.

   THE VETO. A witness matching at essentially zero distance has seen
   this exact outline before. It may overrule the crowd -- but only
   temporarily, as a provisional answer that a later stage can revisit.
   An exact match is strong evidence, not proof, because a clone family
   shares outlines.
*/

/** How close a claim has to be before a witness is allowed to vote. */
const CLAIM_LIMIT = 0.06;
/** At or under this, the witness has seen this exact outline. */
const EXACT = 0.002;

/**
 * Ask every witness what byte this shape sits at in their face.
 *
 * @param observed  signature of the shape in question
 * @param witnesses [{ name, byByte: Map<byte, signature> }]
 */
export function crowdVote(observed, witnesses, { claimLimit = CLAIM_LIMIT, topologyPenalty = 0.05, stride = 1 } = {}) {
  const claims = new Map(); // byte -> { votes, best, exact, names[] }
  /* A face that does not recognise the shape at all has ABSTAINED. It is
     not evidence against -- most of a 300-face corpus are decorative
     designs that share no outlines with anything. Counting them as
     dissent made a unanimous clone family look like 1% agreement. */
  let abstained = 0;

  for (const witness of witnesses) {
    let bestByte = null;
    let bestDistance = Infinity;
    for (const [code, signature] of witness.byByte) {
      const d = contourDistance(observed, signature, { stride, topologyPenalty });
      if (d < bestDistance) { bestDistance = d; bestByte = code; }
    }
    if (bestByte === null || bestDistance > claimLimit) { abstained += 1; continue; }

    if (!claims.has(bestByte)) claims.set(bestByte, { votes: 0, best: Infinity, exact: 0, names: [] });
    const claim = claims.get(bestByte);
    claim.votes += 1;
    if (bestDistance < claim.best) claim.best = bestDistance;
    if (bestDistance <= EXACT) { claim.exact += 1; if (claim.names.length < 5) claim.names.push(witness.name); }
  }

  if (!claims.size) {
    return { byte: null, votes: 0, abstained, reason: 'no witness recognised this shape', ranking: [] };
  }
  const voted = witnesses.length - abstained;

  /* DISTANCE FIRST, votes only to break a tie.

     This used to be the other way round -- `b.votes - a.votes || a.best -
     b.best` -- and that ordering silently destroyed the Burmese medials.
     The case is reproducible on page 1 of the 4414-page book: the glyph
     that prints between အ and က in အကြီး scored

         byte  66 "္ဘ"   distance 0.0486   4 votes   <- won
         byte 125 "ြ"    distance 0.0422   2 votes   <- thrown away

     The ြ is the closer shape and is the correct reading; it lost purely
     on having fewer witnesses. Votes measure how many faces in a 339-face
     corpus happen to own a similar outline, which is a property of the
     CORPUS, not of the shape in front of us -- a clone family manufactures
     votes for a wrong answer. Distance measures the thing we actually
     care about. So distance leads, and votes only separate candidates
     that fit equally well. */
  const ranking = [...claims]
    .map(([byte, c]) => ({ byte, ...c }))
    .sort((a, b) => a.best - b.best || b.votes - a.votes);

  /* The crowd decides. An exact match may overrule it, provisionally. */
  const crowd = ranking[0];
  const vetoer = ranking.find((r) => r.exact > 0 && r !== crowd);
  const chosen = vetoer ?? crowd;

  return {
    byte: chosen.byte,
    votes: chosen.votes,
    witnesses: witnesses.length,
    voted,
    abstained,
    // Agreement among faces that actually recognised the shape.
    agreement: voted ? chosen.votes / voted : 0,
    best: chosen.best,
    veto: vetoer ? { over: crowd.byte, by: vetoer.names, provisional: true } : null,
    ranking: ranking.slice(0, 5),
  };
}

/**
 * Load the witnesses from the generated file.
 *
 * No font files are needed at runtime -- .bin/gen-font-witnesses.mjs read
 * the 339 faces once, offline, and this is what it found. Reading the TTFs
 * at boot instead costs about fourteen seconds.
 */
export function loadWitnesses(file, { readFile }) {
  const raw = JSON.parse(readFile(file, 'utf8'));
  const samples = raw.samples ?? 8;
  const witnesses = [];
  for (const face of raw.faces) {
    const byByte = new Map();
    for (const [code, rec] of Object.entries(face.bytes)) {
      /* Points were packed flat as thousandths of the unit box; the
         contour count and the sample rate say where each one ends. */
      const buf = Buffer.from(rec.p, 'base64');
      const flat = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);
      const points = [];
      let at = 0;
      for (let c = 0; c < rec.c; c += 1) {
        const contour = [];
        for (let i = 0; i < samples; i += 1, at += 2) {
          contour.push([flat[at] / 1000, flat[at + 1] / 1000]);
        }
        points.push(contour);
      }
      byByte.set(Number(code), {
        count: rec.c,
        aspect: rec.r / 1000,
        areas: rec.a.map((v) => v / 1000),
        points,
      });
    }
    if (byByte.size) witnesses.push({ name: face.name, byByte });
  }
  return witnesses;
}

/** Build the witness list from font files directly (the offline path). */
export function buildWitnesses(fontFiles, { readFile, bytes = PROBE_BYTES, allBytes = null } = {}) {
  const codes = allBytes ?? bytes;
  const witnesses = [];
  for (const file of fontFiles) {
    let font;
    try { font = new TtfFont(readFile(file)); } catch { continue; }
    const upm = font.unitsPerEm || 1000;
    const byByte = new Map();
    for (const code of codes) {
      const gid = font.glyphId(code);
      if (!gid) continue;
      let raw; try { raw = glyphContours(font, gid); } catch { continue; }
      if (!raw || !raw.length) continue;
      const sig = glyphSignature(raw.map((c) => c.map((p) => [p.x / upm, p.y / upm])));
      if (sig) byByte.set(code, sig);
    }
    if (byByte.size >= 8) witnesses.push({ name: file.split(/[\\/]/).pop(), byByte });
  }
  return witnesses;
}
