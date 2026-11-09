#!/usr/bin/env node
/*
(Repair 13) Repair branch, position 13 in the chain - a build-time tool, not part of a live parse.
This module builds the expanded font-11 Burmese+Pali index SVG used as a glyph reference. Identical twin of B.Parser/core/repair/build-svg.js.
*/
/**
 * Build one expanded font-11 Burmese+Pali index SVG (build-time HarfBuzz shaping).
 * JS mirror of B.Parser/main/Python/make-index-font11.py.
 *
 * The A4 pages are stacked vertically in one SVG canvas (panel 1 at top,
 * then panel 2 below, then panel 3 below that).
 *
 * Order requested by the owner:
 *   1. Myanmar marks separately, omitting the standalone U+1039 entry;
 *   2. all base consonants from master MMap.Base;
 *   3. all Myanmar digits;
 *   4. all Burmese syllables from tools-box/js/scripts.db;
 *   5. Pali syllables for the SVG only: the stack parts filtered from the
 *      master dictionary (segments containing U+1039) plus the owner's given
 *      Pali list.
 *
 * E = 5.5, word slot = 3E = 16.5, spacing band = E = 5.5, pitch/cell = 22.
 * Pink cell border, blue bounded lines (baseline +/- E), yellow baseline.
 */

import { readFileSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const Database = (await import("better-sqlite3")).default;
import opentypeDefault from "opentype.js";
const opentype = opentypeDefault.default || opentypeDefault;
import { Blob, Face, Font, Buffer, shape } from "harfbuzzjs";

const SIZE = 11.0;
const E = SIZE * 0.5;
const PITCH = 22.0;
const BASELINE0 = 33.0;
const WIDTH = 595.276;
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 22.0;
const ROWS_PER_PAGE = 37;
const GAP = 3.206;

const MARKS = [
  "\u103B", "\u103C", "\u103D", "\u103E",
  "\u1031",
  "\u102D", "\u102E", "\u102F", "\u1030", "\u1032",
  "\u102C", "\u102B",
  "\u1036", "\u103A", "\u1037", "\u1038",
];

const BASE_CONSONANTS_MASTER_ORDER = [
  "က", "ခ", "ဂ", "ဃ", "င", "စ", "ဇ", "ည", "ဋ", "ဉ", "ဍ", "ဏ", "တ", "ထ", "ဒ", "န",
  "ပ", "ဖ", "ဗ", "ဘ", "မ", "ယ", "ရ", "လ", "သ", "ဟ", "အ", "ဥ", "ဧ", "ဈ", "ဝ", "ဓ",
  "ဩ", "ဿ", "ဣ", "ဦ", "ဠ", "ဌ", "ဆ", "ဎ", "ဪ", "၎",
];
const DIGITS = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];

const USER_GIVEN_PALI = [
  "\u1004\u103A\u1039\u1000",
  "\u1004\u103A\u1039\u1001",
  "\u1004\u103A\u1039\u1002",
  "\u1004\u103A\u1039\u1002\u102B",
  "\u1010\u1039\u1010\u1030",
  "\u1000\u1039\u1000\u1030",
  "\u1000\u1039\u1000\u102D\u102F",
  "\u1000\u103A\u103B\u102C\u1038",
  "\u1004\u103A\u1039\u101E\u1031\u1037",
  "\u1019\u1039\u1018\u102C",
  "\u1005\u1039\u1005\u100A\u103A\u1038",
  "\u1010\u102D\u1036",
  "\u1010\u1039\u1010\u102F",
  "\u1010\u1039\u1011\u102D",
];

function fmt(value, digits = 2) {
  const text = value.toFixed(digits);
  return ["-0", "-0.0", "-0.00", "-0.000"].includes(text) ? "0" : text;
}

function pathNumber(token) {
  const text = parseFloat(token).toFixed(3).replace(/\.?0+$/, "");
  return text === "" || text === "-0" ? "0" : text;
}

