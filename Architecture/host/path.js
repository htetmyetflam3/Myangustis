



















import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.join(ENGINE_ROOT, "bridge");
const WORKSPACE = path.join(ENGINE_ROOT, "workspace");


let TREE_DIR = path.join(WORKSPACE, "tree");
let LOG_DIR = path.join(WORKSPACE, "log");
let OUTPUT_DIR = path.join(WORKSPACE, "output");
let DATA_DIR = path.join(WORKSPACE, "data");
const INPUT_DIR = path.join(WORKSPACE, "input") + path.sep;


export function configureWorkspace({ treeDir, logDir, outputDir, dataDir } = {}) {
  if (treeDir !== undefined) TREE_DIR = path.resolve(treeDir);
  if (logDir !== undefined) LOG_DIR = path.resolve(logDir);
  if (outputDir !== undefined) OUTPUT_DIR = path.resolve(outputDir);
  if (dataDir !== undefined) DATA_DIR = path.resolve(dataDir);
}




const MAP_DIR = "MonoSyllabism/map";
const MAP_BINARY_FILE = MAP_DIR + "/payload.jsc";
const MAP_LOADER_FILE = MAP_DIR + "/loader.js";

const MAP_SECURE_FILE = "../Engine/.data/secure.js";
const MAP_MASTER_FILE = "../Engine/.data/master.json";
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


export function onPathEnsure(dirPath) {
  const resolved = resolvePath(dirPath);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
export function ensureWorkspace() {
  for (const dir of [GetTreeDir(), GetOutputDir(), GetLogDir()]) onPathEnsure(dir);
}
