#!/usr/bin/env python3
"""Build one expanded font-11 Burmese+Pali index SVG (build-time HarfBuzz shaping).

The A4 pages are not separate files: they are placed side by side horizontally
in one SVG canvas (panel 1 at the left, then panel 2, panel 3, ...).

Order requested by the owner:
  1. Myanmar marks separately, omitting the standalone U+1039 entry;
  2. all base consonants from master MMap.Base;
  3. all Myanmar digits;
  4. all Burmese syllables from tools-box/js/scripts.db;
  5. Pali syllables for the SVG only: the stack parts filtered from the
     master dictionary (segments containing U+1039) plus the owner's given
     Pali list. This deliberately does NOT use master ``syllables.pali``.

The visual frame follows the owner's line+gap sketch at font size 11:
E = 5.5, word slot = 3E = 16.5, spacing band = E = 5.5, pitch/cell = 22.
Pink is the shared cell border (end of spacing / start of next cell), the two
inner bounded lines are blue, and the baseline is yellow.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FONT = ROOT / "Junk/fonts/Unicode/PYIDAUNGSU-2.5.2_REGULAR.TTF"
DEFAULT_DB = ROOT / "tools-box/js/scripts.db"
DEFAULT_OUT = (
    ROOT / "B.Parser/main/parser/jason-map/vector/index-font11-burmese-pali.svg"
)

SIZE = 11.0
E = SIZE * 0.5
SLOT = 3 * E
PITCH = 22.0
BASELINE0 = 33.0
WIDTH = 595.276  # width of one A4 panel; total SVG width = WIDTH * panel count
PAGE_HEIGHT = 841.89
MARGIN_X = 22.0
ROWS_PER_PAGE = 37
GAP = 3.206  # old 7 pt sheet median inter-entry gap (2.04) scaled to 11 pt

# Owner slot order (as in MARK_ORDER: asat before dot-below), without U+1039.
MARKS = [
    "\u103B", "\u103C", "\u103D", "\u103E",  # medials ya/ra/wa/ha
    "\u1031",  # e
    "\u102D", "\u102E", "\u102F", "\u1030", "\u1032",  # i/ii/u/uu/ai
    "\u102C", "\u102B",  # aa/tall aa
    "\u1036", "\u103A", "\u1037", "\u1038",  # anusvara/asat/dot/visarga
]

# Master MMap.Base (42), as copied for the combined list.
BASE_CONSONANTS_MASTER_ORDER = [
    "က", "ခ", "ဂ", "ဃ", "င", "စ", "ဇ", "ည", "ဋ", "ဉ", "ဍ", "ဏ", "တ", "ထ", "ဒ", "န",
    "ပ", "ဖ", "ဗ", "ဘ", "မ", "ယ", "ရ", "လ", "သ", "ဟ", "အ", "ဥ", "ဧ", "ဈ", "ဝ", "ဓ",
    "ဩ", "ဿ", "ဣ", "ဦ", "ဠ", "ဌ", "ဆ", "ဎ", "ဪ", "၎",
]
DIGITS = ["၀", "၁", "၂", "၃", "၄", "၅", "၆", "၇", "၈", "၉"]

# Owner-given Pali list for the SVG. Keep the exact sequences: in particular
# "က်ျား" is U+1000 U+103A U+103B U+102C U+1038 here, not clean Burmese
# "ကျား" (U+1000 U+103B U+102C U+1038). "တိံ" is in the owner's list too, but
# it is already present in Burmese syllables, so de-duplication keeps one entry.
USER_GIVEN_PALI = [
    "\u1004\u103A\u1039\u1000",  # င်္က
    "\u1004\u103A\u1039\u1001",  # င်္ခ
    "\u1004\u103A\u1039\u1002",  # င်္ဂ
    "\u1004\u103A\u1039\u1002\u102B",  # င်္ဂါ
    "\u1010\u1039\u1010\u1030",  # တ္တူ
    "\u1000\u1039\u1000\u1030",  # က္ကူ
    "\u1000\u1039\u1000\u102D\u102F",  # က္ကို
    "\u1000\u103A\u103B\u102C\u1038",  # က်ျား (not ကျား)
    "\u1004\u103A\u1039\u101E\u1031\u1037",  # င်္သေ့
    "\u1019\u1039\u1018\u102C",  # မ္ဘာ
    "\u1005\u1039\u1005\u100A\u103A\u1038",  # စ္စည်း
    "\u1010\u102D\u1036",  # တိံ (already Burmese)
    "\u1010\u1039\u1010\u102F",  # တ္တု
    "\u1010\u1039\u1011\u102D",  # တ္ထိ
]


def fmt(value: float, digits: int = 2) -> str:
    text = f"{value:.{digits}f}"
    return "0" if text in {"-0", "-0.0", "-0.00", "-0.000"} else text


def _path_number(token: str) -> str:
    text = f"{float(token):.3f}".rstrip("0").rstrip(".")
    return "0" if text in {"", "-0"} else text


def round_path_numbers(path_data: str) -> str:
    """Round numbers and make every parameter group carry an explicit command.

    SVGPathPen can emit implicit lineto pairs after M (valid SVG, but the
    parser's small path reader expects the explicit form used by the sheets).
    """
    tokens = re.findall(
        r"[AaCcHhLlMmQqSsTtVvZz]|-?\d*\.\d+(?:e-?\d+)?|-?\d+", path_data
    )
    params = {"M": 2, "L": 2, "H": 1, "V": 1, "Q": 4, "C": 6, "S": 4, "T": 2, "A": 7, "Z": 0}
    out: list[str] = []
    cmd = ""
    first_group = True
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.isalpha():
            cmd = token
            first_group = True
            out.append(cmd)
            i += 1
            continue
        if not cmd:
            i += 1
            continue
        count = params[cmd.upper()]
        group = tokens[i:i + count]
        if len(group) < count:
            break
        if not first_group:
            out.append("L" if cmd == "M" else "l" if cmd == "m" else cmd)
        out.extend(_path_number(part) for part in group)
        first_group = False
        i += count
    return "".join(
        token if token.isalpha() else f" {token}" for token in out
    ).replace(" ", " ", 1).strip()


def attr(value: object) -> str:
    return escape(str(value), {'"': "&quot;"})


def codepoints(text: str) -> str:
    return " ".join(f"U+{ord(ch):04X}" for ch in text)


def load_units(db_path: Path) -> tuple[list[dict], dict]:
    con = sqlite3.connect(f"file:{db_path}?mode=ro&immutable=1", uri=True)
    try:
        burmese = [row[0] for row in con.execute(
            "SELECT line FROM burmese_syllables ORDER BY id"
        )]
        master = json.loads(con.execute(
            "SELECT data FROM master_json WHERE id=1"
        ).fetchone()[0])
    finally:
        con.close()

    # SVG Pali, by owner rule: only stack parts filtered from the master
    # dictionary (two-space syllable segments containing U+1039), in first
    # dictionary occurrence order, plus the owner-given list above. Do not
    # read master["syllables"]["pali"] for this group.
    dictionary_pali: list[str] = []
    dictionary_seen: set[str] = set()
    dictionary_occurrences = 0
    dictionary_entries = 0
    for entries in master["dictionary"].values():
        for entry in entries:
            hits = [
                seg for seg in re.split(r"\s{2,}", entry.strip())
                if seg and "\u1039" in seg
            ]
            if hits:
                dictionary_entries += 1
            for seg in hits:
                dictionary_occurrences += 1
                if seg not in dictionary_seen:
                    dictionary_seen.add(seg)
                    dictionary_pali.append(seg)

    pali = list(dictionary_pali)
    user_given_candidates = []
    for text in USER_GIVEN_PALI:
        if text not in dictionary_seen:
            user_given_candidates.append(text)
            pali.append(text)

    # Present the master base set in codepoint order for a readable index.
    bases = sorted(set(BASE_CONSONANTS_MASTER_ORDER), key=lambda ch: ord(ch))
    groups = [
        ("mark", MARKS),
        ("consonant", bases),
        ("digit", DIGITS),
        ("syllable", burmese),
        ("pali", pali),
    ]
    seen: set[str] = set()
    units: list[dict] = []
    counts = {}
    duplicates = 0
    for kind, values in groups:
        kept = 0
        for text in values:
            if text in seen:
                duplicates += 1
                continue
            seen.add(text)
            units.append({
                "text": text,
                "kind": kind,
                "cp": codepoints(text),
                "newRowBefore": kept == 0 and bool(units),
            })
            kept += 1
        counts[kind] = kept
    counts["total"] = len(units)
    counts["duplicatesSkipped"] = duplicates
    counts["burmeseRows"] = len(burmese)
    counts["dictionaryPaliUnique"] = len(dictionary_pali)
    counts["dictionaryPaliOccurrences"] = dictionary_occurrences
    counts["dictionaryPaliEntries"] = dictionary_entries
    counts["userGivenPali"] = len(USER_GIVEN_PALI)
    counts["userGivenPaliCandidates"] = len(user_given_candidates)
    counts["userGivenPaliAdded"] = counts["pali"] - len(dictionary_pali)
    return units, counts


class Shaper:
    def __init__(self, font_path: Path) -> None:
        try:
            import uharfbuzz as hb
            from fontTools.pens.svgPathPen import SVGPathPen
            from fontTools.pens.transformPen import TransformPen
            from fontTools.ttLib import TTFont
        except ImportError as exc:  # pragma: no cover - build-time dependency
            raise SystemExit(
                "Missing build-time dependency: install uharfbuzz and fonttools"
            ) from exc
        self.hb = hb
        self.SVGPathPen = SVGPathPen
        self.TransformPen = TransformPen
        self.ttfont = TTFont(str(font_path))
        self.upm = float(self.ttfont["head"].unitsPerEm)
        self.k = SIZE / self.upm
        self.glyph_set = self.ttfont.getGlyphSet()
        self.font = hb.Font(hb.Face(hb.Blob.from_file_path(str(font_path))))
        self.paths: dict[int, str] = {}
        self.notdef_texts: list[str] = []

    def glyph_path(self, gid: int) -> str:
        if gid not in self.paths:
            name = self.ttfont.getGlyphName(gid)
            pen = self.SVGPathPen(self.glyph_set)
            transform = self.TransformPen(pen, (self.k, 0, 0, -self.k, 0, 0))
            self.glyph_set[name].draw(transform)
            self.paths[gid] = round_path_numbers(pen.getCommands())
        return self.paths[gid]

    def shape(self, text: str) -> dict:
        buf = self.hb.Buffer()
        buf.add_str(text)
        buf.guess_segment_properties()
        self.hb.shape(self.font, buf, {})
        cursor = 0.0
        uses: list[dict] = []
        saw_notdef = False
        for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
            gid = int(info.codepoint)
            name = self.ttfont.getGlyphName(gid)
            x = (cursor + float(pos.x_offset)) * self.k
            y = -float(pos.y_offset) * self.k
            cursor += float(pos.x_advance)
            if gid == 0:
                saw_notdef = True
            # HarfBuzz inserts a dotted circle for an isolated mark. Keep its
            # advance (so the mark sits where it would on a base) but do not
            # draw the circle, matching the existing specimen sheets.
            if name == "uni25CC":
                continue
            if self.glyph_path(gid):
                uses.append({"gid": gid, "x": x, "y": y})
        if saw_notdef:
            self.notdef_texts.append(text)
        return {"uses": uses, "advance": cursor * self.k}


def layout(units: list[dict]) -> list[list[dict]]:
    sheets: list[list[dict]] = []
    sheet: list[dict] = []
    row = 0
    cursor_x = MARGIN_X

    def start_row() -> None:
        nonlocal sheet, row, cursor_x
        if row + 1 >= ROWS_PER_PAGE:
            sheets.append(sheet)
            sheet = []
            row = 0
        else:
            row += 1
        cursor_x = MARGIN_X

    for unit in units:
        advance = float(unit["advance"]) + GAP
        if unit.get("newRowBefore") and cursor_x > MARGIN_X:
            start_row()
        if cursor_x + advance > WIDTH - MARGIN_X and cursor_x > MARGIN_X:
            start_row()
        placed = {
            **unit,
            "row": row,
            "x": cursor_x,
            "baseline": BASELINE0 + row * PITCH,
        }
        sheet.append(placed)
        cursor_x += advance
    if sheet:
        sheets.append(sheet)
    return sheets


def rule_line(y: float, x0: float = 0.0, inset: float = 0.35) -> str:
    return (
        f'<line x1="{fmt(x0 + inset)}" y1="{fmt(y)}" '
        f'x2="{fmt(x0 + WIDTH - inset)}" y2="{fmt(y)}"/>'
    )


def merged_svg(panels: list[list[dict]], shaper: Shaper) -> str:
    """Return one wide SVG: the A4 panels sit side by side horizontally.

    Panel 1 occupies x=0..595.276, panel 2 x=595.276..1190.552, and so on.
    Entry `<use>` coordinates and `data-x` are global to the merged canvas,
    so the existing `loadSheet()` reader sees every entry in its real place.
    """
    total_width = WIDTH * len(panels)
    all_entries = [entry for entries in panels for entry in entries]
    used_gids = sorted({use["gid"] for entry in all_entries for use in entry["uses"]})
    defs = "\n".join(
        f'<path id="g{gid}" d="{attr(shaper.glyph_path(gid))}"/>'
        for gid in used_gids
    )
    cells: list[str] = []
    blue: list[str] = []
    yellow: list[str] = []
    body_parts: list[str] = []
    rules: list[str] = []
    panel_rows: list[int] = []

    for panel_index, entries in enumerate(panels):
        offset = panel_index * WIDTH
        rows = sorted({entry["row"] for entry in entries})
        panel_rows.append(len(rows))
        for r in rows:
            baseline = BASELINE0 + r * PITCH
            cells.append(
                f'<rect id="p{panel_index + 1}-line{r + 1}+gap" x="{fmt(offset)}" '
                f'y="{fmt(baseline - 2 * E)}" width="{fmt(WIDTH)}" height="{fmt(PITCH)}"/>'
            )
            blue.extend(rule_line(baseline + delta, offset) for delta in (-E, E))
            yellow.append(rule_line(baseline, offset))
            rules.append(
                ",".join(fmt(baseline + d) for d in (-2 * E, -E, 0, E, 2 * E))
            )
        for entry in entries:
            global_x = offset + float(entry["x"])
            uses = "".join(
                f'<use href="#g{use["gid"]}" x="{fmt(global_x + use["x"])}" '
                f'y="{fmt(entry["baseline"] + use["y"])}"/>'
                for use in entry["uses"]
            )
            body_parts.append(
                f'<g id="{attr(entry["text"])}" data-kind="{attr(entry["kind"])}" '
                f'data-cp="{attr(entry["cp"])}" data-row="{entry["row"]}" '
                f'data-x="{fmt(global_x)}" data-baseline="{fmt(entry["baseline"])}">{uses}</g>'
            )

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- Burmese+Pali index (font 11), one expanded SVG: {len(panels)} A4 panels side by side horizontally.
     Panel 1 is at the left, then panel 2, then panel 3; there are no separate sheet files.
     Order: marks separately (no standalone U+1039), base consonants, Myanmar digits,
     then Burmese syllables, then Pali syllables. SVG Pali is restricted to the
     dictionary U+1039 parts plus the owner-given list; it is not master syllables.pali.
     E = 5.5; word slot = 16.5 (baseline-11..baseline+5.5); spacing band = 5.5;
     line+gap cell/pitch = 22. Pink = shared cell border/end of spacing,
     blue = baseline +/- 5.5, yellow = baseline. Shaped with HarfBuzz at build time. -->
<svg xmlns="http://www.w3.org/2000/svg" width="{fmt(total_width)}" height="{fmt(PAGE_HEIGHT)}" viewBox="0 0 {fmt(total_width)} {fmt(PAGE_HEIGHT)}"
     data-font="PYIDAUNGSU-2.5.2_REGULAR.TTF" data-shaped="harfbuzz" data-size="11" data-em="11"
     data-line-h="22" data-pitch="22" data-E="5.5" data-band="0.5" data-slot="16.5" data-cell="22" data-spacing="5.5"
     data-layout="horizontal-a4-panels" data-panels="{len(panels)}" data-pages="{len(panels)}" data-panel-width="{fmt(WIDTH)}"
     data-rows="{max(panel_rows, default=0)}" data-total-rows="{sum(panel_rows)}" data-rows-per-page="{ROWS_PER_PAGE}"
     data-baseline0="33" data-count="{len(all_entries)}" data-glyphs="{len(used_gids)}" data-rules="{attr(';'.join(rules))}">
<title>Pyidaungsu Burmese+Pali index — font 11, {len(panels)} A4 panels in one SVG</title>
<rect x="0" y="0" width="{fmt(total_width)}" height="{fmt(PAGE_HEIGHT)}" fill="#FFFFFF"/>
<g id="lines" fill="#E5E5E5" stroke="#FF6EAE" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round">{''.join(cells)}</g>
<defs>
{defs}
</defs>
<g fill="#000000" fill-rule="evenodd">
{''.join(body_parts)}
</g>
<g id="bounded" stroke="#77BDFD" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">{''.join(blue)}</g>
<g id="baselinegroup" stroke="#FFFF00" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">{''.join(yellow)}</g>
</svg>
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", type=Path, default=DEFAULT_FONT)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    units, counts = load_units(args.db)
    shaper = Shaper(args.font)
    for unit in units:
        unit.update(shaper.shape(unit["text"]))
    panels = layout(units)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(merged_svg(panels, shaper), encoding="utf-8")
    print(json.dumps({
        "counts": counts,
        "file": str(args.out),
        "width": WIDTH * len(panels),
        "panels": [
            {"panel": i + 1, "xOffset": i * WIDTH, "entries": len(entries),
             "rows": len({entry["row"] for entry in entries})}
            for i, entries in enumerate(panels)
        ],
        "distinctGlyphs": len(shaper.paths),
        "notdefTexts": shaper.notdef_texts,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
