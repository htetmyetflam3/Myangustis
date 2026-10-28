import fs from 'node:fs';
import { BASE_DIR, joinPath, getLogen } from '../_path.js';
import { createStreamWriter, setHash, resetHash } from '../../../tools-box/js/archive/engine-disk.js';
import { getFlushLines } from '../MonoSyllabism/utilities/buffer.js';
import { readFromApi } from '../MonoSyllabism/generators/input.js';
import { runSegmentor } from '../MonoSyllabism/main/phoneme/lexer.js';
import { fullstopHolder } from '../MonoSyllabism/generators/pos-input.js';
import { runTagger } from '../MonoSyllabism/main/phoneme/phonology.js';
import { runRuleEngine } from '../bridge/Ginit.js';
import { burmeseToId } from '../MonoSyllabism/generators/idmap.js';
import {
  toBurmeseLine, toBurmeseLineWithPos, toIdsLineWithPos,
  toIdMapperLine, toIdMergedLine,
} from '../MonoSyllabism/utilities/formatter.js';

const { bridgeStart, bridgeEnd, bridgeLineCount } = (await getLogen()).legacyLog;
let pending = Promise.resolve();

// The retained writer uses a global session hash, so debug runs must not overlap.
export function runDebug(sourceText, hash) {
  const result = pending.then(() => writeDebug(sourceText, hash));
  pending = result.catch(() => {});
  return result;
}

async function writeDebug(sourceText, hash) {
  const outputDir = joinPath(BASE_DIR, 'output');
  const flushLines = getFlushLines(Buffer.byteLength(sourceText, 'utf8'));
  for (const suffix of ['syllable', 'raw_pos', 'ids', 'id_mapper', 'id_merged']) {
    const file = joinPath(outputDir, `segmented_${hash}_${suffix}.txt`);
    try {
      fs.lstatSync(file);
      throw new Error(`Debug output already exists: ${file}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  setHash(hash);
  try {
    bridgeStart({ hash });
    const writers = {
      syllable: createStreamWriter(outputDir, 'syllable', flushLines, { exclusive: true }),
      rawPos: createStreamWriter(outputDir, 'raw_pos', flushLines, { exclusive: true }),
      ids: createStreamWriter(outputDir, 'ids', flushLines, { exclusive: true }),
      idMapper: createStreamWriter(outputDir, 'id_mapper', flushLines, { exclusive: true }),
      idMerged: createStreamWriter(outputDir, 'id_merged', flushLines, { exclusive: true }),
    };
    const seg = runSegmentor(readFromApi(sourceText));
    const tagged = runTagger(fullstopHolder(seg), hash);
    let lineCount = 0;
    for await (const line of runRuleEngine(tagged, hash)) {
      writers.syllable.writeLine([toBurmeseLine(line)]);
      writers.rawPos.writeLine([toBurmeseLineWithPos(line, 'rawPos')]);
      writers.ids.writeLine([toIdsLineWithPos(line)]);
      writers.idMapper.writeLine([toIdMapperLine(line, s => burmeseToId(s) ?? s)]);
      writers.idMerged.writeLine([toIdMergedLine(line)]);
      lineCount += 1;
      bridgeLineCount(1);
    }
    const paths = {};
    for (const [name, writer] of Object.entries(writers)) paths[`${name}Path`] = writer.close();
    bridgeEnd({ lineCount });
    return { ...paths, lineCount, hash };
  } finally {
    resetHash();
  }
}
