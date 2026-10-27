// Architecture/Engine/_path.js — engine internal path anchor + re-export hub.
//
// Imports BindEngine and helpers by their EXACT names from the source
// files, then re-exports them. This is the only file that knows internal
// file locations; everything above imports from here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Exact-name imports from their source files (no aliasing here):
import { BindEngine } from "./bridge/bind-engine.js";

import { readFileContent } from "./MonoSyllabism/utilities/stream.js";
import { getDateTimeHash } from "./bridge/logen.js";
import { hashKind } from "./init/initS.js";
import { cacheInfo } from "./MonoSyllabism/main/grapheme/cache-integrity.js";
export { BindEngine, readFileContent, getDateTimeHash, hashKind};
// Anchor deterministically from __dirname (Engine/ is this file's dir).
import "../../path-index.js"; // side-effect: .env + Junk/

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const FALLBACK_ROOT = __dirname;
export const ENGINE_ROOT = path.resolve(__dirname, "..", "..");

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

function resolveJunkDir(rel) {
  return path.isAbsolute(rel) ? rel : path.join(ENGINE_ROOT, "Junk", rel);
}

let _ensured = false;
export function ensureDirs() {
  ensureDir(path.join(ENGINE_ROOT, "PDFs"));
  ensureDir(path.join(ENGINE_ROOT, "docx"));
  ensureDir(path.join(FALLBACK_ROOT, ".cache-tree"));
  ensureDir(path.join(FALLBACK_ROOT, "PDFs"));
  ensureDir(path.join(FALLBACK_ROOT, "docx"));
  ensureDir(resolveJunkDir("input"));
  ensureDir(resolveJunkDir("upload"));
  ensureDir(resolveJunkDir("upload/input"));
  ensureDir(resolveJunkDir("output"));
  ensureDir(resolveJunkDir("output/txt"));
  ensureDir(resolveJunkDir("output/docx"));
  ensureDir(resolveJunkDir("output/pdf"));
  ensureDir(resolveJunkDir("log/logfromengine"));
  ensureDir(resolveJunkDir("File/input"));
  const FJ = path.join(FALLBACK_ROOT, "Junk");
  ["input", path.join("upload","input"), path.join("output","txt"),
   path.join("output","docx"), path.join("output","pdf"),
   path.join("log","logfromengine"), path.join("File","input")].forEach(d=>ensureDir(path.join(FJ,d)));
  _ensured = true;
  return {
    INPUT_DIR: resolveJunkDir("input"),
    UPLOAD_DIR: resolveJunkDir("upload"),
    OUTPUT_DIR: resolveJunkDir("output"),
    TREE_DIR: path.join(FALLBACK_ROOT, ".cache-tree"),
    LOG_DIR: resolveJunkDir("log/logfromengine"),
  };
}

const INITIAL_DIRS = ensureDirs();
export function configureWorkspace({ treeDir, logDir, outputDir, dataDir } = {}) {
  if (treeDir !== undefined) INITIAL_DIRS.TREE_DIR = path.resolve(treeDir);
  if (logDir !== undefined) INITIAL_DIRS.LOG_DIR = path.resolve(logDir);
  if (outputDir !== undefined) INITIAL_DIRS.OUTPUT_DIR = path.resolve(outputDir);
}
export function GetInputDir() { return INITIAL_DIRS.INPUT_DIR; }
export function GetUploadDir() { return INITIAL_DIRS.UPLOAD_DIR; }
export function GetOutputDir() { return INITIAL_DIRS.OUTPUT_DIR; }
export function GetTreeDir() { return INITIAL_DIRS.TREE_DIR; }
export function GetLogDir() { return INITIAL_DIRS.LOG_DIR; }
export function GetPDFDir() { return path.join(ENGINE_ROOT, "PDFs"); }
export function GetDocxDir() { return path.join(ENGINE_ROOT, "docx"); }
export function InputFile() { return path.join(INITIAL_DIRS.INPUT_DIR, "input.txt"); }
export function OutputFile() { return INITIAL_DIRS.OUTPUT_DIR; }
export function LogFile() { return INITIAL_DIRS.LOG_DIR; }
export function TreeFile() { return INITIAL_DIRS.TREE_DIR; }
export function DataFile() { return path.join(ENGINE_ROOT, "knowledge", "isTreasure"); }
export function EngineRoot() { return ENGINE_ROOT; }
export function resolvePath(p) { return path.isAbsolute(p) ? p : path.resolve(ENGINE_ROOT, p); }
export function joinPath(...segments) { return path.join(...segments); }

