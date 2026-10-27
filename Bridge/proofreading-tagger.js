// PROOFREADING-SPECIFIC BRIDGE.
//
// Sits next to the top-level engine facade but stays a separate module:
// proofreading-only concerns (disposable work dirs, the both-views request
// shape) never bloat the core entry. Its only job is to translate a
// proofreading request onto the engine's single boundary, BindEngine —
// signature 'proofreading' is path A (fullstopHolder -> runTagger ->
// runRuleEngine, dual syllable/raw_pos stream writers).
//
// This caller supplies the hash; Engine owns workspace setup and read-back.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BindEngine } from './path.js';

/**
 * Run the native tagger for a proofreading request.
 *
 * @param {{source:string, sourceText?:string, hash?:string, work?:string,
 *          views?:'both'|'syllable'}} request
 *   source     absolute path of the source .txt (engine file-head pipeline)
 *   sourceText alternatively, the text already in memory (API memory head;
 *              wins over source when both are given)
 *   hash       caller id naming segmented_<hash>_*; minted when omitted
 *   work       optional disposable work dir — retargets the engine workspace
 *              to work/{out,log} for the run, like tag-both did
 *   views      'both' (default) returns both outputs; 'syllable' nulls the
 *              raw POS view (the path-A run still produces it internally)
 * @returns {Promise<{hash:string, rawPosPath:string|null, syllablePath:string,
 *          lineCount:number, rawPos:string|null, syllable:string}>}
 */
export async function tagProofreading({ source, sourceText, hash, work, views = 'both' }) {
  const hasMemoryText = typeof sourceText === 'string' && sourceText.length > 0;
  if (!hasMemoryText && (typeof source !== 'string' || !source)) {
    throw new Error('tagProofreading: source path or sourceText string is required');
  }
  if (!hasMemoryText && !fs.existsSync(source)) {
    throw new Error(`tagProofreading: source not found: ${source}`);
  }

  const payload = { work, hash: hash ?? randomUUID() };
  if (hasMemoryText) payload.sourceText = sourceText;
  else payload.inputPath = source;

  const result = await BindEngine('proofreading', payload);
  if (!result.syllablePath) {
    throw new Error('proofreading engine run produced no syllable output');
  }

  const wantBoth = views !== 'syllable';
  if (wantBoth && !result.rawPosPath) {
    throw new Error('proofreading engine run produced no raw_pos output');
  }

  return {
    hash: result.hash,
    lineCount: result.lineCount,
    syllablePath: result.syllablePath,
    rawPosPath: wantBoth ? result.rawPosPath : null,
    syllable: result.syllable,
    rawPos: wantBoth ? result.rawPos : null,
  };
}