function roundPathNumbers(pathData) {
  const tokens = pathData.match(
    /[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.\d+(?:e-?\d+)?|-?\d+/g
  ) || [];
  const params = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, S: 4, T: 2, A: 7, Z: 0 };
  const out = [];
  let cmd = "";
  let firstGroup = true;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/[A-Za-z]/.test(token)) {
      cmd = token;
      firstGroup = true;
      out.push(cmd);
      i += 1;
      continue;
    }
    if (!cmd) {
      i += 1;
      continue;
    }
    const count = params[cmd.toUpperCase()];
    const group = tokens.slice(i, i + count);
    if (group.length < count) break;
    if (!firstGroup) {
      out.push(cmd === "M" ? "L" : cmd === "m" ? "l" : cmd);
    }
    group.forEach((part) => out.push(pathNumber(part)));
    firstGroup = false;
    i += count;
  }
  return out.join(" ").replace(/^ /, "").trim();
}

function attr(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function codepoints(text) {
  return [...text]
    .map((ch) => `U+${ch.codePointAt(0).toString(16).padStart(4, "0")}`)
    .join(" ");
}

function loadUnits(dbPath) {
  const db = new Database(dbPath, { readonly: true });

  const burmese = db
    .prepare("SELECT line FROM burmese_syllables ORDER BY id")
    .all()
    .map((row) => row.line);

  const masterRow = db.prepare("SELECT data FROM master_json WHERE id=1").get();
  const master = JSON.parse(masterRow.data);
  db.close();

  const dictionaryPali = [];
  const dictionarySeen = new Set();
  let dictionaryOccurrences = 0;
  let dictionaryEntries = 0;

  for (const entries of Object.values(master.dictionary)) {
    for (const entry of entries) {
      const hits = entry
        .trim()
        .split(/\s{2,}/)
        .filter((seg) => seg && seg.includes("\u1039"));
      if (hits.length) dictionaryEntries += 1;
      for (const seg of hits) {
        dictionaryOccurrences += 1;
        if (!dictionarySeen.has(seg)) {
          dictionarySeen.add(seg);
          dictionaryPali.push(seg);
        }
      }
    }
  }

  const pali = [...dictionaryPali];
  const userGivenCandidates = [];
  for (const text of USER_GIVEN_PALI) {
    if (!dictionarySeen.has(text)) {
      userGivenCandidates.push(text);
      pali.push(text);
    }
  }

  const bases = [...new Set(BASE_CONSONANTS_MASTER_ORDER)].sort(
    (a, b) => a.codePointAt(0) - b.codePointAt(0)
  );

  const groups = [
    ["mark", MARKS],
    ["consonant", bases],
    ["digit", DIGITS],
    ["syllable", burmese],
    ["pali", pali],
  ];

  const seen = new Set();
  const units = [];
  const counts = {};
  let duplicates = 0;

  for (const [kind, values] of groups) {
    let kept = 0;
    for (const text of values) {
      if (seen.has(text)) {
        duplicates += 1;
        continue;
      }
      seen.add(text);
      units.push({
        text,
        kind,
        cp: codepoints(text),
        newRowBefore: kept === 0 && units.length > 0,
      });
      kept += 1;
    }
    counts[kind] = kept;
  }

  counts.total = units.length;
  counts.duplicatesSkipped = duplicates;
  counts.burmeseRows = burmese.length;
  counts.dictionaryPaliUnique = dictionaryPali.length;
  counts.dictionaryPaliOccurrences = dictionaryOccurrences;
  counts.dictionaryPaliEntries = dictionaryEntries;
  counts.userGivenPali = USER_GIVEN_PALI.length;
  counts.userGivenPaliCandidates = userGivenCandidates.length;
  counts.userGivenPaliAdded = counts.pali - dictionaryPali.length;

  return { units, counts };
}

class Shaper {
  constructor(fontPath) {
    const fontData = readFileSync(fontPath);
    this.font = opentype.parse(fontData);
    this.upm = this.font.unitsPerEm || 2048;
    this.k = SIZE / this.upm;
    this.paths = new Map();
    this.notdefTexts = [];

    const blob = new Blob(fontData);
    const hbFace = new Face(blob);
    this.hbFont = new Font(hbFace);
  }

  glyphPath(gid) {
    if (this.paths.has(gid)) return this.paths.get(gid);

    const glyph = this.font.glyphs.get(gid);
    if (!glyph) return "";

    const path = glyph.path;
    const scale = this.k;
    let d = "";

    path.commands.forEach((cmd) => {
      const type = cmd.type;
      const x = cmd.x * scale;
      const y = -cmd.y * scale;
      const x2 = cmd.x2 !== undefined ? cmd.x2 * scale : 0;
      const y2 = cmd.y2 !== undefined ? -cmd.y2 * scale : 0;
      const x1 = cmd.x1 !== undefined ? cmd.x1 * scale : 0;
      const y1 = cmd.y1 !== undefined ? -cmd.y1 * scale : 0;

      switch (type) {
        case "M":
          d += `M${fmt(x)} ${fmt(y)} `;
          break;
        case "L":
          d += `L${fmt(x)} ${fmt(y)} `;
          break;
        case "Q":
          d += `Q${fmt(x2)} ${fmt(y2)} ${fmt(x)} ${fmt(y)} `;
          break;
        case "C":
          d += `C${fmt(x2)} ${fmt(y2)} ${fmt(x1)} ${fmt(y1)} ${fmt(x)} ${fmt(y)} `;
          break;
        case "Z":
          d += "Z ";
          break;
      }
    });

    const rounded = roundPathNumbers(d.trim());
    this.paths.set(gid, rounded);
    return rounded;
  }

  shape(text) {
    const buf = new Buffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    shape(this.hbFont, buf, [], []);

    const infos = buf.getGlyphInfos();
    const positions = buf.getGlyphPositions();

    let cursor = 0;
    const uses = [];
    let sawNotdef = false;

    for (let i = 0; i < infos.length; i++) {
      const gid = infos[i].codepoint;
      const pos = positions[i];
      const x = (cursor + pos.xOffset) * this.k;
      const y = -pos.yOffset * this.k;
      cursor += pos.xAdvance;

      if (gid === 0) sawNotdef = true;

      const glyphName = this.font.glyphs.get(gid)?.name;
      if (glyphName === "uni25CC") continue;

      const path = this.glyphPath(gid);
      if (path) {
        uses.push({ gid, x, y });
      }
    }

    if (sawNotdef) this.notdefTexts.push(text);

    return { uses, advance: cursor * this.k };
  }
}

function layout(units) {
  const sheets = [];
  let sheet = [];
  let row = 0;
  let cursorX = MARGIN_X;

  function startRow() {
    if (row + 1 >= ROWS_PER_PAGE) {
      sheets.push(sheet);
      sheet = [];
      row = 0;
    } else {
      row += 1;
    }
    cursorX = MARGIN_X;
  }

  for (const unit of units) {
    const advance = unit.advance + GAP;
    if (unit.newRowBefore && cursorX > MARGIN_X) {
      startRow();
    }
    if (cursorX + advance > WIDTH - MARGIN_X && cursorX > MARGIN_X) {
      startRow();
    }
    const placed = {
      ...unit,
      row,
      x: cursorX,
      baseline: BASELINE0 + row * PITCH,
    };
    sheet.push(placed);
    cursorX += advance;
  }
  if (sheet.length > 0) sheets.push(sheet);
  return sheets;
}

function ruleLine(y, x0 = 0, inset = 0.35) {
  return `<line x1="${fmt(x0 + inset)}" y1="${fmt(y)}" x2="${fmt(x0 + WIDTH - inset)}" y2="${fmt(y)}"/>`;
}

function mergedSvg(panels, shaper) {
  const totalHeight = PAGE_HEIGHT * panels.length;
  const allEntries = panels.flat();
  const usedGids = new Set();
  for (const entry of allEntries) {
    for (const use of entry.uses) {
      usedGids.add(use.gid);
    }
  }
  const sortedGids = [...usedGids].sort((a, b) => a - b);

  const defs = sortedGids
    .map((gid) => `<path id="g${gid}" d="${attr(shaper.paths.get(gid))}"/>`)
    .join("\n");

  const cells = [];
  const blue = [];
  const yellow = [];
  const bodyParts = [];
  const rules = [];
  const panelRows = [];

  for (let panelIndex = 0; panelIndex < panels.length; panelIndex++) {
    const entries = panels[panelIndex];
    const offsetY = panelIndex * PAGE_HEIGHT;
    const rows = [...new Set(entries.map((e) => e.row))].sort((a, b) => a - b);
    panelRows.push(rows.length);

    for (const r of rows) {
      const baseline = BASELINE0 + r * PITCH + offsetY;
      cells.push(
        `<rect id="p${panelIndex + 1}-line${r + 1}+gap" x="${fmt(MARGIN_X)}" y="${fmt(baseline - 2 * E)}" width="${fmt(WIDTH - 2 * MARGIN_X)}" height="${fmt(PITCH)}"/>`
      );
      blue.push(ruleLine(baseline, MARGIN_X, -E));
      blue.push(ruleLine(baseline, MARGIN_X, E));
      yellow.push(ruleLine(baseline, MARGIN_X, 0));
      rules.push([-2 * E, -E, 0, E, 2 * E].map((d) => fmt(baseline + d)).join(","));
    }

    for (const entry of entries) {
      const globalY = offsetY + entry.baseline;
      const uses = entry.uses
        .map(
          (use) =>
            `<use href="#g${use.gid}" x="${fmt(MARGIN_X + use.x)}" y="${fmt(globalY + use.y)}"/>`
        )
        .join("");
      bodyParts.push(
        `<g id="${attr(entry.text)}" data-kind="${attr(entry.kind)}" data-cp="${attr(entry.cp)}" data-row="${entry.row}" data-y="${fmt(globalY)}" data-baseline="${fmt(globalY)}">${uses}</g>`
      );
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Burmese+Pali index (font 11), one expanded SVG: ${panels.length} A4 panels stacked vertically.
     Panel 1 at top, then panel 2 below, then panel 3 below that.
     Order: marks separately (no standalone U+1039), base consonants, Myanmar digits,
     then Burmese syllables, then Pali syllables. SVG Pali is restricted to the
     dictionary U+1039 parts plus the owner-given list; it is not master syllables.pali.
     E = 5.5; word slot = 16.5 (baseline-11..baseline+5.5); spacing band = 5.5;
     line+gap cell/pitch = 22. Pink = shared cell border/end of spacing,
     blue = baseline +/- 5.5, yellow = baseline. Shaped with HarfBuzz at build time. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(WIDTH)}" height="${fmt(totalHeight)}" viewBox="0 0 ${fmt(WIDTH)} ${fmt(totalHeight)}"
     data-font="PYIDAUNGSU-2.5.2_REGULAR.TTF" data-shaped="harfbuzz" data-size="11" data-em="11"
     data-line-h="22" data-pitch="22" data-E="5.5" data-band="0.5" data-slot="16.5" data-cell="22" data-spacing="5.5"
     data-layout="vertical-a4-panels" data-panels="${panels.length}" data-pages="${panels.length}" data-panel-height="${fmt(PAGE_HEIGHT)}"
     data-rows="${Math.max(...panelRows, 0)}" data-total-rows="${panelRows.reduce((a, b) => a + b, 0)}" data-rows-per-page="${ROWS_PER_PAGE}"
     data-baseline0="33" data-count="${allEntries.length}" data-glyphs="${sortedGids.length}" data-rules="${attr(rules.join(";"))}">
<title>Pyidaungsu Burmese+Pali index — font 11, ${panels.length} A4 panels stacked vertically</title>
<rect x="0" y="0" width="${fmt(WIDTH)}" height="${fmt(totalHeight)}" fill="#FFFFFF"/>
<g id="lines" fill="#E5E5E5" stroke="#FF6EAE" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round">${cells.join("")}</g>
<defs>
${defs}
</defs>
<g fill="#000000" fill-rule="evenodd">
${bodyParts.join("")}
</g>
<g id="bounded" stroke="#77BDFD" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${blue.join("")}</g>
<g id="baselinegroup" stroke="#FFFF00" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${yellow.join("")}</g>
</svg>`;
}

async function main() {
  const args = process.argv.slice(2);
  let fontPath = resolve("Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF");
  let dbPath = resolve("tools-box/js/scripts.db");
  let outPath = resolve("B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali.svg");

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--font") fontPath = resolve(args[++i]);
    else if (args[i] === "--db") dbPath = resolve(args[++i]);
    else if (args[i] === "--out") outPath = resolve(args[++i]);
  }

  const { units, counts } = loadUnits(dbPath);
  const shaper = new Shaper(fontPath);

  for (const unit of units) {
    Object.assign(unit, shaper.shape(unit.text));
  }

  const panels = layout(units);

  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, mergedSvg(panels, shaper), { encoding: "utf8" });

  console.log(JSON.stringify({
    counts,
    file: outPath,
    width: WIDTH,
    height: PAGE_HEIGHT * panels.length,
    panels: panels.map((entries, i) => ({
      panel: i + 1,
      yOffset: i * PAGE_HEIGHT,
      entries: entries.length,
      rows: [...new Set(entries.map((e) => e.row))].length,
    })),
    distinctGlyphs: shaper.paths.size,
    notdefTexts: shaper.notdefTexts,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