// Legacy map/secure paths (used by engine modules):
const MAP_DIR = "MonoSyllabism/map";
const MAP_SECURE_FILE = ".data/secure.js";
const MAP_MASTER_FILE = ".data/master.json";
const JSON_SOURCE_FILE = "knowledge/isTreasure/master.json";
const JSC_FILE = MAP_DIR + "/payload.jsc";
export function MasterFile() { return resolvePath(MAP_MASTER_FILE); }
export function MapDir() { return MAP_DIR; }
export function MapBinaryFile() { return MAP_DIR + "/payload.jsc"; }
export function MapLoaderFile() { return MAP_DIR + "/loader.js"; }
export function MapSecureFile() { return MAP_SECURE_FILE; }
export function MapMasterFile() { return MAP_MASTER_FILE; }
export function MapSourceDir() { return "MonoSyllabism/mapbuilder/base"; }
export function JsonSourceFile() { return JSON_SOURCE_FILE; }
export function JscFile() { return JSC_FILE; }
export function resolveInputs(src) {
  const abs = resolvePath(src);
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const files = fs.readdirSync(abs).filter(f=>f.endsWith(".txt")).sort().map(f=>path.join(abs,f));
    if (!files.length) throw new Error(`No .txt files in: ${abs}`);
    return files;
  }
  if (fs.existsSync(abs)) return [abs];
  throw new Error(`Input not found: ${abs}`);
}

// onPathEnsure / resetWorkspace / cleanDir (used by engine init):
function matchPattern(filename, pattern) {
  return new RegExp("^" + pattern.replace(/\./g,"\\.").replace(/\*/g,".*").replace(/\?/g,".") + "$").test(filename);
}
function cleanDir(dirPath, opts) {
  if (!fs.existsSync(dirPath)) return;
  const excludeFiles = opts?.files || [];
  const excludeDirs = opts?.dirs || [];
  const tmpDir = path.join(dirPath, ".tmp-preserve");
  const preserved = [];
  function shouldExcludeDir(name, fullPath) {
    return excludeDirs.some(d => name === d || fullPath.endsWith(path.sep + d));
  }
  function scan(currentPath) {
    for (const entry of fs.readdirSync(currentPath,{withFileTypes:true})) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.name === ".tmp-preserve") continue;
      if (entry.isDirectory()) {
        if (shouldExcludeDir(entry.name, fullPath)) continue;
        scan(fullPath);
        try { fs.rmdirSync(fullPath); } catch {}
      } else if (excludeFiles.some(p => matchPattern(entry.name, p))) {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir,{recursive:true});
        const tmpPath = path.join(tmpDir, entry.name);
        fs.renameSync(fullPath, tmpPath);
        preserved.push({original:fullPath, tmp:tmpPath});
      } else { fs.unlinkSync(fullPath); }
    }
  }
  scan(dirPath);
  for (const item of preserved) {
    if (fs.existsSync(item.original)) fs.renameSync(item.tmp, item.original+".restored-"+Date.now());
    else fs.renameSync(item.tmp, item.original);
  }
  if (fs.existsSync(tmpDir)) { try{fs.rmSync(tmpDir,{recursive:true,force:true});}catch{} }
}
export function onPathEnsure(dirPath, reset = null) {
  const resolved = resolvePath(dirPath);
  if (reset !== false && fs.existsSync(resolved)) cleanDir(resolved, reset);
  if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
export function resetWorkspace(opts = null) {
  onPathEnsure(GetTreeDir(), false);
  onPathEnsure(GetOutputDir(), opts);
  onPathEnsure(GetLogDir(), opts);
}
export function PDF_DIR() { return GetPDFDir(); }
export function DOCX_DIR() { return GetDocxDir(); }
export default FALLBACK_ROOT;  // default = Engine dir (for internal engine default-imports)
