// i rename this as path and this file here never define layout and resolve it own path by treating it own location as path and anything it need  reach to engine it will.import from path from helper 


// FILE: standalone-web/engine-plugin.path.js
//
// Local, self-contained workspace path contract for the removable plugin.
// Distinct name (not plain path.js) so it never collides with Bridge/path.js
// or the other engine path copies when viewed from the repo root.
// It ASSUMES the engine modules (MonoSyllabism, knowledge, init, ...) and the
// bridge/ entry live inside THIS directory, so every path resolves against the
// directory of this file — never against process.cwd() and never at a
// placeholderFor-* location.
//
// Drop-in replacement for the engine's Bridge/path.js: identical export names.
// When the plugin is merged into Engine/main/Bridge/, only the engine-root
// derivation below changes (one line); the call sites stay untouched.
//
//   ENGINE_ROOT = this directory            (engine modules assumed in here)
//   BRIDGE_DIR  = ENGINE_ROOT/bridge        (one level deep)
//   workspace   = ENGINE_ROOT/workspace/... (all mutable runtime dirs)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.join(ENGINE_ROOT, "bridge");
const WORKSPACE = path.join(ENGINE_ROOT, "workspace");

// Mutable dirs — configureWorkspace() can retarget each one per run.
let TREE_DIR = path.join(WORKSPACE, "tree");
let LOG_DIR = path.join(WORKSPACE, "log");
let OUTPUT_DIR = path.join(WORKSPACE, "output");
let DATA_DIR = path.join(WORKSPACE, "data");
const INPUT_DIR = path.join(WORKSPACE, "input") + path.sep;

// Called before running the pipeline when a run needs non-default locations.
export function configureWorkspace({ treeDir, logDir, outputDir, dataDir } = {}) {
  if (treeDir !== undefined) TREE_DIR = path.resolve(treeDir);
  if (logDir !== undefined) LOG_DIR = path.resolve(logDir);
  if (outputDir !== undefined) OUTPUT_DIR = path.resolve(outputDir);
  if (dataDir !== undefined) DATA_DIR = path.resolve(dataDir);
}

// ── Map build layout (MonoSyllabism/map) — relative to ENGINE_ROOT ──
// Four artifacts land there, consumed by the runtime through these names:
//   payload.jsc, loader.js, secure.js, master.json(.enc)
const MAP_DIR = "MonoSyllabism/map";
const MAP_BINARY_FILE = MAP_DIR + "/payload.jsc";
const MAP_LOADER_FILE = MAP_DIR + "/loader.js";
// secure.js and master.json(.enc) now live in .data/ at the repo root, two
// levels above this directory (Engine/host): one loader, one .env, one sealed source.
const MAP_SECURE_FILE = "../../.data/secure.js";
const MAP_MASTER_FILE = "../../.data/master.json";
const MAP_SOURCE_DIR = "MonoSyllabism/mapbuilder/base";
const JSON_SOURCE_FILE = "knowledge/isTreasure/master.json";
const JSC_FILE = MAP_BINARY_FILE;

export function EngineRoot() {
  return ENGINE_ROOT;
}

export function BridgeDir() {
  return BRIDGE_DIR;
}

export function resolveInputs(src) {
  const abs = resolvePath(src);

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const files = fs
      .readdirSync(abs)
      .filter((f) => f.endsWith(".txt"))
      .sort()
      .map((f) => path.join(abs, f));
    if (files.length === 0) throw new Error(`No .txt files in: ${abs}`);
    return files;
  }

  if (fs.existsSync(abs)) return [abs];

  throw new Error(`Input not found: ${abs}`);
}

export function InputFile() {
  return INPUT_DIR + "input.txt";
}

export function MasterFile() {
  return path.join(ENGINE_ROOT, MAP_MASTER_FILE);
}

// ── Map build paths (string form; build scripts resolve them themselves) ──
export function MapDir() {
  return MAP_DIR;
}

export function MapBinaryFile() {
  return MAP_BINARY_FILE;
}

export function MapLoaderFile() {
  return MAP_LOADER_FILE;
}

export function MapSecureFile() {
  return MAP_SECURE_FILE;
}

export function MapMasterFile() {
  return MAP_MASTER_FILE;
}

