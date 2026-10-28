









import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BindEngine } from '../../../../Bridge/path.js';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node tag.js SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}

const source = path.resolve(sourceArg);
const work = path.resolve(workArg);
if (!fs.existsSync(source)) {
  console.error(`source not found: ${source}`);
  process.exit(2);
}

const sourceBytes = fs.readFileSync(source);
const session = hash(sourceBytes).slice(0, 24);
const result = await BindEngine('proofreading', { hash: session, inputPath: source, work });
if (!result.rawPosPath || !result.syllablePath) {
  throw new Error('Engine did not produce both views');
}

const raw = result.rawPos;
const stats = {
  engine_entry: 'Engine/index.js via repo-root Bridge/path.js facade',
  source_sha256: hash(sourceBytes),
  raw_pos_path: result.rawPosPath,
  syllable_path: result.syllablePath,
  output_units: result.lineCount,

  rejected_dictionary_entries: 0,
  tag_occurrences: [...raw.matchAll(/\{[^{}]+\}/g)].length,
  unknown_tag_occurrences: [...raw.matchAll(/\{\?\}/g)].length,
  ambiguous_tag_occurrences: [...raw.matchAll(/\{[^{}]*,[^{}]*\}/g)].length,
  rule_engine: 'owner pass-through; raw POS candidates retained, not grammar-disambiguated',
};
fs.writeFileSync(path.resolve(resultArg), JSON.stringify(stats, null, 2) + '\n');
console.log(`[tagged] ${result.lineCount} units -> ${result.rawPosPath}`);
