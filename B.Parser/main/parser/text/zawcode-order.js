import { getMasterMapData } from "./cleanup.js";
import { normalizePageLines } from "./preserved-transform.js";

const E = "\u1031";
const YA = "\u103B";
const RA = "\u103C";

let engineBases = null;
function isEngineBase(ch) {
  if (!ch) return false;
  if (engineBases === null) {
    const bases = getMasterMapData().MMap?.Base;
    if (!Array.isArray(bases)) throw new Error("Engine master is missing MMap.Base");
    engineBases = new Set(bases);
  }
  return engineBases.has(ch);
}

// Index each line once. Position 0 is the unchanged character immediately
// before a pattern (or a virtual boundary at the start of a line).
export function arrangeZawCodeOrder(text) {
  if (typeof text !== "string") throw new TypeError("Expected text");
  const chars = Array.from(text);
  const out = [];

  for (let i = 0; i < chars.length;) {
    const current = chars[i];
    const next = chars[i + 1];
    const after = chars[i + 2];
    const fourth = chars[i + 3];
    const fifth = chars[i + 4];

    // The position immediately before a pattern must not be e.
    if (chars[i - 1] !== E) {
      if (current === E && isEngineBase(next) && isEngineBase(after) && fourth === YA) {
        out.push(next, E, after, YA);
        i += 4;
        continue;
      }
      if (current === RA && isEngineBase(next) && after === E && fourth === RA && isEngineBase(fifth)) {
        out.push(next, RA, fifth, RA, E);
        i += 5;
        continue;
      }
      if (current === E && isEngineBase(next) && after === YA) {
        out.push(next, YA, E);
        i += 3;
        continue;
      }
      if (current === E && next === RA && isEngineBase(after)) {
        out.push(after, RA, E);
        i += 3;
        continue;
      }
      if (current === RA && isEngineBase(next)) {
        out.push(next, RA);
        i += 2;
        continue;
      }
      if (current === E && isEngineBase(next)) {
        out.push(next, E);
        i += 2;
        continue;
      }
    }

    out.push(current);
    i += 1;
  }
  return out.join("");
}

// This is called only after a ZawCode scan verdict. The supplied function is
// Engine's normalize, not mapperNormalize; each text line is handled alone.
export function orderZawCodePages(pages, report, { path = null, normalize } = {}) {
  if (path !== "zawcode" || !report) return pages;
  if (typeof normalize !== "function") throw new TypeError("Expected Engine normalize function");
  const orderTextLines = (text) => [...normalizePageLines(
    arrangeZawCodeOrder(String(text ?? "")), normalize,
  )].join("\n");

  return pages.map((page) => {
    const originalText = String(page?.text ?? "");
    let lines = page?.lines;
    let text;
    if (Array.isArray(lines)) {
      const originalLines = lines.map((line) => String(line[3] ?? "")).join("\n");
      lines = lines.map((line) => {
        const ordered = [...line];
        ordered[3] = orderTextLines(line[3]);
        return ordered;
      });
      text = originalLines === originalText
        ? lines.map((line) => line[3]).join("\n")
        : orderTextLines(originalText);
    } else {
      text = orderTextLines(originalText);
    }
    const linesChanged = Array.isArray(lines)
      && lines.some((line, i) => line[3] !== page.lines[i][3]);
    if (text === originalText && !linesChanged) return page;
    return { ...page, text, ...(Array.isArray(lines) ? { lines } : {}) };
  });
}
