import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ═══════════════════════════════════════════════════════════════
   POS OVERRIDE / GRAMMAR ENGINE
   Extracted from kernel.js.
   Maps candidate POS tags → classifier modules that can argue
   for / enrich them.  Modules live in ./modules/
   ═══════════════════════════════════════════════════════════════ */

const POS_TO_MODULE = {
  'n':   ['noun', 'gender-number'],
  'v':   ['verb', 'tense'],
  'dj':  ['adjective'],
  'pn':  ['pronoun'],
  'ps':  ['pyitsi'],
  'wi':  ['wibat'],
  'cj':  ['thanbanda'],
};

const MODULES = new Map();        // name -> classify function

async function loadModules() {
  const modDir = path.join(__dirname, 'modules');
  if (!fs.existsSync(modDir)) return;

  const files = fs.readdirSync(modDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const name = path.basename(file, '.js');
    try {
      const mod = await import(path.join(modDir, file));
      if (typeof mod.classify === 'function') {
        MODULES.set(name, mod.classify);
      }
    } catch (e) {
      console.warn(`[RULE-ENGINE] Skip ${file}: ${e.message}`);
    }
  }
}

const loadPromise = loadModules();

/* ═══════════════════════════════════════════════════════════════
   AMBIGUITY RESOLVER
   Picks the POS with the highest-confidence match returned by
   any relevant classifier.
   ═══════════════════════════════════════════════════════════════ */

function resolveAmbiguity(rawPos, allMatches) {
  const posConfidence = new Map();
  for (const pos of rawPos) posConfidence.set(pos, 0);

  for (const m of allMatches) {
    for (const [pos, modNames] of Object.entries(POS_TO_MODULE)) {
      if (modNames.includes(m.module) && rawPos.includes(pos)) {
        const cur = posConfidence.get(pos) || 0;
        if (m.confidence > cur) posConfidence.set(pos, m.confidence);
      }
    }
  }

  let bestPos = rawPos[0];
  let bestScore = -1;
  for (const [pos, score] of posConfidence) {
    if (score > bestScore) { bestScore = score; bestPos = pos; }
  }
  return bestPos;
}

/* ═══════════════════════════════════════════════════════════════
   POS OVERRIDE ENGINE
   Call this from index.js when you want grammar-based POS
   disambiguation instead of the raw tagger output.
   ═══════════════════════════════════════════════════════════════ */

export async function* runPosOverrideEngine(taggedLines, hash) {
  await loadPromise;

  let lineIndex = 0;
  for await (const lineResult of taggedLines) {
    const resolvedTokens = [];
    const context = {
      hash,
      lineIndex: lineIndex++,
      tokenCount: lineResult.tokens.length,
      resolvedTokens,
      isEos: lineResult.isEos ?? false,
    };

    for (let i = 0; i < lineResult.tokens.length; i++) {
      const token = lineResult.tokens[i];
      const isSingleSyllable = token.ids.length === 1;
      const isAmbiguous = token.rawPos.length > 1;

      let finalPos;
      let matches = [];

      if (!isAmbiguous) {
        /* ── UNAMBIGUOUS: trust dictionary blindly ── */
        finalPos = token.rawPos[0];
      } else {
        /* ── AMBIGUOUS: call only relevant classifiers ── */
        const relevant = new Set();
        for (const pos of token.rawPos) {
          (POS_TO_MODULE[pos] || []).forEach(n => { if (MODULES.has(n)) relevant.add(n); });
        }

        const allMatches = [];
        for (const name of relevant) {
          const result = MODULES.get(name)(lineResult.tokens, i, context);
          if (result) allMatches.push(...result);
        }

        if (allMatches.length > 0) {
          finalPos = resolveAmbiguity(token.rawPos, allMatches);
          matches = allMatches;
        } else {
          finalPos = token.rawPos[0];   // fallback
        }
      }

      resolvedTokens.push({
        syllables: token.syllables,
        ids: token.ids,
        joinedIds: token.ids.join(''),
        rawPos: token.rawPos,
        finalPos,
        isSingleSyllable,
        isAmbiguous,
        position: i,
        matches,
      });
    }

    yield {
      tokens: resolvedTokens,
      isEos: lineResult.isEos ?? false,
      lineIndex: context.lineIndex,
    };
  }
}
