// Comparison DATA adapter only. Does not call the engine segmentation
// pipeline (no BindEngine here): it packages master/rules evidence for the MT
// comparison side.
//
// New-engine-shape status:
//   * mapperNormalize/toBurmeseStr used to be deep-imported from the engine
//     map loader. The engine now exposes only its single boundary
//     (Engine/index.js -> BindEngine); normalizer access for this adapter must
//     be re-added as an explicit Engine/index.js export when the WASM box that
//     hosts the guarded normalizer is wired into this plugin again.
//   * POS_MAP came from MonoSyllabism/graph/disassembler.js, which was removed
//     with the graph build step — the engine loads the prebuilt .cache-tree and
//     has no POS-code lookup table anymore. The comparison pos_codes view is
//     therefore UNPORTED, not silently nulled: the run refuses below until a
//     replacement table is supplied by the owner.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getBox, assertMapData } from '../../../../Engine/architecture/MonoSyllabism/map/host.mjs';
import { readMasterJson, MASTER_ENC } from '../../../secure.js';

// Removed with the graph/build.js era. See header: populate from the owner's
// new POS-code source to re-enable the comparison export.
const POS_MAP = null;
const ENGINE_NORMALIZER = null; // was { mapperNormalize, toBurmeseStr }
const { mapperNormalize, toBurmeseStr } = ENGINE_NORMALIZER ?? {};

if (globalThis[Symbol.for('proofreading.scraper.wasm-only')] !== true) {
  throw new Error('Comparison metadata requires the shared WASM-only runtime guard');
}
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [destination, extraFormsFile] = process.argv.slice(2);
if (!destination) throw new Error('usage: export-comparison-data.mjs OUTPUT_JSON [EXTRA_FORMS_JSON]');
// Loud, documented block — never emit pos_codes/normalizations as nulls.
if (POS_MAP === null || ENGINE_NORMALIZER === null) {
  throw new Error(
    'export-comparison-data: comparison POS view is unported after the graph/build.js ' +
      'removal (no disassembler POS_MAP, no guarded normalizer binding). Re-supply both via ' +
      'the Engine/index.js surface before running this adapter.',
  );
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(ROOT, relative));
// Single sealed master at the repo root: its bytes are fingerprinted directly,
// its content comes through secure.js (root .env key + sealed cache).
const masterPath = 'master.json.enc';
const rulesPath = 'Engine/knowledge/isTreasure/mainrules.js';
const masterBytes = fs.readFileSync(MASTER_ENC), rulesBytes = read(rulesPath);

// mainrules.js is a JSON object followed by a JavaScript block —
// `const MYANMAR_GRAMMAR_SEQUENCES = [...]`, single-quoted and commented. It is
// not a JSON document end to end, so parse the JSON head only; the sequence
// array is the engine's business and `mt/mt_compare.py` reads it as text. No
// JavaScript is evaluated here. Trailing commas in the head (the owner's hand
// edits leave one) are dropped outside string literals.
function parseRules(bytes) {
  const text = bytes.toString('utf8');
  const marker = text.search(/\bconst\s+MYANMAR_GRAMMAR_SEQUENCES\s*=/);
  const head = marker >= 0 ? text.slice(0, marker) : text;
  let out = '', inString = false, escaped = false;
  for (let i = 0; i < head.length; i++) {
    const ch = head[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === ',') {
      let j = i + 1;
      while (j < head.length && /\s/.test(head[j])) j++;
      if (head[j] === '}' || head[j] === ']') continue;
    }
    out += ch;
  }
  out = out.replace(/\s+$/, '');
  if (!out.endsWith('}')) throw new Error('mainrules.js JSON head does not close with }');
  return JSON.parse(out);
}

const master = readMasterJson(), rules = parseRules(rulesBytes);
if (!master.top || !master.resolution) throw new Error('Master top/resolution sections are required for comparison');
assertMapData(master.mapData);
getBox();

const bindings = [], unresolved = [], normalizations = {};
const families = {wibat: 'WIBAT', conjunction: 'CONJUNCTION', particle: 'PARTICLE',
  thanbanda: 'CONJUNCTION', paccaya: 'PARTICLE'};
const classify = form => form === 'rule' ? 'unresolved_reference'
  : /…|\.\.\.|-/.test(form) ? 'pattern_requires_handler' : 'literal';