export function MapSourceDir() {
  return MAP_SOURCE_DIR;
}

export function JsonSourceFile() {
  return JSON_SOURCE_FILE;
}

export function JscFile() {
  return JSC_FILE;
}

// ── Path utility functions ──
export function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(ENGINE_ROOT, p);
}

export function joinPath(...segments) {
  return path.join(...segments);
}

export function getDirname(p) {
  return path.dirname(p);
}

export function getBasename(p, ext) {
  return ext ? path.basename(p, ext) : path.basename(p);
}

// ── For modules writing files (relative strings) ──
export function DataFile() {
  return DATA_DIR;
}

export function OutputFile() {
  return OUTPUT_DIR;
}

export function LogFile() {
  return LOG_DIR;
}

export function TreeFile() {
  return TREE_DIR;
}

// ── For deletion/reset (resolved absolute paths) ──
export function GetDataDir() {
  return resolvePath(DATA_DIR);
}

export function GetInputDir() {
  return resolvePath(INPUT_DIR);
}

export function GetOutputDir() {
  return resolvePath(OUTPUT_DIR);
}

export function GetLogDir() {
  return resolvePath(LOG_DIR);
}

export function GetTreeDir() {
  return resolvePath(TREE_DIR);
}

export function GetBridgeDir() {
  return BRIDGE_DIR;
}

export function GetJscFile() {
  return resolvePath(JSC_FILE);
}

export function GetMasterFile() {
  return resolvePath(MasterFile());
}

export function GetMapDir() {
  return resolvePath(MAP_DIR);
}

export function GetMapBinaryFile() {
  return resolvePath(MAP_BINARY_FILE);
}

export function GetMapLoaderFile() {
  return resolvePath(MAP_LOADER_FILE);
}

export function GetMapSecureFile() {
  return resolvePath(MAP_SECURE_FILE);
}

export function GetJsonSourceFile() {
  return resolvePath(JSON_SOURCE_FILE);
}

// ── Simple glob matcher (used by the directory cleaner) ──
function matchPattern(filename, pattern) {
  const regex = new RegExp(
    "^" +
      pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") +
      "$",
  );
  return regex.test(filename);
}

// ── Directory cleaner: wipes a dir while preserving named files/dirs ──
function cleanDir(dirPath, opts) {
  if (!fs.existsSync(dirPath)) return;

  const excludeFiles = opts?.files || [];
  const excludeDirs = opts?.dirs || [];
  const tmpDir = path.join(dirPath, ".tmp-preserve");
  const preserved = [];

  function shouldExcludeDir(name, fullPath) {
    return excludeDirs.some((d) => {
      const target = resolvePath(d);
      return name === d || fullPath === target || fullPath.endsWith(path.sep + d);
    });
  }

  function scan(currentPath) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.name === ".tmp-preserve") continue;

      if (entry.isDirectory()) {
        if (shouldExcludeDir(entry.name, fullPath)) continue;
        scan(fullPath);
        try {
          fs.rmdirSync(fullPath);
        } catch {} // eslint-disable-line no-empty -- best-effort cleanup
      } else if (excludeFiles.some((p) => matchPattern(entry.name, p))) {
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const tmpPath = path.join(tmpDir, entry.name);
        fs.renameSync(fullPath, tmpPath);
        preserved.push({ original: fullPath, tmp: tmpPath });
      } else {
        fs.unlinkSync(fullPath);
      }
    }
  }

  scan(dirPath);

  for (const item of preserved) {
    if (fs.existsSync(item.original)) {
      const conflictName = item.original + ".restored-" + Date.now();
      fs.renameSync(item.tmp, conflictName);
    } else {
      fs.renameSync(item.tmp, item.original);
    }
  }

  if (fs.existsSync(tmpDir)) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {} // eslint-disable-line no-empty -- best-effort cleanup
  }
}

export function onPathEnsure(dirPath, reset = null) {
  const resolved = resolvePath(dirPath);

  if (reset !== false && fs.existsSync(resolved)) {
    cleanDir(resolved, reset);
  }

  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }

  return resolved;
}

export function resetWorkspace(opts = null) {
  const targets = [GetTreeDir(), GetOutputDir(), GetLogDir()];
  for (const dir of targets) {
    onPathEnsure(dir, opts);
  }
}
