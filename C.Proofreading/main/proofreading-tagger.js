import fs from 'node:fs';
import { BindEngine } from '../_path.js';

// File access stays with the caller; the engine receives only text.
export async function tagProofreading({ source, sourceText, views = 'both', hash, work }) {
  if ((hash !== undefined && hash !== null) || (work !== undefined && work !== null)) {
    throw new Error('tagProofreading: hashes and output paths are not supported; use BindEngine directly for hashed calls');
  }
  if (typeof sourceText !== 'string') {
    if (typeof source !== 'string' || !source) {
      throw new Error('tagProofreading: source path or sourceText string is required');
    }
    sourceText = '';
    for await (const chunk of fs.createReadStream(source, { encoding: 'utf8' })) sourceText += chunk;
  }
  const syllables = [];
  const positions = [];
  if (views === 'syllable') {
    for await (const line of BindEngine({ flag: 'syllable', sourceText })) syllables.push(line);
  } else {
    for await (const unit of BindEngine({ flag: 'pos', sourceText })) {
      syllables.push(unit.syllable);
      positions.push(unit.rawPos);
    }
  }
  const asText = lines => lines.length ? `${lines.join('\n')}\n` : '';
  return {
    lineCount: syllables.length,
    syllable: asText(syllables),
    rawPos: views === 'syllable' ? null : asText(positions),
  };
}
