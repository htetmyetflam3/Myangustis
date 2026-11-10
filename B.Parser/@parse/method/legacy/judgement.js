/*
(Legacy judgement) Legacy lane, no chain position - the legacy lane's own
judgement layer, for a font whose name is unknown.

This layer does not decode Unicode, and it does not decode the legacy
lane. It only decides between Ayar and WinInnwa: the caller decodes the
same page sample under each code page, and this layer scores which
reading is real Burmese and returns the winning page. It is called only
when the name gate could not name the family (legacyFontFamily -> null);
a known name never reaches here, and no lane is chosen here - the font
is already inside the legacy lane when this runs.

Restored from the lost extend/codepage-resolve.js chooseCodePage
(removed from git in c258baa): probe, score both tables, rank, accept
only above the quality floor. The vector-layout and logging parts of
the original are not restored - they belonged to the old extend house.
*/

import { scoreText } from "../../../core/@rule/judgement.js";
import { orderText } from "../../../core/@postprocess/beautify/clean.js";
import { LEGACY_CODE_PAGES } from "./codepage-registry.js";

export const LEGACY_QUALITY_FLOOR = 0.85;

// A reading with fewer marks than this is not evidence; it scores zero.
const MIN_PROBE_MARKS = 50;

// decodeSample(codePage, name) -> the sample text decoded under that
// code page (the caller owns all decoding). Returns the decision only:
// { codePage, name, score, accepted, ranking, samples }.
export function decideLegacyFamily(decodeSample, codePages = LEGACY_CODE_PAGES) {
  const ranking = [];
  const samples = new Map();
  for (const [name, codePage] of codePages) {
    let sample = "";
    try {
      sample = String(decodeSample(codePage, name) ?? "");
    } catch {
      sample = "";
    }
    samples.set(name, sample);
    const result = scoreText(orderText(sample));
    ranking.push([name, result.marks < MIN_PROBE_MARKS ? 0 : result.score]);
  }
  ranking.sort((a, b) => b[1] - a[1]);
  if (!ranking.length) {
    return { codePage: null, name: null, score: 0, accepted: false, ranking, samples };
  }
  const [name, score] = ranking[0];
  return {
    codePage: codePages.get(name),
    name,
    score,
    accepted: score >= LEGACY_QUALITY_FLOOR,
    ranking,
    samples,
  };
}
