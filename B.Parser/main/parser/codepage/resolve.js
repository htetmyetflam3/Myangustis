import { getLogen } from "../../../_path.js";
const { emitEvent } = (await getLogen()).coreLog;

































import fs from "node:fs";

import { orderText } from "../text/normalize.js";
import { scoreText } from "../text/mm-score.js";
import {
  extractPageLines, parsePdfObjects, getStream, parseToUnicodeStream,
} from "../read/pdf-extract.js";
import { DocumentDecoding, detectLegacyLayoutFonts } from "../read/pdf-fonts.js";
import { LEGACY_CODE_PAGES, UNICODE_PATH } from "./registry.js";
import { buildVectorOutlineLayout } from "./vector-repair.js";





export const LEGACY_QUALITY_FLOOR = 0.85;

const CODE_PAGE_PROBE_PAGES = 6;

export function chooseCodePage(objects, allPages, legacyMap, codePages = LEGACY_CODE_PAGES, vectorLayout = null, unicodeStrategy = null) {
  const ranking = [];





  const samples = new Map();








  const ledger = { candidates: 0, zeroedForFewMarks: 0, pagesAsked: 0, pagesUsed: 0, pagesFailed: 0, marks: 0 };





  const scoreStrategy = (name, strategy) => {
    ledger.candidates += 1;
    const chunks = [];
    for (const [pnum, pgen] of allPages.slice(0, CODE_PAGE_PROBE_PAGES)) {
      ledger.pagesAsked += 1;
      let plines;
      try {
        [plines] = extractPageLines(objects, pnum, pgen, strategy);
      } catch {
        ledger.pagesFailed += 1;
        continue;
      }
      ledger.pagesUsed += 1;
      chunks.push(plines.map((x) => x[3]).join("\n"));
    }
    const sample = chunks.join("\n");
    const result = scoreText(orderText(sample));
    const zeroed = result.marks < 50;
    if (zeroed) ledger.zeroedForFewMarks += 1;
    ledger.marks = Math.max(ledger.marks, result.marks);
    samples.set(name, sample);
    ranking.push([name, zeroed ? 0.0 : result.score]);
  };

  for (const [name, table] of codePages) {
    scoreStrategy(name, new DocumentDecoding("legacy", legacyMap, table, {
      legacyFontNames: vectorLayout && name === vectorLayout.name
        ? [vectorLayout.fontName, ...(vectorLayout.sourceBaseFonts || [])]
        : null,
    }));
  }





  if (unicodeStrategy) scoreStrategy(UNICODE_PATH, unicodeStrategy);

  ranking.sort((a, b) => b[1] - a[1]);
  const [bestName, bestScore] = ranking[0];


  emitEvent('codepage', {
    ...ledger,
    chosen: bestName,
    score: bestScore,
    floor: LEGACY_QUALITY_FLOOR,
    accepted: bestScore >= LEGACY_QUALITY_FLOOR,
    ranking: ranking.map(([n, sc]) => `${n}=${sc.toFixed(3)}`),
  });

  return [codePages.get(bestName), bestName, bestScore, ranking, samples];
}









export async function prepareVectorLayout(source, log = () => {}) {
  const input = Buffer.isBuffer(source) || source instanceof Uint8Array
    ? (Buffer.isBuffer(source) ? source : Buffer.from(source))
    : fs.readFileSync(source);
  let objects;
  try {
    objects = parsePdfObjects(input);
  } catch {
    return null;
  }
  const legacyFonts = detectLegacyLayoutFonts(objects, getStream, parseToUnicodeStream);
  if (!legacyFonts.length) return null;
  return buildVectorOutlineLayout(input, LEGACY_CODE_PAGES, { objects, legacyFonts, log });
}
