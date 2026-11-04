#!/usr/bin/env python3
"""Build an aligned two-font comparison SVG for the font-11 index.

The foreground/overlay layer is the normal loadSheet-readable index in the
reference font.  The background layer shapes the same labelled units in a
second font and places every glyph at the same entry origin/baseline as the
reference layout, so the two font layers can be merged/inspected with blend
modes such as exclusion/overlay instead of comparing raw sheet x/y lists.

A machine-readable line register (panel/line -> syllable texts) is embedded in
<metadata id="line-register">.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
spec = importlib.util.spec_from_file_location(
    "index_font11", HERE / "make-index-font11.py"
)
idx = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(idx)

DEFAULT_BG_FONT = ROOT / "Junk/fonts/Unicode/Padauk.ttf"
DEFAULT_OUT = (
    ROOT
    / "B.Parser/main/parser/jason-map/vector/"
    "index-font11-burmese-pali-compare-pyidaungsu-padauk.svg"
)


def line_register(panels: list[list[dict]]) -> dict:
    register = {"panels": []}
    for panel_index, entries in enumerate(panels, start=1):
        rows: dict[int, list[dict]] = {}
        for entry in entries:
            rows.setdefault(int(entry["row"]), []).append(entry)
        lines = []
        for row in sorted(rows):
            row_entries = rows[row]
            kinds: dict[str, int] = {}
            for entry in row_entries:
                kinds[entry["kind"]] = kinds.get(entry["kind"], 0) + 1
            lines.append(
                {
                    "id": f"p{panel_index}-line{row + 1}",
                    "panel": panel_index,
                    "line": row + 1,
                    "row": row,
                    "baseline": float(row_entries[0]["baseline"]),
                    "count": len(row_entries),
                    "kinds": kinds,
                    "texts": [entry["text"] for entry in row_entries],
                }
            )
        register["panels"].append(
            {
                "panel": panel_index,
                "xOffset": (panel_index - 1) * idx.WIDTH,
                "entries": len(entries),
                "lines": lines,
            }
        )
    return register


def compare_svg(
    panels: list[list[dict]],
    fg_shaper: idx.Shaper,
    bg_shapes_by_text: dict[str, dict],
    bg_shaper: idx.Shaper,
    fg_font: Path,
    bg_font: Path,
    counts: dict,
) -> str:
    total_width = idx.WIDTH * len(panels)
    all_entries = [entry for entries in panels for entry in entries]
    fg_gids = sorted({use["gid"] for entry in all_entries for use in entry["uses"]})
    bg_gids = sorted(
        {
            use["gid"]
            for shape in bg_shapes_by_text.values()
            for use in shape["uses"]
        }
    )
    defs = "\n".join(
        [
            *(
                f'<path id="g{gid}" d="{idx.attr(fg_shaper.glyph_path(gid))}"/>'
                for gid in fg_gids
            ),
            *(
                f'<path id="bg-g{gid}" d="{idx.attr(bg_shaper.glyph_path(gid))}"/>'
                for gid in bg_gids
            ),
        ]
    )

    cells: list[str] = []
    blue: list[str] = []
    yellow: list[str] = []
    bg_parts: list[str] = []
    body_parts: list[str] = []
    rules: list[str] = []
    panel_rows: list[int] = []

    for panel_index, entries in enumerate(panels):
        offset = panel_index * idx.WIDTH
        rows = sorted({entry["row"] for entry in entries})
        panel_rows.append(len(rows))
        for r in rows:
            baseline = idx.BASELINE0 + r * idx.PITCH
            cells.append(
                f'<rect id="p{panel_index + 1}-line{r + 1}+gap" x="{idx.fmt(offset)}" '
                f'y="{idx.fmt(baseline - 2 * idx.E)}" width="{idx.fmt(idx.WIDTH)}" '
                f'height="{idx.fmt(idx.PITCH)}"/>'
            )
            blue.extend(
                idx.rule_line(baseline + delta, offset) for delta in (-idx.E, idx.E)
            )
            yellow.append(idx.rule_line(baseline, offset))
            rules.append(
                ",".join(idx.fmt(baseline + d) for d in (-2 * idx.E, -idx.E, 0, idx.E, 2 * idx.E))
            )
        for entry in entries:
            global_x = offset + float(entry["x"])
            bg_shape = bg_shapes_by_text[entry["text"]]
            bg_parts.extend(
                f'<use href="#bg-g{use["gid"]}" x="{idx.fmt(global_x + use["x"])}" '
                f'y="{idx.fmt(entry["baseline"] + use["y"])}"/>'
                for use in bg_shape["uses"]
            )
            uses = "".join(
                f'<use href="#g{use["gid"]}" x="{idx.fmt(global_x + use["x"])}" '
                f'y="{idx.fmt(entry["baseline"] + use["y"])}"/>'
                for use in entry["uses"]
            )
            body_parts.append(
                f'<g id="{idx.attr(entry["text"])}" data-kind="{idx.attr(entry["kind"])}" '
                f'data-cp="{idx.attr(entry["cp"])}" data-row="{entry["row"]}" '
                f'data-x="{idx.fmt(global_x)}" data-baseline="{idx.fmt(entry["baseline"])}">{uses}</g>'
            )

    register = line_register(panels)
    register_json = json.dumps(
        {"counts": counts, "lineRegister": register}, ensure_ascii=False, indent=2
    )
    if "]]>" in register_json:  # CDATA terminator cannot appear in our labels.
        raise ValueError("line register contains CDATA terminator")

    return f'''<?xml version="1.0" encoding="UTF-8"?>
<!-- Burmese+Pali font comparison (font 11), one expanded SVG.
     Foreground/overlay: {fg_font.name} (normal loadSheet-readable entries).
     Background: {bg_font.name}, aligned to the same entry origins/baselines and
     tagged for exclusion/overlay inspection. Line register: metadata#line-register.
     SVG Pali follows svgout/make-index-font11.py: dictionary U+1039 parts plus the
     owner-given list only, not master syllables.pali. -->
<svg xmlns="http://www.w3.org/2000/svg" width="{idx.fmt(total_width)}" height="{idx.fmt(idx.PAGE_HEIGHT)}" viewBox="0 0 {idx.fmt(total_width)} {idx.fmt(idx.PAGE_HEIGHT)}"
     style="isolation:isolate" data-font="{idx.attr(fg_font.name)}" data-bg-font="{idx.attr(bg_font.name)}" data-shaped="harfbuzz" data-size="11" data-em="11"
     data-line-h="22" data-pitch="22" data-E="5.5" data-band="0.5" data-slot="16.5" data-cell="22" data-spacing="5.5"
     data-layout="horizontal-a4-panels" data-panels="{len(panels)}" data-pages="{len(panels)}" data-panel-width="{idx.fmt(idx.WIDTH)}"
     data-rows="{max(panel_rows, default=0)}" data-total-rows="{sum(panel_rows)}" data-rows-per-page="{idx.ROWS_PER_PAGE}"
     data-baseline0="33" data-count="{len(all_entries)}" data-glyphs="{len(fg_gids)}" data-bg-glyphs="{len(bg_gids)}" data-rules="{idx.attr(';'.join(rules))}">
<title>Pyidaungsu vs {idx.attr(bg_font.stem)} Burmese+Pali index comparison — font 11</title>
<metadata id="line-register" data-register="panel-line-syllables"><![CDATA[
{register_json}
]]></metadata>
<rect x="0" y="0" width="{idx.fmt(total_width)}" height="{idx.fmt(idx.PAGE_HEIGHT)}" fill="#FFFFFF"/>
<g id="lines" fill="#E5E5E5" stroke="#FF6EAE" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round">{''.join(cells)}</g>
<defs>
{defs}
</defs>
<g id="font-layer-bg" data-font="{idx.attr(bg_font.name)}" data-blend="exclusion" fill="#FF2D55" fill-opacity="0.52" style="mix-blend-mode:exclusion">{''.join(bg_parts)}</g>
<g id="font-layer-overlay" data-font="{idx.attr(fg_font.name)}" fill="#000000" fill-rule="evenodd">
{''.join(body_parts)}
</g>
<g id="bounded" stroke="#77BDFD" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">{''.join(blue)}</g>
<g id="baselinegroup" stroke="#FFFF00" stroke-width="0.7" fill="none" stroke-linecap="round" stroke-linejoin="round">{''.join(yellow)}</g>
</svg>
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--font", type=Path, default=idx.DEFAULT_FONT, help="foreground/overlay font")
    parser.add_argument("--bg-font", type=Path, default=DEFAULT_BG_FONT, help="background font")
    parser.add_argument("--db", type=Path, default=idx.DEFAULT_DB)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    units, counts = idx.load_units(args.db)
    fg_shaper = idx.Shaper(args.font)
    for unit in units:
        unit.update(fg_shaper.shape(unit["text"]))
    panels = idx.layout(units)

    bg_shaper = idx.Shaper(args.bg_font)
    bg_shapes_by_text = {
        unit["text"]: bg_shaper.shape(unit["text"]) for unit in units
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        compare_svg(
            panels, fg_shaper, bg_shapes_by_text, bg_shaper, args.font, args.bg_font, counts
        ),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "counts": counts,
                "file": str(args.out),
                "foregroundFont": str(args.font),
                "backgroundFont": str(args.bg_font),
                "panels": [
                    {
                        "panel": i + 1,
                        "xOffset": i * idx.WIDTH,
                        "entries": len(entries),
                        "rows": len({entry["row"] for entry in entries}),
                    }
                    for i, entries in enumerate(panels)
                ],
                "foregroundGlyphs": len(fg_shaper.paths),
                "backgroundGlyphs": len(bg_shaper.paths),
                "foregroundNotdefTexts": fg_shaper.notdef_texts,
                "backgroundNotdefTexts": bg_shaper.notdef_texts,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
