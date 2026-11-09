/*
(praised/decoding) finish: the shared page-record finishing.
Both decoding branches land here: a decoded page record (from the
PDF branch) or a paragraph chunk (from the DOCX branch) is scored,
cleaned and ordered into its final form. The two branches are
separations only - neither re-checks the other; which method a
page takes is decided by judgement (praised/rule/judgement.js),
and orderText's own home (the old clean.js) is judgement-side
territory to restore.
*/
import fs from "node:fs";
import { containsMyanmar, hasOnlyZawgyiFonts, hasOnlyUnicodeFonts } from "../rule/detect.js";
import { Rabbit } from "../rule/rabbit.js";
import { orderText } from "../rule/clean.js";
import { preserveCharacters, instructionLane, scoreText } from "../rule/judgement.js";
export { instructionLane };
import { countImpossiblePairs } from "../../beautify/scan.js";
import { WININNWA_LEGACY_CODE_PAGE } from "./method/codepage-registry.js";
import {
  cleanupUnicodeText as cleanupUnicode, convertFinalizedPageText,
  finishPageToFile, orderUnicodeText as orderUnicode, pageLayoutLines,
} from "./method/finalized-cmap.js";
import { legacyLayoutForFont } from "./pdf/font/pdf-fonts.js";
import { agentAdvisory } from "../../../../Architecture/host/advisory.js";

const PARSER_CHAIN_DOOR = "ParserManager";

function adviseParserMiddleChain(api) {
  if (process.env.MYANGUSTIS_CHAIN_DOOR === PARSER_CHAIN_DOOR) return;
  agentAdvisory(
    "parser-middle-chain",
    `[Parser agent advisor] STOP: B.Parser/core/praised/decoding/finish.js:${api}() is a middle-chain API, not the Parser chain door. `
      + "Start from B.Parser/index.js (Manager.dispatchStream/Manager.dispatch) or "
      + "tools-box/js/pipeline-cli.js parser local, and report only that front-door behavior. "
      + "Calling pipeline/text/read helpers directly skips Manager spooling, worker preparation, output/POS sidecars and cleanup options.",
  );
}


const orderZawgyi = (text) => preserveCharacters(text, (part) => orderText(Rabbit.zg2uni(part)));

export function cleanupFor(cat, text) {
  return cat === "UNICODE" ? cleanupUnicode(text) : null;
}


function convertLine(t, cat, applyCleanup) {
  if (cat === "ZAWGYI") return orderZawgyi(t);
  if (cat === "UNICODE") return applyCleanup ? cleanupUnicode(t) : orderUnicode(t);
  return orderText(t);
}
function convLines(lines, cat, applyCleanup) {
  return lines.map(([x, y, size, t]) => [x, y, size, convertLine(t, cat, applyCleanup)]);
}


export function countDiffLines(base, clean) {
  const bl = base.split("\n");
  const cl = clean.split("\n");
  const n = Math.max(bl.length, cl.length);
  let count = 0;
  for (let i = 0; i < n; i += 1) {
    if ((i < bl.length ? bl[i] : "") !== (i < cl.length ? cl[i] : "")) count += 1;
  }
  return count;
}


