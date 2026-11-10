/*
(runtime/markup) The parsed result's shape: one marked-up string per
page. Parsing converts geometry and font evidence into this string
once, then coordinates are dropped - nothing downstream preserves
layout boundaries. Marks: <b> bold, <i> italic, <h1>/<h2> heading
(by font-size jump), \n line break, \n\n paragraph break. Content
escapes: & < > become &amp; &lt; &gt;. Writers render this string;
they never see coordinates.
*/

export function escapeMarkupText(text) {
  return String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function wrapFont(text, fontName) {
  const name = String(fontName ?? "").toLowerCase();
  let out = text;
  if (/italic|oblique/u.test(name)) out = `<i>${out}</i>`;
  if (/bold|black|heavy|semibold|demibold/u.test(name)) out = `<b>${out}</b>`;
  return out;
}

// lines: [x, y, size, text, font?] in reading order (geometry already
// judged upstream). y grows upward in PDF space: a baseline drop much
// larger than the line height is a paragraph break, not a line break.
export function linesToMarkup(lines) {
  const rows = (Array.isArray(lines) ? lines : [])
    .filter((line) => Array.isArray(line) && String(line[3] ?? "").trim() !== "");
  if (!rows.length) return "";
  const sizes = rows.map((line) => Number(line[2]) || 0).filter((s) => s > 0).sort((a, b) => a - b);
  const median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
  const out = [];
  let prevY = null;
  let prevSize = 0;
  for (const [, y, size, text, font] of rows) {
    const lineSize = Number(size) || median || 11;
    if (prevY !== null) {
      const gap = prevY - Number(y ?? prevY);
      out.push(gap > Math.max(prevSize, lineSize) * 2.2 ? "\n\n" : "\n");
    }
    let marked = escapeMarkupText(String(text).trim());
    if (median > 0 && lineSize >= median * 1.6) marked = `<h1>${marked}</h1>`;
    else if (median > 0 && lineSize >= median * 1.3) marked = `<h2>${marked}</h2>`;
    else marked = wrapFont(marked, font);
    out.push(marked);
    prevY = Number(y ?? prevY);
    prevSize = lineSize;
  }
  return out.join("");
}

// Plain text (DOCX chunks, OCR): every source paragraph becomes a
// markup paragraph; single newlines inside stay line breaks.
export function textToMarkup(text) {
  return String(text ?? "")
    .split(/\n{2,}/u)
    .map((para) => escapeMarkupText(para).split("\n").map((l) => l.trim()).join("\n"))
    .filter((para) => para !== "")
    .join("\n\n");
}

// Plain text that already carries inline marks (DOCX runs): escape the
// text but keep the <b>/<i> tags, mirroring textToMarkup's breaks.
const MARK_TAGS = new Set(["<b>", "</b>", "<i>", "</i>"]);
export function markedTextToMarkup(text) {
  const escapeParts = (line) => line
    .split(/(<\/?[bi]>)/gu)
    .map((part) => (MARK_TAGS.has(part) ? part : escapeMarkupText(part)))
    .join("");
  return String(text ?? "")
    .split(/\n{2,}/u)
    .map((para) => para.split("\n").map((l) => escapeParts(l.trim())).join("\n"))
    .filter((para) => para !== "")
    .join("\n\n");
}

export function pageToMarkup(page) {
  if (typeof page === "string") return textToMarkup(page);
  if (Array.isArray(page?.lines) && page.lines.length) {
    const marked = linesToMarkup(page.lines);
    if (marked) return marked;
  }
  return textToMarkup(page?.text ?? "");
}
