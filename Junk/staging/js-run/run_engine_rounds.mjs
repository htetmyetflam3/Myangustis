// Segmentation + POS only — no parser, no PDF/DOCX, no files parsed.
//
// The JS engine's real switches (checked in A.Engine/architecture/init/bridge.js
// and logen.js):
//   BindEngine({ sourceText, flag: 'syllable' | 'pos', log })   // log gates the events
//   legacyLog.init({ DEBUG: true })                             // uppercase DEBUG gates the LOG FILES
//   configureWorkspace({ logDir })                              // where those files go
//
// Usage:
//   node run_engine_rounds.mjs --round=r1 --log=true  --debug=true
//   node run_engine_rounds.mjs --round=r2 --log=true  --debug=false
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STAGED = path.resolve(HERE, '..', 'main-js');

const argv = Object.fromEntries(
  process.argv.slice(2).map((raw) => {
    const [key, value] = raw.replace(/^--/, '').split('=');
    return [key, value ?? 'true'];
  }),
);
const round = argv.round ?? 'r1';
const logFlag = argv.log !== 'false';
const debugFlag = argv.debug === 'true';
const textFile = path.resolve(argv.input ?? path.join(HERE, '..', 'input.txt'));

const outDir = path.join(HERE, 'runs', round);
const logDir = path.join(outDir, 'logfromengine');
fs.mkdirSync(logDir, { recursive: true });

const { BindEngine } = await import(path.join(STAGED, 'A.Engine', '_index.js'));
const paths = await import(path.join(STAGED, 'A.Engine', 'architecture', '_path.js'));
const logen = await import(path.join(STAGED, 'logen.js'));

if (!fs.realpathSync(paths.EngineRoot()).startsWith(fs.realpathSync(STAGED))) {
  throw new Error(`refusing: engine resolved to ${paths.EngineRoot()}, not the staged copy`);
}
// Point the engine's log files at this round before the logger initialises.
paths.configureWorkspace({ logDir });
logen.legacyLog.init({ DEBUG: debugFlag });

const text = fs.readFileSync(textFile, 'utf8');
const request = (flag) => ({ sourceText: text, flag, log: logFlag, quiet: true });

// ── segmentation ─────────────────────────────────────────────────────────
const syllableLines = [];
for await (const line of BindEngine(request('syllable'))) syllableLines.push(line);

// ── POS ──────────────────────────────────────────────────────────────────
const posUnits = [];
for await (const unit of BindEngine(request('pos'))) posUnits.push(unit);

const write = (name, body) => fs.writeFileSync(path.join(outDir, name), body, 'utf8');
write('segmentation.txt', syllableLines.join('\n') + (syllableLines.length ? '\n' : ''));
write('pos.syllable.txt',
  posUnits.map((u) => u.syllable).join('\n') + (posUnits.length ? '\n' : ''));
write('pos.raw.txt',
  posUnits.map((u) => u.rawPos).join('\n') + (posUnits.length ? '\n' : ''));

const logFiles = fs.readdirSync(logDir).sort()
  .filter((name) => fs.statSync(path.join(logDir, name)).isFile())
  .map((name) => ({ name, bytes: fs.statSync(path.join(logDir, name)).size }));

write('summary.json', JSON.stringify({
  round,
  engine: 'staged main branch (67f0284) JS engine',
  engine_root: paths.EngineRoot(),
  flags: { 'BindEngine.log': logFlag, 'legacyLog.init.DEBUG': debugFlag },
  text_file: textFile,
  text_chars: [...text].length,
  text_lines: text.split('\n').filter((line) => line.length).length,
  syllable_lines: syllableLines.length,
  pos_units: posUnits.length,
  log_dir: logDir,
  log_files: logFiles,
}, null, 2) + '\n');

console.log(`[runner] ${round}: log=${logFlag} DEBUG=${debugFlag} ` +
  `syllable_lines=${syllableLines.length} pos_units=${posUnits.length} ` +
  `log_files=${logFiles.length ? logFiles.map((f) => f.name).join(',') : '(none)'}`);
