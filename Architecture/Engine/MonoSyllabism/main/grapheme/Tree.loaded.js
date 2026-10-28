import { DataFile, MasterFile, getEngineData } from '../../../_path.js';
const { readSecureText, readSecureJson } = await getEngineData();
import { TREE_DIR, verifyCacheTree } from './cache-integrity.js';
import fs from 'fs';
import path from 'path';
import readline from 'readline';



export function parseJson(filePath = DataFile() + '/sid-syllables.json') {
  return readSecureJson(filePath);
}





let syllableTree = null;
let rtlTree = null;

export function getTree() {
  if (syllableTree) return syllableTree;
  verifyCacheTree();
  const p = path.join(TREE_DIR, 'syllable.tree.json');
  syllableTree = parseJson(p);
  if (!syllableTree) throw new Error(`Syllable tree failed to parse: ${p}`);
  return syllableTree;
}

export function resetTree() {
  syllableTree = null;
}

export function getRtlTree() {
  if (rtlTree) return rtlTree;
  verifyCacheTree();
  const p = path.join(TREE_DIR, 'rtl-tree.json');
  rtlTree = parseJson(p);
  if (!rtlTree) throw new Error(`RTL tree not found at: ${p}`);
  return rtlTree;
}

export function resetRtlTree() {
  rtlTree = null;
}


export function getStepKey(entry, stepNum) {
  if (!entry) return 'St-F';
  const numKey = `St-${stepNum}`;
  return entry[numKey] ? numKey : 'St-F';
}


export function findEntry(stepData, s, pos) {
  if (!stepData) return null;
  for (const item of stepData) {
    const tok = Object.keys(item)[0];
    if (s.startsWith(tok, pos)) {
      return { entry: item, tok, len: tok.length };
    }
  }
  return null;
}





let posTree = null;

export function getPosTree() {
  if (posTree) return posTree;
  verifyCacheTree();
  const p = path.join(TREE_DIR, 'pos.tree.json');
  posTree = JSON.parse(fs.readFileSync(p, 'utf-8'));
  return posTree;
}

export function resetPosTree() {
  posTree = null;
}


export function getPosStepKey(stepNum) {
  return `St-${stepNum}`;
}

export function getPosStepData(node, stepNum) {
  return node?.[`St-${stepNum}`];
}

export function hasPosStep(node, stepNum) {
  return node?.[`St-${stepNum}`] !== undefined;
}










async function* _syllablesFromLines(lines) {
  let inSection = false;
  let collecting = false;
  for await (const line of lines) {
    const trimmed = line.trim();
    if (!inSection) {
      const m = trimmed.match(/^"syllables"\s*:\s*([\[{])/);
      if (m) {
        inSection = true;
        collecting = m[1] === '[';
      }
      continue;
    }
    if (!collecting) {
      if (/^"burmese"\s*:\s*\[\s*$/.test(trimmed)) collecting = true;
      continue;
    }
    if (trimmed === ']' || trimmed.startsWith('],')) break;
    const match = line.match(/^\s*("(?:\\.|[^"\\])*")/);
    if (match) yield JSON.parse(match[1]);
  }
}

async function _collect(lines) {
  const syllables = [];
  for await (const s of _syllablesFromLines(lines)) syllables.push(s);
  return syllables;
}

export async function streamSyllables(jsonPath) {

  if (fs.existsSync(jsonPath + '.enc')) {
    const text = readSecureText(jsonPath);
    return _collect(text.split('\n'));
  }
  const fileStream = fs.createReadStream(jsonPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  return _collect(rl);
}

export async function loadSyllablesData(jsonPath = MasterFile()) {
  const syllables = await streamSyllables(jsonPath);
  if (!syllables.length) throw new Error(`No syllables found in ${jsonPath}`);
  return syllables;
}









export function loadMappedRows(treeDir = TREE_DIR, opts = {}) {
  const { skipComments = true, onBadLine = null } = opts;
  verifyCacheTree(treeDir);
  const p = path.join(treeDir, 'syllable.mapped.txt');
  if (!fs.existsSync(p)) return null;
  const rows = [];
  const content = fs.readFileSync(p, 'utf-8').replace(/^\uFEFF/, '');
  content.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (skipComments && trimmed.startsWith('#')) return;
    const parts = trimmed.split(':').map((pt) => pt.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 3) {
      if (onBadLine) onBadLine(idx + 1, trimmed);
      return;
    }
    rows.push({ burmese: parts[0], ascii: parts[1], id: parts[2] });
  });
  return rows;
}
