import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ═══════════════════════════════════════════════════════════════
   MODULE REGISTRY
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

const MODULES = new Map();

async function loadModules() {
  const modDir = path.join(__dirname, 'modules');
  if (!fs.existsSync(modDir)) return;

  const files = fs.readdirSync(modDir).filter(f => f.endsWith('.js'));
  for (const file of files) {
    const name = path.basename(file, '.js');
    try {
      const mod = await import(path.join(modDir, file));
      if (typeof mod.classify === 'function') MODULES.set(name, mod.classify);
    } catch (e) {
      console.warn(`[RULE-ENGINE] Skip ${file}: ${e.message}`);
    }
  }
}

const loadPromise = loadModules();

/* ═══════════════════════════════════════════════════════════════
   SCORING SYSTEM
   ═══════════════════════════════════════════════════════════════ */

const SCORING = {
  base: 0,
  noSupportPenalty: -0.4,      // penalty when zero rules support a candidate
  agreementBonus: 0.06,        // per extra agreeing match
  agreementCap: 0.18,          // max bonus from agreement
  fallbackBoost: 0.05,         // tiny nudge for dictionary-first candidate
  minThreshold: 0.25,          // score needed to beat fallback
};

function scoreCandidate(pos, allMatches, isFallback) {
  let score = SCORING.base;
  const supporters = [];

  for (const m of allMatches) {
    const modNames = POS_TO_MODULE[pos] || [];
    if (modNames.includes(m.module)) {
      score += m.confidence;
      supporters.push(m);
    }
  }

  if (supporters.length === 0) {
    score += SCORING.noSupportPenalty;
  } else if (supporters.length > 1) {
    score += Math.min(
      SCORING.agreementBonus * (supporters.length - 1),
      SCORING.agreementCap
    );
  }

  if (isFallback) score += SCORING.fallbackBoost;

  return {
    score,
    supporters: supporters.map(s => s.id || s.module),
    count: supporters.length,
  };
}

function resolveByScore(rawPos, allMatches) {
  const board = [];

  for (let i = 0; i < rawPos.length; i++) {
    const pos = rawPos[i];
    const isFallback = i === 0;
    const result = scoreCandidate(pos, allMatches, isFallback);
    board.push({ pos, ...result, isFallback });
  }

  board.sort((a, b) => b.score - a.score);

  const winner = board[0];
  const needsFallback = winner.score < SCORING.minThreshold && board.some(b => b.isFallback);

  return {
    finalPos: needsFallback ? rawPos[0] : winner.pos,
    scores: board,
    winner,
    forcedFallback: needsFallback,
  };
}

/* ═══════════════════════════════════════════════════════════════
   MAIN ENGINE
   ═══════════════════════════════════════════════════════════════ */

export async function* runRuleEngine(taggedLines, hash) {
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
      let scoreBoard = [];
      let forcedFallback = false;

      if (!isAmbiguous) {
        finalPos = token.rawPos[0];
      } else {
        const relevant = new Set();
        for (const pos of token.rawPos) {
          (POS_TO_MODULE[pos] || []).forEach(n => {
            if (MODULES.has(n)) relevant.add(n);
          });
        }

        const allMatches = [];
        for (const name of relevant) {
          const result = MODULES.get(name)(lineResult.tokens, i, context);
          if (result) allMatches.push(...result);
        }

        if (allMatches.length > 0) {
          const resolution = resolveByScore(token.rawPos, allMatches);
          finalPos = resolution.finalPos;
          matches = allMatches;
          scoreBoard = resolution.scores;
          forcedFallback = resolution.forcedFallback;
        } else {
          finalPos = token.rawPos[0];
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
        scoreBoard,
        forcedFallback,
      });
    }

    yield {
      tokens: resolvedTokens,
      isEos: lineResult.isEos ?? false,
      lineIndex: context.lineIndex,
    };
  }
}
