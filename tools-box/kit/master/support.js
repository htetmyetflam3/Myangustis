// support.js — the small, hardcoded helpers the tree build needs.
// Consolidates the pieces that used to live in Bridge/path.js, Bridge/logen.js,
// utilities/disk.js (tree writers) and main/grapheme/Tree.loaded.js (readers).
// Everything is anchored to THIS kit directory; the tree output lands beside
// CLI.js in ./tree. No network, no npm dependency — Node stdlib only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.dirname(fileURLToPath(import.meta.url));
export const TREE_DIR = path.join(ROOT, "tree");
const MASTER = path.join(ROOT, "master.json");

// ── path map (replaces Bridge/path.js for this kit) ──
export const TreeFile = () => TREE_DIR;
export const DataFile = () => ROOT;
export const MasterFile = () => MASTER;
export const joinPath = (...segments) => path.join(...segments);
export const resolvePath = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

// ── log shims (replaces Bridge/logen.js build/writer/reader events) ──
const noop = () => {};
export const buildStart = noop, buildEnd = noop, buildFail = noop, treeBuilt = noop;
export const writerStart = noop, writerEnd = noop, writerWrote = noop;
export const readerStart = noop, readerEnd = noop, readerFail = noop;
export const debugLogInit = noop;
export function getDateTimeHash() {
  const now = new Date();
  const p = (n, l = 2) => String(n).padStart(l, "0");
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}_${p(now.getHours())}${p(
    now.getMinutes(),
  )}${p(now.getSeconds())}_${p(now.getMilliseconds(), 3)}`;
}

// ── tree writers (from utilities/disk.js) ──
export function writeTreeToDir(treeData, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, "syllable.tree.json");
  fs.writeFileSync(filePath, JSON.stringify(treeData, null, 2), "utf8");
  return filePath;
}
export function writeMappedToDir(lines, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, "syllable.mapped.txt");
  fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf8");
  return filePath;
}
export function writeRtlToDir(rtlData, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, "rtl-tree.json");
  fs.writeFileSync(filePath, JSON.stringify(rtlData, null, 2), "utf8");
  return filePath;
}
export function writeRefToDir(refData, treeDir = TreeFile()) {
  const filePath = joinPath(treeDir, "ref-syllables.json");
  fs.writeFileSync(filePath, JSON.stringify(refData, null, 2), "utf8");
  return filePath;
}

// ── readers (from main/grapheme/Tree.loaded.js) ──
export function parseJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

// master.json "syllables" is either a bare array or { burmese:[], pali:[] }.
// The current tree includes BOTH lists (3215 units), so flatten every array.
export function loadSyllablesData(jsonPath = MasterFile()) {
  const data = parseJson(jsonPath);
  const syllables = data.syllables;
  if (Array.isArray(syllables)) return syllables;
  const out = [];
  for (const value of Object.values(syllables)) {
    if (Array.isArray(value)) out.push(...value);
  }
  if (!out.length) throw new Error(`No syllables found in ${jsonPath}`);
  return out;
}

// Canonical syllable.mapped.txt reader: "burmese" : "ascii" : "id" rows.
export function loadMappedRows(treeDir = TreeFile(), { skipComments = true, onBadLine = null } = {}) {
  const p = path.join(treeDir, "syllable.mapped.txt");
  if (!fs.existsSync(p)) return null;
  const rows = [];
  const content = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  content.split("\n").forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (skipComments && trimmed.startsWith("#")) return;
    const parts = trimmed.split(":").map((pt) => pt.trim().replace(/^["']|["']$/g, ""));
    if (parts.length < 3) {
      if (onBadLine) onBadLine(idx + 1, trimmed);
      return;
    }
    rows.push({ burmese: parts[0], ascii: parts[1], id: parts[2] });
  });
  return rows;
}