function normalized(form) {
  if (!(form in normalizations)) normalizations[form] = toBurmeseStr(mapperNormalize(form));
  return normalizations[form];
}
function add(form, details) {
  if (typeof form !== 'string' || !form) throw new Error(`Non-string comparison form at ${details.data_path}`);
  const kind = classify(form);
  if (kind !== 'literal') {
    unresolved.push({...details, form, kind});
    return;
  }
  bindings.push({...details, form, normalized: normalized(form)});
}
function walkArrays(value, parts, source, family) {
  if (Array.isArray(value)) {
    const seen = new Set();
    for (const form of value) {
      if (seen.has(form)) continue; // duplicate evidence is not counted twice
      seen.add(form);
      add(form, {source, data_path: parts.join('.'), role_path: parts,
        family, pos_code: POS_MAP[families[family]],
        requires_disambiguation: parts.includes('disambiguate')});
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) walkArrays(child, [...parts,key], source, family);
  } else throw new Error(`Unexpected role-data shape at ${parts.join('.')}`);
}
for (const [family, value] of Object.entries(master.top)) {
  if (!families[family]) throw new Error(`Unmapped top family: ${family}`);
  walkArrays(value, ['top',family], 'top', family);
}
for (const family of ['wibat','thanbanda','paccaya']) {
  if (rules[family]) walkArrays(rules[family], ['rules',family], 'rules', family);
}

for (const [base, entry] of Object.entries(master.resolution.single)) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid resolution.single entry');
  add(base, {source:'resolution', data_path:`resolution.single.${base}`, base,
    relation:'declared_form', declared_default:entry.default ?? null});
  for (const [style, contexts] of Object.entries(entry.style ?? {})) {
    for (const [context, alternatives] of Object.entries(contexts)) {
      for (const form of Array.isArray(alternatives) ? alternatives : [alternatives]) {
        add(form, {source:'resolution', data_path:`resolution.single.${base}.style.${style}.${context}`,
          base, relation:'conditional_alternative', style, context,
          declared_default:entry.default ?? null});
      }
    }
  }
}
// Keep the owner's literal "tonkens" key; do not silently rename the schema.
for (const [variant, forms] of Object.entries(master.resolution.group?.tonkens ?? {})) {
  for (const form of forms) add(form, {source:'resolution_group',
    data_path:`resolution.group.tonkens.${variant}`, variant});
}

const grammar = [];
function walkGrammar(value, parts) {
  if (Array.isArray(value)) value.forEach((child,index)=>walkGrammar(child,[...parts,index]));
  else if (value && typeof value === 'object') {
    if (typeof value.pattern === 'string' || typeof value.constraint === 'string') {
      grammar.push({source_path:parts.join('.'), ...value});
      const cues = [...(Array.isArray(value.particles) ? value.particles : []),
        ...(typeof value.connector === 'string' ? [value.connector] : [])];
      for (const cue of new Set(cues)) add(cue, {source:'grammar_cue',
        data_path:parts.join('.'), rule_id:value.id ?? null,
        scope:'lexical_cue_only_not_a_clause_parse'});
    }
    for (const [key, child] of Object.entries(value)) walkGrammar(child,[...parts,key]);
  }
}
for (const [key,value] of Object.entries(rules)) {
  if (!['wibat','thanbanda','paccaya'].includes(key)) walkGrammar(value,[key]);
}
if (extraFormsFile) {
  const forms = JSON.parse(fs.readFileSync(extraFormsFile,'utf8'));
  if (!Array.isArray(forms) || forms.some(value=>typeof value !== 'string')) throw new Error('Extra comparison forms must be strings');
  for (const form of forms) if (classify(form)==='literal') normalized(form);
}
const build = JSON.parse(read('scraper/wasm/box/build-info.json'));
const comparisonData = {top:master.top, resolution:master.resolution, rules};
const annotationData = {dictionary:master.dictionary, mapData:master.mapData};
const result = {
  schema_version:1,
  sources:{master:masterPath, master_sha256:sha(masterBytes), rules:rulesPath, rules_sha256:sha(rulesBytes)},
  comparison_data_sha256:sha(JSON.stringify(comparisonData)),
  tag_data_sha256:sha(JSON.stringify(annotationData)), wasm_sha256:build.box_sha256,
  pos_codes:POS_MAP, bindings, unresolved, normalizations,
  grammar_rules:grammar, grammar_section_sizes:Object.fromEntries(Object.entries(rules).map(([key,value])=>[key,Object.keys(value).length])),
  resolution:master.resolution,
  policy:{phase:'MT comparison only',pos_overrides:false,automatic_replacements:false,
    style_policy:{default:'LSE',LSE:'literature style in essay',LSN:'narration style',quoted_character_speech:'LSN',prose_outside_speech:'LSE'},
    composition:'dictionary components → compound candidates → sentence/clause roles; preserve children and spans',
    resolution_scope:'sentence style plus grammatical role; not global particle replacement',
    contextual_resolution_status:'pending compound-first sentence/style implementation',
    default_markers:'opaque source strings, not interpreted as prohibitions',
    patterns:'unresolved patterns retained, not matched as literal words',
    word_order_constraints:'review data; not called violations without governing-role analysis'},
};
fs.mkdirSync(path.dirname(path.resolve(destination)),{recursive:true});
fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');
console.log(`[comparison-data] ${bindings.length} literal bindings, ${unresolved.length} unresolved forms; shared WASM required`);
