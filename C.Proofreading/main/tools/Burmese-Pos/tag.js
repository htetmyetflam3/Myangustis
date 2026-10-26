// Quality tagger shim — the JS side tag.py drives as a node child process.
//
// One job: run the engine's path-A tagger over one source file and write a
// stats JSON whose raw_pos_path / syllable_path point at the two views the
// Python quality layer parses. No WASM guard, no bundle layout, no engine
// internals on this side — the single engine entry (BindEngine) is reached
// through the repo-root Bridge facade, and the engine verifies its own
// prebuilt tree internally before anything is segmented.
//
// usage: node tag-both.mjs SOURCE_TEXT WORK_DIR RESULT_JSON
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { BindEngine, configureWorkspace, readFileContent } from '../../../../Bridge/path.js';

const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

const [sourceArg, workArg, resultArg] = process.argv.slice(2);
if (!sourceArg || !workArg || !resultArg) {
  console.error('usage: node tag-both.mjs SOURCE_TEXT WORK_DIR RESULT_JSON');
  process.exit(2);
}

const source = path.resolve(sourceArg);
const work = path.resolve(workArg);
if (!fs.existsSync(source)) {
  console.error(`source not found: ${source}`);
  process.exit(2);
}

// Only the mutable run outputs are retargeted at the scratch WORK dir; the
// engine's tree and data stay exactly where the engine itself resolves them.
const outputDir = path.join(work, 'out');
const logDir = path.join(work, 'log');
for (const dir of [outputDir, logDir]) fs.mkdirSync(dir, { recursive: true });
configureWorkspace({ outputDir, logDir });

// Content-derived session id names segmented_<hash>_* purely to keep parallel
// runs from colliding; job state, not this hash, is the engine's authority.
const sourceBytes = fs.readFileSync(source);
const session = hash(sourceBytes).slice(0, 24);

/* proofreading is path A: syllable + raw_pos writers, one boundary call. */
const result = await BindEngine('proofreading', { hash: session, inputPath: source });
if (!result.rawPosPath || !result.syllablePath) {
  throw new Error('Engine did not produce both views');
}

const raw = await readFileContent(result.rawPosPath);
const stats = {
  engine_entry: 'Engine/index.js via repo-root Bridge/path.js facade',
  source_sha256: hash(sourceBytes),
  raw_pos_path: result.rawPosPath,
  syllable_path: result.syllablePath,
  output_units: result.lineCount,
  // No external POS builder runs on this path, so this count is always 0.
  rejected_dictionary_entries: 0,
  tag_occurrences: [...raw.matchAll(/\{[^{}]+\}/g)].length,
  unknown_tag_occurrences: [...raw.matchAll(/\{\?\}/g)].length,
  ambiguous_tag_occurrences: [...raw.matchAll(/\{[^{}]*,[^{}]*\}/g)].length,
  rule_engine: 'owner pass-through; raw POS candidates retained, not grammar-disambiguated',
};
fs.writeFileSync(path.resolve(resultArg), JSON.stringify(stats, null, 2) + '\n');
console.log(`[tagged] ${result.lineCount} units -> ${result.rawPosPath}`);
