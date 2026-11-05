// make-index-font11.js — Build one expanded font-11 Burmese+Pali index SVG.
//
// JS port of B.Parser/main/Python/make-index-font11.py. Same constants, same layout, same
// SVG output. Shapes with harfbuzzjs + fontkit at build time instead of
// uharfbuzz + fontTools.
//
// The A4 pages are not separate files: they are placed side by side
// horizontally in one SVG canvas (panel 1 at the left, then panel 2, panel 3,
// ...).
//
// Order requested by the owner:
//   1. Myanmar marks separately, omitting the standalone U+1039 entry;
//   2. all base consonants from master MMap.Base;
//   3. all Myanmar digits;
//   4. all Burmese syllables from tools-box/js/scripts.db;
//   5. Pali syllables for the SVG only: the stack parts filtered from the
//      master dictionary (segments containing U+1039) plus the owner's given
//      Pali list. This deliberately does NOT use master syllables.pali.
//
// The visual frame follows the owner's line+gap sketch at font size 11:
// E = 5.5, word slot = 3E = 16.5, spacing band = E = 5.5, pitch/cell = 22.
// Pink is the shared cell border (end of spacing / start of next cell), the
// two inner bounded lines are blue, and the baseline is yellow.

import fs from "node:fs";
import { createRequire } from "node:module";
import * as hb from "harfbuzzjs";

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");
const Database = require("better-sqlite3");

const ROOT = new URL("../", import.meta.url).pathname;
const DEFAULT_FONT = `${ROOT}Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF`;
const DEFAULT_DB = `${ROOT}tools-box/js/scripts.db`;
const DEFAULT_OUT = `${ROOT}B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali.svg`;

const SIZE = 11.0;
const E = SIZE * 0.5;
const SLOT = 3 * E;
const PITCH = 22.0;
const BASELINE0 = 33.0;
const WIDTH = 595.276; // width of one A4 panel; total SVG width = WIDTH * panel count
const PAGE_HEIGHT = 841.89;
const MARGIN_X = 22.0;
const ROWS_PER_PAGE = 37;
const GAP = 3.206; // old 7 pt sheet median inter-entry gap (2.04) scaled to 11 pt

// Owner slot order (as in MARK_ORDER: asat before dot-below), without U+1039.
const MARKS = [
  "\u103B", "\u103C", "\u103D", "\u103E", // medials ya/ra/wa/ha
  "\u1031", // e
  "\u102D", "\u102E", "\u102F", "\u1030", "\u1032", // i/ii/u/uu/ai
  "\u102C", "\u102B", // aa/tall aa
  "\u1036", "\u103A", "\u1037", "\u1038", // anusvara/asat/dot/visarga
];

// Master MMap.Base (42), as copied for the combined list.
const BASE_CONSONANTS_MASTER_ORDER = [
  "က", "ခ", "ဂ", "ဃ", "င", "စ", "ဇ", "ည", "ဋ", "ဉ", "ဍ", "ဏ", "တ", "ထ", "ဒ", "န",
  "ပ", "ဖ", "ဗ", "ဘ", "မ", "ယ", "ရ", "လ", "သ", "ဟ", "အ", "ဥ", "ဧ", "ဈ", "ဝ", "ဓ",
  "ဩ", "ဿ", "ဣ", "ဦ", "ဠ", "ဌ", "ဆ", "ဎ", "ဪ", "၎",
];
const DIGITS = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"];

