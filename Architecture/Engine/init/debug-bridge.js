import fs from 'node:fs';
import { BASE_DIR, joinPath, getLogen } from '../_path.js';
import { getFlushLines } from '../MonoSyllabism/utilities/buffer.js';
import { readFromApi } from '../MonoSyllabism/generators/input.js';
import { runSegmentor } from '../MonoSyllabism/main/phoneme/lexer.js';
import { fullstopHolder } from '../MonoSyllabism/generators/pos-input.js';
import { toLineStrings } from '../MonoSyllabism/generators/SfomatterForP.js';
import { runTagger } from '../MonoSyllabism/main/phoneme/phonology.js';
import { runRuleEngine } from '../bridge/Ginit.js';
import { burmeseToId } from '../MonoSyllabism/generators/idmap.js';
import {
  toBurmeseLine, toBurmeseLineWithPos, toIdsLineWithPos,
  toIdMapperLine, toIdMergedLine,
} from '../MonoSyllabism/utilities/formatter.js';

const {
  bridgeStart, bridgeEnd, bridgeLineCount, writerStart, writerEnd, writerWrote,
} = (await getLogen()).legacyLog;

function createDebugWriter(outputDir, suffix, flushLines, hash) {
  const outputPath = joinPath(outputDir, `segmented_${hash}_${suffix}.txt`);
  let lineCount = 0;
  let buffer = '';
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, '', { encoding: 'utf8', flag: 'wx' });
  writerStart({ outputDir, lineCount: 0 });

  const flush = () => {
    if (!buffer) return;
    fs.appendFileSync(outputPath, buffer, 'utf8');
    buffer = '';
  };
  return {
    writeLine(values) {
      buffer += values.join('  ') + '\n';
      lineCount += 1;
      if (lineCount % flushLines === 0) flush();
    },
    close() {
      flush();
      writerWrote({ path: outputPath, lines: lineCount });
      writerEnd({ path: outputPath });
      return outputPath;
    },
  };
}
let pending = Promise.resolve();

// Serialize debug output so concurrent runs cannot collide.
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
  bridgeStart({ hash });
  const writers = {
    syllable: createDebugWriter(outputDir, 'syllable', flushLines, hash),
    rawPos: createDebugWriter(outputDir, 'raw_pos', flushLines, hash),
    ids: createDebugWriter(outputDir, 'ids', flushLines, hash),
    idMapper: createDebugWriter(outputDir, 'id_mapper', flushLines, hash),
    idMerged: createDebugWriter(outputDir, 'id_merged', flushLines, hash),
  };
  const seg = runSegmentor(readFromApi(sourceText));
  const tagged = runTagger(fullstopHolder(toLineStrings(seg)), hash);
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
}
