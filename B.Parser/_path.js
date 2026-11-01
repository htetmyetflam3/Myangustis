import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const COMPONENT_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const PARSED_ROOT = path.join(COMPONENT_ROOT, "main");
export const PARSER_DIR = path.join(PARSED_ROOT, "parser");
export const CORE_DIR = path.join(PARSER_DIR, "core");
export const REPO_ROOT = path.dirname(COMPONENT_ROOT);

async function resolveBaseDir() {
  try {
    const { JUNK_DIR } = await import("./_index.js");
    if (typeof JUNK_DIR !== "string" || !path.isAbsolute(JUNK_DIR)) {
      throw new TypeError("Expected an absolute workspace path");
    }
    return { base: JUNK_DIR, shared: true };
  } catch {
    return { base: COMPONENT_ROOT, shared: false };
  }
}

const resolved = await resolveBaseDir();
export const BASE_DIR = resolved.base;
export async function getLogen() {
  const entry = await import('./_index.js');
  return entry.getLogen();
}
export async function getEngineData() {
  const entry = await import('./_index.js');
  return entry.getEngineData();
}
export async function getEngineNormalize() {
  const entry = await import('./_index.js');
  return entry.getEngineNormalize();
}

export const RUNTIME_ROOT = resolved.shared ? path.join(BASE_DIR, "Parser") : COMPONENT_ROOT;
const FONT_ROOT = path.join(BASE_DIR, "fonts");

export const MAP_DIR = path.join(PARSER_DIR, "jason-map");
export const VECTOR_MAP_DIR = path.join(MAP_DIR, "vector");
export const MODEL_DIR = path.join(PARSER_DIR, "model");
export const OCR_MODEL_DIR = MODEL_DIR;

export const FONT_DIR = path.join(FONT_ROOT, "Unicode");
export const OUTPUT_FONT_DIR = path.join(FONT_ROOT, "used");
export const DEFAULT_MYANMAR_FONT = path.join(OUTPUT_FONT_DIR, "MyanmarSagar.ttf");

export const DEFAULT_OUTPUT_DIR = path.join(RUNTIME_ROOT, ".output");



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
  fs.mkdirSync(DEFAULT_OUTPUT_DIR, { recursive: true, mode: 0o700 });
}

ensureDirs();
export default RUNTIME_ROOT;