// Owner-given Pali list for the SVG. Keep the exact sequences: in particular
// "က်ျား" is U+1000 U+103A U+103B U+102C U+1038 here, not clean Burmese
// "ကျား" (U+1000 U+103B U+102C U+1038). "တိံ" is in the owner's list too, but
// it is already present in Burmese syllables, so de-duplication keeps one entry.
const USER_GIVEN_PALI = [
  "\u1004\u103A\u1039\u1000", // င်္က
  "\u1004\u103A\u1039\u1001", // င်္ခ
  "\u1004\u103A\u1039\u1002", // င်္ဂ
  "\u1004\u103A\u1039\u1002\u102B", // င်္ဂါ
  "\u1010\u1039\u1010\u1030", // တ္တူ
  "\u1000\u1039\u1000\u1030", // က္ကူ
  "\u1000\u1039\u1000\u102D\u102F", // က္ကို
  "\u1000\u103A\u103B\u102C\u1038", // က်ျား (not ကျား)
  "\u1004\u103A\u1039\u101E\u1031\u1037", // င်္သေ့
  "\u1019\u1039\u1018\u102C", // မ္ဘာ
  "\u1005\u1039\u1005\u100A\u103A\u1038", // စ္စည်း
  "\u1010\u102D\u1036", // တိံ (already Burmese)
  "\u1010\u1039\u1010\u102F", // တ္တု
  "\u1010\u1039\u1011\u102D", // တ္ထိ
];

// ---------------------------------------------------------------------------
// Number formatting — pinned so output matches the Python twin.
// ---------------------------------------------------------------------------

function fmt(value, digits = 2) {
  const text = value.toFixed(digits);
  if (text === "-0" || text === `-0.${"0".repeat(digits)}`) return "0";
  return text;
}

function pathNumber(token) {
  const text = parseFloat(token).toFixed(3)
    .replace(/(\.\d*?[1-9])0+$/, "$1")
    .replace(/\.0+$/, "");
  return text === "" || text === "-0" ? "0" : text;
}

