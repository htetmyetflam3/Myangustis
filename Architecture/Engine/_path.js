import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const FALLBACK_ROOT = __dirname;
export const ENGINE_ROOT = __dirname;

async function resolveBaseDir() {
  const rootExporter = new URL('../../index-path.js', import.meta.url);
  const componentExporter = new URL('../_index.js', import.meta.url);
  if (fs.existsSync(rootExporter) && fs.existsSync(componentExporter)) {
    try {
      const { JUNK_DIR } = await import('../_index.js');
      if (typeof JUNK_DIR === 'string' && path.isAbsolute(JUNK_DIR)) return JUNK_DIR;
    } catch {
      // Standalone engines use their own directory when exporters cannot load.
    }
  }
  return __dirname;
}
export const BASE_DIR = await resolveBaseDir();

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

function resolveJunkDir(rel) {
  return path.isAbsolute(rel) ? rel : path.join(BASE_DIR, rel);
}

export function ensureDirs() {
  for (const dir of ["PDFs", "docx", "input", "upload/input", "output/txt",
    "output/docx", "output/pdf", "log/logfromengine", "File/input"]) {
    ensureDir(resolveJunkDir(dir));
  }
  return {
    INPUT_DIR: resolveJunkDir("input"),
    UPLOAD_DIR: resolveJunkDir("upload"),
    OUTPUT_DIR: resolveJunkDir("output"),
    LOG_DIR: resolveJunkDir("log/logfromengine"),
  };
}

const INITIAL_DIRS = ensureDirs();
export function configureWorkspace({ logDir, outputDir } = {}) {
  if (logDir !== undefined) INITIAL_DIRS.LOG_DIR = path.resolve(logDir);
  if (outputDir !== undefined) INITIAL_DIRS.OUTPUT_DIR = path.resolve(outputDir);
}
export function GetInputDir() { return INITIAL_DIRS.INPUT_DIR; }
export function GetUploadDir() { return INITIAL_DIRS.UPLOAD_DIR; }
export function GetOutputDir() { return INITIAL_DIRS.OUTPUT_DIR; }
export function GetLogDir() { return INITIAL_DIRS.LOG_DIR; }
export function GetPDFDir() { return resolveJunkDir("PDFs"); }
export function GetDocxDir() { return resolveJunkDir("docx"); }
export function InputFile() { return path.join(INITIAL_DIRS.INPUT_DIR, "input.txt"); }
export function OutputFile() { return INITIAL_DIRS.OUTPUT_DIR; }
export function LogFile() { return INITIAL_DIRS.LOG_DIR; }
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

// Workspace setup only creates missing directories; later runs preserve files.
export function onPathEnsure(dirPath) {
  const resolved = resolvePath(dirPath);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
export function ensureWorkspace() {
  for (const dir of [GetOutputDir(), GetLogDir()]) onPathEnsure(dir);
}
export function PDF_DIR() { return GetPDFDir(); }
export function DOCX_DIR() { return GetDocxDir(); }
export default FALLBACK_ROOT;  // default = Engine dir (for internal engine default-imports)
