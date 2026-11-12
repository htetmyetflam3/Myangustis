import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { tagProofreading } from '../../proofreading-tagger.js';

const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node tag.js SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}

const source = path.resolve(sourceArg);
const digest = crypto.createHash('sha256');
const decoder = new StringDecoder('utf8');
let sourceText = '';
for await (const chunk of fs.createReadStream(source)) {
  digest.update(chunk);
  sourceText += decoder.write(chunk);
}
sourceText += decoder.end();
const result = await tagProofreading({ sourceText });
const raw = result.rawPos;
const stats = {
  engine_entry: 'Engine binding via proofreading path chain',
  source_sha256: digest.digest('hex'),
  raw_pos: raw,
  syllable: result.syllable,
  output_units: result.lineCount,
  rejected_dictionary_entries: 0,
  tag_occurrences: [...raw.matchAll(/\{[^{}]+\}/g)].length,
  unknown_tag_occurrences: [...raw.matchAll(/\{\?\}/g)].length,
  ambiguous_tag_occurrences: [...raw.matchAll(/\{[^{}]*,[^{}]*\}/g)].length,
  rule_engine: 'owner pass-through; raw POS candidates retained, not grammar-disambiguated',
};
// This metadata file is owned by the calling tool, not the engine bridge.
fs.writeFileSync(path.resolve(resultArg), JSON.stringify(stats, null, 2) + '\n');
console.log(`[tagged] ${result.lineCount} units`);