function roundPathNumbers(pathData) {
  // Round numbers and make every parameter group carry an explicit command.
  // SVG path pen can emit implicit lineto pairs after M (valid SVG, but the
  // parser's small path reader expects the explicit form used by the sheets).
  const tokens = pathData.match(
    /[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.?\d+(?:e-?\d+)?|-?\d+/g
  ) || [];
  const params = {
    M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, S: 4, T: 2, A: 7, Z: 0,
  };
  const out = [];
  let cmd = "";
  let firstGroup = true;
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[A-Za-z]$/.test(token)) {
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
  return out.map((t) => (/^[A-Za-z]$/.test(t) ? t : ` ${t}`)).join("").trim();
}

function attr(value) {
  return String(value).replace(/"/g, "&quot;");
}

function codepoints(text) {
  return [...text].map((ch) => `U+${ch.codePointAt(0).toString(16).padStart(4, "0")}`).join(" ");
}

// ---------------------------------------------------------------------------
// Load units from the SQLite database (same data as the Python twin).
// ---------------------------------------------------------------------------

function loadUnits(dbPath) {
  const con = new Database(dbPath, { readonly: true });
  let burmese, master;
  try {
    burmese = con
      .prepare("SELECT line FROM burmese_syllables ORDER BY id")
      .all()
      .map((r) => r.line);
    master = JSON.parse(
      con.prepare("SELECT data FROM master_json WHERE id=1").get().data
    );
  } finally {
    con.close();
  }

  // SVG Pali, by owner rule: only stack parts filtered from the master
  // dictionary (two-space syllable segments containing U+1039), in first
  // dictionary occurrence order, plus the owner-given list above. Do not
  // read master["syllables"]["pali"] for this group.
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

  // Present the master base set in codepoint order for a readable index.
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

// ---------------------------------------------------------------------------
// Shaper — HarfBuzz shaping + fontkit glyph paths, ported from Python.
// ---------------------------------------------------------------------------

class Shaper {
  constructor(fontPath) {
    this.hb = hb;
    this.fontkit = fontkit;
    this.ttfont = fontkit.openSync(fontPath);
    this.upm = this.ttfont.unitsPerEm;
    this.k = SIZE / this.upm;
    this.font = new hb.Font(
      new hb.Face(new hb.Blob(fs.readFileSync(fontPath)), 0)
    );
    this.paths = new Map();
    this.notdefTexts = [];
  }

  glyphPath(gid) {
    if (this.paths.has(gid)) return this.paths.get(gid);
    const glyph = this.ttfont.getGlyph(gid);
    const name = glyph.name;

    // HarfBuzz inserts a dotted circle for an isolated mark. Keep its
    // advance (so the mark sits where it would on a base) but do not draw
    // the circle, matching the existing specimen sheets.
    if (name === "uni25CC") {
      this.paths.set(gid, "");
      return "";
    }

    const transformed = glyph.path.transform(this.k, 0, 0, -this.k, 0, 0);
    const svgPath = roundPathNumbers(transformed.toSVG());
    this.paths.set(gid, svgPath);
    return svgPath;
  }

  shape(text) {
    const buf = new this.hb.Buffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    this.hb.shape(this.font, buf, {});

    const infos = buf.getGlyphInfos();
    const positions = buf.getGlyphPositions();

    let cursor = 0;
    const uses = [];
    let sawNotdef = false;

    for (let i = 0; i < infos.length; i++) {
      const gid = infos[i].codepoint;
      const glyph = this.ttfont.getGlyph(gid);
      const name = glyph.name;
      const x = (cursor + positions[i].xOffset) * this.k;
      const y = -positions[i].yOffset * this.k;
      cursor += positions[i].xAdvance;

      if (gid === 0) sawNotdef = true;
      if (name === "uni25CC") continue;

      const path = this.glyphPath(gid);
      if (path) {
        uses.push({ gid, x, y });
      }
    }

    if (sawNotdef) this.notdefTexts.push(text);
    return { uses, advance: cursor * this.k };
  }
}

// ---------------------------------------------------------------------------
// Layout — place units into A4 panels side by side horizontally.
// ---------------------------------------------------------------------------

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
  if (sheet.length) sheets.push(sheet);
  return sheets;
}

// ---------------------------------------------------------------------------
// SVG generation
// ---------------------------------------------------------------------------

function ruleLine(y, x0 = 0, inset = 0.35) {
  return `<line x1="${fmt(x0 + inset)}" y1="${fmt(y)}" x2="${fmt(x0 + WIDTH - inset)}" y2="${fmt(y)}"/>`;
}

function mergedSvg(panels, shaper) {
  const totalWidth = WIDTH * panels.length;
  const allEntries = panels.flat();
  const usedGids = new Set();
  for (const entry of allEntries) {
    for (const use of entry.uses) usedGids.add(use.gid);
  }
  const sortedGids = [...usedGids].sort((a, b) => a - b);
  const defs = sortedGids
    .map((gid) => `<path id="g${gid}" d="${attr(shaper.glyphPath(gid))}"/>`)
    .join("\n");

  const cells = [];
  const blue = [];
  const yellow = [];
  const bodyParts = [];
  const rules = [];
  const panelRows = [];

  for (let panelIndex = 0; panelIndex < panels.length; panelIndex++) {
    const entries = panels[panelIndex];
    const offset = panelIndex * WIDTH;
    const rows = [...new Set(entries.map((e) => e.row))].sort((a, b) => a - b);
    panelRows.push(rows.length);

    for (const r of rows) {
      const baseline = BASELINE0 + r * PITCH;
      cells.push(
        `<rect id="p${panelIndex + 1}-line${r + 1}+gap" x="${fmt(offset)}" y="${fmt(baseline - 2 * E)}" width="${fmt(WIDTH)}" height="${fmt(PITCH)}"/>`
      );
      blue.push(ruleLine(baseline - E, offset), ruleLine(baseline + E, offset));
      yellow.push(ruleLine(baseline, offset));
      rules.push(
        [-2 * E, -E, 0, E, 2 * E].map((d) => fmt(baseline + d)).join(",")
      );
    }

    for (const entry of entries) {
      const globalX = offset + entry.x;
      const uses = entry.uses
        .map(
          (use) =>
            `<use href="#g${use.gid}" x="${fmt(globalX + use.x)}" y="${fmt(entry.baseline + use.y)}"/>`
        )
        .join("");
      bodyParts.push(
        `<g id="${attr(entry.text)}" data-kind="${attr(entry.kind)}" data-cp="${attr(entry.cp)}" data-row="${entry.row}" data-x="${fmt(globalX)}" data-baseline="${fmt(entry.baseline)}">${uses}</g>`
      );
    }
  }

  const maxRows = panelRows.length ? Math.max(...panelRows) : 0;
  const totalRows = panelRows.reduce((a, b) => a + b, 0);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- Burmese+Pali index (font 11), one expanded SVG: ${panels.length} A4 panels side by side horizontally.
     Panel 1 is at the left, then panel 2, then panel 3; there are no separate sheet files.
     Order: marks separately (no standalone U+1039), base consonants, Myanmar digits,
     then Burmese syllables, then Pali syllables. SVG Pali is restricted to the
     dictionary U+1039 parts plus the owner-given list; it is not master syllables.pali.
     E = 5.5; word slot = 16.5 (baseline-11..baseline+5.5); spacing band = 5.5;
     line+gap cell/pitch = 22. Pink = shared cell border/end of spacing,
     blue = baseline +/- 5.5, yellow = baseline. Shaped with HarfBuzz at build time. -->
<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(totalWidth)}" height="${fmt(PAGE_HEIGHT)}" viewBox="0 0 ${fmt(totalWidth)} ${fmt(PAGE_HEIGHT)}"
     data-font="PYIDAUNGSU-2.5.2_REGULAR.TTF" data-shaped="harfbuzz" data-size="11" data-em="11"
     data-line-h="22" data-pitch="22" data-E="5.5" data-band="0.5" data-slot="16.5" data-cell="22" data-spacing="5.5"
     data-layout="horizontal-a4-panels" data-panels="${panels.length}" data-pages="${panels.length}" data-panel-width="${fmt(WIDTH)}"
     data-rows="${maxRows}" data-total-rows="${totalRows}" data-rows-per-page="${ROWS_PER_PAGE}"
     data-baseline0="33" data-count="${allEntries.length}" data-glyphs="${sortedGids.length}" data-rules="${attr(rules.join(";"))}">
<title>Pyidaungsu Burmese+Pali index — font 11, ${panels.length} A4 panels in one SVG</title>
<rect x="0" y="0" width="${fmt(totalWidth)}" height="${fmt(PAGE_HEIGHT)}" fill="#FFFFFF"/>
<g id="lines" fill="#E5E5E5" stroke="#FF6EAE" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round">${cells.join("")}</g>
<defs>
${defs}
</defs>
<g fill="#000000" fill-rule="evenodd">
${bodyParts.join("\n")}
</g>
<g id="bounded" stroke="#77BDFD" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${blue.join("")}</g>
<g id="baselinegroup" stroke="#FFFF00" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">${yellow.join("")}</g>
</svg>
`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export async function main(args) {
  const argv = args.slice(2);
  let fontPath = DEFAULT_FONT;
  let dbPath = DEFAULT_DB;
  let outPath = DEFAULT_OUT;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--font" && i + 1 < argv.length) fontPath = argv[++i];
    else if (argv[i] === "--db" && i + 1 < argv.length) dbPath = argv[++i];
    else if (argv[i] === "--out" && i + 1 < argv.length) outPath = argv[++i];
  }

  const { units, counts } = loadUnits(dbPath);
  const shaper = new Shaper(fontPath);
  for (const unit of units) {
    Object.assign(unit, shaper.shape(unit.text));
  }
  const panels = layout(units);

  // Ensure output directory exists
  const outDir = outPath.substring(0, outPath.lastIndexOf("/"));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, mergedSvg(panels, shaper), "utf8");

  console.log(
    JSON.stringify(
      {
        counts,
        file: outPath,
        width: WIDTH * panels.length,
        panels: panels.map((entries, i) => ({
          panel: i + 1,
          xOffset: i * WIDTH,
          entries: entries.length,
          rows: [...new Set(entries.map((e) => e.row))].length,
        })),
        distinctGlyphs: shaper.paths.size,
        notdefTexts: shaper.notdefTexts,
      },
      null,
      2
    )
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const exitCode = await main(process.argv);
  process.exit(exitCode);
}
