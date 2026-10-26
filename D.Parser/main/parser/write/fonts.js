import path from "node:path";
import fs from "node:fs";
import { OUTPUT_FONT_DIR } from "../core/paths.mjs";
import { pyLen } from "../core/pylib.mjs";

export const ANONYMOUS_PRO_FILES = {
  "": path.join(OUTPUT_FONT_DIR, "AnonymousPro-Regular.ttf"),
  B: path.join(OUTPUT_FONT_DIR, "AnonymousPro-Bold.ttf"),
  I: path.join(OUTPUT_FONT_DIR, "AnonymousPro-Italic.ttf"),
  BI: path.join(OUTPUT_FONT_DIR, "AnonymousPro-BoldItalic.ttf"),
};





export const BURMESE_FONTS = {
  MyanmarSagar: {
    files: { "": "MyanmarSagar.ttf" },
    docx: "Myanmar Sagar",
  },
};

export const DEFAULT_BURMESE_KEY = "MyanmarSagar";
export const FONT_ROLES = {
  title: {
    english_style: "B", burmese: DEFAULT_BURMESE_KEY,
    bold: true, size: 14, char_spacing: 0.2, line_spacing: 1.4,
    color: [40, 40, 40], align: "L",
  },
  heading: {
    english_style: "B", burmese: DEFAULT_BURMESE_KEY,
    bold: true, size: 12, char_spacing: 0.15, line_spacing: 1.5,
    color: [60, 60, 60], align: "L",
  },
  paragraph: {
    english_style: "", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 11, char_spacing: 0.35, line_spacing: 1.7,
    color: [0, 0, 0], align: "L",
  },
  bold: {
    english_style: "B", burmese: DEFAULT_BURMESE_KEY, bold: true,
    size: 11, char_spacing: 0.3, line_spacing: 1.7,
    color: [0, 0, 0], align: "L",
  },
  italic: {
    english_style: "I", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 11, char_spacing: 0.3, line_spacing: 1.7,
    color: [0, 0, 0], align: "L",
  },
  page_number: {
    english_style: "", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 9, char_spacing: 0.2, line_spacing: 1.4,
    color: [120, 120, 120], align: "C",
  },
  meta: {
    english_style: "", burmese: DEFAULT_BURMESE_KEY, bold: false,
    size: 8, char_spacing: 0.15, line_spacing: 1.4,
    color: [100, 100, 100], align: "L",
  },
};

const PAGE_MARKER_RE = /^\s*---\s*Page\s+\d+\s*---\s*$/;
const TRAILING_PUNCT_RE = /[.!?\u104a\u104b,;:]+$/;


export function classifyTextRole(line, prevBlank = true) {
  const s = String(line).trim();
  if (!s) return "blank";
  if (PAGE_MARKER_RE.test(s)) return "page_number";
  const noPunct = !TRAILING_PUNCT_RE.test(s);
  const len = pyLen(s); 
  if (prevBlank && len >= 2 && len <= 60 && noPunct) return "heading";
  return "paragraph";
}

export function burmeseFontKey(role) {
  void role;
  return DEFAULT_BURMESE_KEY;
}


export function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}


export function registerPdfFonts(pdf) {
  for (const [style, file] of Object.entries(ANONYMOUS_PRO_FILES)) {
    if (isFile(file)) pdf.addFont("AnonymousPro", style, file);
  }
  for (const [key, spec] of Object.entries(BURMESE_FONTS)) {
    for (const [style, fname] of Object.entries(spec.files)) {
      const file = path.join(OUTPUT_FONT_DIR, fname);
      if (isFile(file)) pdf.addFont(key, style, file);
    }
  }
}

export function applyPdfRole(pdf, role, useEnglish = true) {
  const cfg = FONT_ROLES[role];
  if (useEnglish) pdf.setFont("AnonymousPro", cfg.english_style, cfg.size);
  else pdf.setFont(DEFAULT_BURMESE_KEY, "", cfg.size);
  pdf.setFallbackFonts([DEFAULT_BURMESE_KEY]);
  pdf.setCharSpacing(cfg.char_spacing);
  if (cfg.color) pdf.setTextColor(...cfg.color);
}
