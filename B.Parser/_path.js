import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const COMPONENT_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PARSED_ROOT = path.join(COMPONENT_ROOT, "main");
export const PARSER_DIR = path.join(PARSED_ROOT, "parser");
export const CORE_DIR = path.join(PARSER_DIR, "core");
export const REPO_ROOT = path.dirname(COMPONENT_ROOT);

async function resolveBaseDir() {
  const rootExporter = path.join(REPO_ROOT, "index-path.js");
  const componentExporter = path.join(COMPONENT_ROOT, "_index.js");
  if (fs.existsSync(rootExporter) && fs.existsSync(componentExporter)) {
    try {
      const { JUNK_DIR } = await import("./_index.js");
      if (typeof JUNK_DIR !== "string" || !path.isAbsolute(JUNK_DIR)) {
        throw new TypeError("Expected an absolute workspace path");
      }
      return JUNK_DIR;
    } catch {
      // Missing or unloadable upstream exporters use this file's location.
    }
  }
  return COMPONENT_ROOT;
}

export const BASE_DIR = await resolveBaseDir();
// Only the base changes between layouts; suffixes stay identical.
export const RUNTIME_ROOT = path.join(BASE_DIR, "Parser");
const FONT_ROOT = path.join(BASE_DIR, "fonts");

export const UPLOAD_DIR = path.join(RUNTIME_ROOT, "upload");
export const INPUT_DIR = path.join(UPLOAD_DIR, "input");

export const MAP_DIR = path.join(PARSER_DIR, "jason-map");
export const VECTOR_MAP_DIR = path.join(MAP_DIR, "vector");
export const MODEL_DIR = path.join(PARSER_DIR, "model");
export const DEFAULT_MODEL_PATH = path.join(MODEL_DIR, "zawgyiUnicodeModel.dat");
export const OCR_MODEL_DIR = MODEL_DIR;

export const FONT_DIR = path.join(FONT_ROOT, "Unicode");
export const OUTPUT_FONT_DIR = path.join(FONT_ROOT, "used");
export const DEFAULT_MYANMAR_FONT = path.join(OUTPUT_FONT_DIR, "MyanmarSagar.ttf");

export const DEFAULT_OUTPUT_DIR = path.join(RUNTIME_ROOT, ".output");

/* Append-only provenance register (core/provenance.mjs). Authoring equipment:
   remove this line when the register goes. */
export const REGISTER_LOG = path.join(DEFAULT_OUTPUT_DIR, "praser-register.log");

const LATIN_FONT_CANDIDATES = [
  path.join(OUTPUT_FONT_DIR, "AnonymousPro-Regular.ttf"),
  path.join(FONT_DIR, "DejaVuSans.ttf"),
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans.ttf",
  "C:/Windows/Fonts/arial.ttf",
  "/System/Library/Fonts/Supplemental/Arial.ttf",
];

const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export function findModelPath() {
  const candidates = [
    process.env.ZAWGYI_MODEL,
    DEFAULT_MODEL_PATH,
    path.join(PARSER_DIR, "zawgyiUnicodeModel.dat"),
    path.join(PARSED_ROOT, "zawgyiUnicodeModel.dat"),
  ];
  for (const cand of candidates) {
    if (cand && isFile(cand)) return cand;
  }
  return DEFAULT_MODEL_PATH;
}

export function findMyanmarFont() {
  const candidates = [
    DEFAULT_MYANMAR_FONT,
    path.join(OUTPUT_FONT_DIR, "Aka02-Regular.ttf"),
    path.join(FONT_DIR, "PYIDAUNGSU-2.5.2_REGULAR.TTF"),
    path.join(FONT_DIR, "Padauk.ttf"),
    path.join(FONT_DIR, "Ayar.ttf"),
    path.join(FONT_DIR, "MyanmarThuriya.ttf"),
    path.join(FONT_DIR, "YoeYar-One_Regular.ttf"),
  ];
  for (const cand of candidates) {
    if (isFile(cand)) return cand;
  }
  if (fs.existsSync(FONT_DIR)) {
    const ttf = fs
      .readdirSync(FONT_DIR)
      .filter((f) => f.toLowerCase().endsWith(".ttf"))
      .sort();
    if (ttf.length) return path.join(FONT_DIR, ttf[0]);
  }
  return DEFAULT_MYANMAR_FONT;
}

export function findLatinFont() {
  for (const cand of LATIN_FONT_CANDIDATES) {
    if (isFile(cand)) return cand;
  }
  return null;
}

export function ensureDirs() {
  for (const dir of [
    UPLOAD_DIR, INPUT_DIR,
    ...["txt", "pdf", "docx"].map(kind => path.join(INPUT_DIR, kind)),
    path.join(UPLOAD_DIR, "pdf"), path.join(UPLOAD_DIR, "docx"),
    path.join(UPLOAD_DIR, "quarantine"),
    DEFAULT_OUTPUT_DIR,
    ...["txt", "original", "docx", ".tree"].map(kind => path.join(DEFAULT_OUTPUT_DIR, kind)),
    FONT_DIR, OUTPUT_FONT_DIR,
  ]) fs.mkdirSync(dir, { recursive: true });
}

ensureDirs();
export default RUNTIME_ROOT;
