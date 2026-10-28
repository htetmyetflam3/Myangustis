









import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { BindEngine } from './path.js';

















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
