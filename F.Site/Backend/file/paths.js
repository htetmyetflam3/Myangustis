import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
export function resolvePath(p, base = PROJECT_ROOT) {
  return path.isAbsolute(p) ? p : path.resolve(base, p);
}
export function abs(p) {
  return resolvePath(p);
}
export function joinPath(...segments) {
  return path.join(...segments);
}
export const WEB = path.basename(PROJECT_ROOT);
// Modular layout. PROJECT_ROOT resolves to Site/ (two levels up from this
// file). Backend and Frontend stay inside it; the parser moved OUT to a
// sibling top-level module, hence the leading ../. Every constant below
// derives from these three roots.
export const BACKEND_DIR = "Backend";
export const FILE_DIR = `${BACKEND_DIR}/file`;
export const SITE_ENTRY = "index.js";
export const SITE_ENV = ".env";
export const SITE_PACKAGE_JSON = "package.json";
export const PARSED_ROOT = "../Parser/main";
export const PARSER_DIR = `${PARSED_ROOT}/parser`;
export const PARSER_MAP_DIR = `${PARSER_DIR}/map`;
export const PARSER_MODEL_DIR = `${PARSER_DIR}/model`;
export const PARSER_FONT_DIR = `${PARSED_ROOT}/fonts`;
export const PRASER_WEB = PARSED_ROOT;
/* The parser is reached through its manager, which owns the worker
   threads and lanes. There is no CLI entry any more: the API route is the
   only way in. */
export const PRASER_MANAGER = `${PARSER_DIR}/manager.mjs`;
export const PARSER_RUNTIME_DIR =
  String(process.env.PARSER_RUNTIME_DIR || '').trim() || PARSED_ROOT;
export const INPUT_DIR = `${PARSER_RUNTIME_DIR}/upload/input`;
export const INPUT_TXT = `${INPUT_DIR}/txt`;
export const INPUT_PDF = `${INPUT_DIR}/pdf`;
export const INPUT_DOCX = `${INPUT_DIR}/docx`;
export const FIXTURE_DOCX = `${PARSED_ROOT}/File/upload/docx/zawgyi_fixture.docx`;
export const FIXTURE_PDF = `${PARSED_ROOT}/File/upload/pdf/test.pdf`;
export const QUARANTINE_DIR = `${PARSER_RUNTIME_DIR}/upload/quarantine`;
export const OUTPUT_DIR = `${PARSER_RUNTIME_DIR}/.output`;
export const RAW_TXT_DIR = `${OUTPUT_DIR}/txt`;
export const ORIGINAL_DIR = `${OUTPUT_DIR}/original`;
export const OUTPUT_DOCX_DIR = `${OUTPUT_DIR}/docx`;
export const TREE_DIR = `${OUTPUT_DIR}/.tree`;
export const LOGS_DIR = "logs";
export const DATA_DIR = ".data";
export const DB_FILE = process.env.DB_FILE || `${DATA_DIR}/site.db`;
export const SCHEMA_FILE = `${BACKEND_DIR}/db/schema.sql`;
export const FRONTEND_SOURCE_DIR = "Frontend";
export const FRONTEND_DIR = process.env.FRONTEND_DIR || `${FRONTEND_SOURCE_DIR}/dist`;
export const FRONTEND_REACT_DIR = `${FRONTEND_DIR}/react`;
export const VITE_CONFIG = `${FRONTEND_SOURCE_DIR}/frontend-bootstrap/vite.config.js`;
export const VITE_BIN = "node_modules/.bin/vite";
export const BUILD_DIR = FRONTEND_DIR;
export const SPA_DIR = FRONTEND_DIR;
export const GetSiteDir = () => PROJECT_ROOT;
export const GetBackendDir = () => abs(BACKEND_DIR);
export const GetSiteEntry = () => abs(SITE_ENTRY);
export const GetSiteEnv = () => abs(SITE_ENV);
export const GetSitePackageJson = () => abs(SITE_PACKAGE_JSON);
export const GetPraserWeb = () => abs(PRASER_WEB);
export const GetPraserManager = () => abs(PRASER_MANAGER);
export const GetRawTxtDir = () => abs(RAW_TXT_DIR);
export const GetFixtureDocx = () => abs(FIXTURE_DOCX);
export const GetFixturePdf = () => abs(FIXTURE_PDF);
export const GetOriginalDir = () => abs(ORIGINAL_DIR);
export const GetOutputDocxDir = () => abs(OUTPUT_DOCX_DIR);
export const GetTreeDir = () => abs(TREE_DIR);
export const GetLogsDir = () => abs(LOGS_DIR);
export const GetDataDir = () => abs(DATA_DIR);
export const GetDbFile = () => abs(DB_FILE);
export const GetSchemaFile = () => abs(SCHEMA_FILE);
export const GetFrontendDir = () => abs(FRONTEND_DIR);
export function EnvCandidates() {
  return [SITE_ENV];
}
export function GetEnvCandidates() {
  return EnvCandidates().map((p) => abs(p));
}
export function inputDirFor(originalname = "") {
  const ext = originalname.split(".").pop().toLowerCase();
  if (ext === "txt") return INPUT_TXT;
  if (ext === "pdf") return INPUT_PDF;
  if (ext === "docx" || ext === "doc") return INPUT_DOCX;
  return INPUT_DIR;
}
export function ensurePraserDirs() {
  for (const dir of [
    INPUT_TXT,
    INPUT_PDF,
    INPUT_DOCX,
    QUARANTINE_DIR,
    RAW_TXT_DIR,
    ORIGINAL_DIR,
    OUTPUT_DOCX_DIR,
    TREE_DIR,
    LOGS_DIR,
    DATA_DIR,
  ]) {
    const target = abs(dir);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.chmodSync(target, 0o700);
  }
}
export function ensureDataDir() {
  const dir = path.dirname(abs(DB_FILE));
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!existed || dir === abs(DATA_DIR)) fs.chmodSync(dir, 0o700);
}
export function validatePraserAssets() {
  const required = [
    PRASER_MANAGER,
    `${PARSER_MODEL_DIR}/zawgyiUnicodeModel.dat`,
    `${PARSER_MODEL_DIR}/mya.traineddata`,
    `${PARSER_MAP_DIR}/cipher-map.json`,
    `${PARSER_MAP_DIR}/mm-score.json`,
    `${PARSER_MAP_DIR}/cleanup.json`,
    `${PARSER_MAP_DIR}/scan.json`,
    `${PARSER_MAP_DIR}/normalize-map.json`,
    `${PARSER_MAP_DIR}/zg2uni-rules.json`,
    `${PARSER_FONT_DIR}/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF`,
    `${PARSER_FONT_DIR}/used/AnonymousPro-Regular.ttf`,
    `${PARSER_FONT_DIR}/used/MyanmarSagar.ttf`,
  ];
  const missing = required.filter((file) => !fs.existsSync(abs(file)));
  if (missing.length) {
    throw new Error(`Parser assets missing after relocation:\n${missing.join("\n")}`);
  }
  return required.map(abs);
}