export function processPageRecord(pg, applyCleanup, log = () => {}, wantLayout = false, sourceEncoding = "auto") {
  adviseParserMiddleChain("processPageRecord");
  const idx = pg.idx;
  const raw = pg.text;
  if (pg.perFont) {
    const kinds = pg.fontKinds || new Set();
    const cat = pg.category ?? (kinds.size === 1 ? [...kinds][0] : "UNKNOWN");
    const finalized = pg.pageFinalized === true;
    const text = finalized && typeof raw === "string"
      ? convertFinalizedPageText(raw, pg, applyCleanup !== false) : raw;
    const rep = { page: idx + 1, category: cat, prob: cat === "ZAWGYI" ? 1 : 0,
      text, nChanges: typeof raw === "string" && text !== raw ? countDiffLines(raw, text) : 0,
      perFont: true, pageFinalized: finalized,
      scanEligible: !finalized && kinds.size > 0 && !kinds.has("UNKNOWN"),
      ...(pg.decision === "zawcode" ? { textPath: "zawcode" } : {}),
      ...(pg.checkpoint ? { checkpoint: pg.checkpoint } : {}),
      ...(pg.confirmedRepair ? { confirmedRepair: pg.confirmedRepair } : {}),
      ...(pg.warnings?.length ? { warnings: pg.warnings } : {}) };
    if (wantLayout) {
      rep.lines = finalized && Array.isArray(pg.lines)
        ? pg.lines.map(([x, y, size, line]) => [x, y, size,
          convertFinalizedPageText(line, pg, applyCleanup !== false)])
        : pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
      rep.images = pg.images;
      rep.parsingPath = pg.parsingPath;
    }
    return rep;
  }
  // No detector: the category is whatever the per-page parsing decided
  // (2 KB checkpoint -> page parser -> page decision/category). A record
  // that carries no category from that parsing is UNKNOWN and passes
  // through; font names alone never classify it here.
  const [category, prob] = sourceEncoding === "auto" && pg.legacyDecoded
    ? ["UNICODE", 0]
    : [pg.category ?? "UNKNOWN", pg.category === "ZAWGYI" ? 1 : 0];
  let cat = String(category).toUpperCase();
  if (cat === "OTHER") cat = "UNKNOWN";
























  if (cat === "ZAWGYI" && sourceEncoding !== "zawgyi-one"
    && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
    const asUnicode = scoreText(orderText(raw));
    const asZawgyi = scoreText(orderText(Rabbit.zg2uni(raw)));
    if (asUnicode.marks >= 50 && asZawgyi.score - asUnicode.score >= 0.03) {
      log(`    Page ${idx + 1}: zawgyi-cmap path -- decoded from the font's own `
        + `${pg.decodeKind} table but still Zawgyi: Rabbit reading scores `
        + `${asZawgyi.score.toFixed(3)} vs ${asUnicode.score.toFixed(3)} as Unicode`);
    } else {
      cat = "UNICODE";
      log(`    Page ${idx + 1}: unicode path -- ${category} verdict overridden; `
        + `decoded from the font's own ${pg.decodeKind} table and reads as itself `
        + `(${asUnicode.score.toFixed(3)} vs ${asZawgyi.score.toFixed(3)} converted), `
        + `so this is Unicode in drawing order, not Zawgyi`);
    }
  }

  if (cat === "UNKNOWN") {



    const rep = {
      page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, text: raw, nChanges: 0,
    };
    if (wantLayout) {
      rep.lines = pg.lines;
      rep.wh = pg.wh;
      rep.hasImg = pg.hasImg;
    }
    log(`    Page ${idx + 1}: UNKNOWN -> passed through`);
    return rep;
  }

  let base;
  if (cat === "ZAWGYI") {
    base = orderZawgyi(raw);
    if (hasOnlyZawgyiFonts(pg.fontNames) && (pg.decodeKind === "cmap" || pg.decodeKind === "tounicode")) {
      log(`    Page ${idx + 1}: zawgyi-cmap path -- Zawgyi-One font evidence -> converted`);
    } else {
      log(`    Page ${idx + 1}: ZAWGYI (font/source evidence) -> converted`);
    }
  } else {
    base = orderUnicode(raw);
    log(`    Page ${idx + 1}: UNICODE (source evidence) -> kept`);
  }

  const clean = cleanupFor(cat, base);
  const nChanges = clean === null || clean === base ? 0 : countDiffLines(base, clean);
  const text = applyCleanup && clean !== null ? clean : base;
  const rep = {
    page: idx + 1, category: cat, prob: Number.isFinite(prob) ? prob : 0, text, nChanges,
  };
  if (wantLayout) {
    rep.lines = convLines(pg.lines, cat, applyCleanup);
    rep.wh = pg.wh;
    rep.hasImg = pg.hasImg;
  }
  return rep;
}


export function collectChanges(reports) {
  const changes = [];
  for (const rep of reports) {
    if (rep.clean === null) continue;
    const baseLines = rep.base.split("\n");
    const cleanLines = rep.clean.split("\n");
    for (let li = 0; li < Math.max(baseLines.length, cleanLines.length); li += 1) {
      const bl = li < baseLines.length ? baseLines[li] : "";
      const cl = li < cleanLines.length ? cleanLines[li] : "";
      if (bl !== cl) {
        changes.push({
          id: `p${rep.page}-l${li + 1}`,
          page: rep.page,
          line: li + 1,
          category: rep.category,
          original: bl,
          suggested: cl,
        });
      }
    }
  }
  return changes;
}


export function buildFinalPages(job, applyCleanup) {
  adviseParserMiddleChain("buildFinalPages");
  const out = [];
  const len = Math.min(job.pages.length, job.reports.length);
  for (let i = 0; i < len; i += 1) {
    const pg = job.pages[i];
    const rep = job.reports[i];
    if (!("lines" in pg)) {
      out.push({
        text: applyCleanup && rep.clean !== null && rep.clean !== undefined ? rep.clean : pg.text,
      });
      continue;
    }
    if (applyCleanup && rep.clean !== null && rep.clean !== undefined) {
      out.push({
        text: rep.clean,
        lines: pg.lines.map(([x, y, s, t]) => [x, y, s, cleanupUnicode(t)]),
        wh: pg.wh,
        hasImg: pg.hasImg,
        images: pg.images,
        parsingPath: pg.parsingPath,
      });
    } else {
      out.push({ text: pg.text, lines: pg.lines, wh: pg.wh, hasImg: pg.hasImg,
        images: pg.images, parsingPath: pg.parsingPath });
    }
  }
  return out;
}
