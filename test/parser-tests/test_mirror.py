#!/usr/bin/env python3
"""Mirror checks for the rule modules ported from the JS parser.

These tests pin the ports to the behaviour written in

  prised/@rule/judgement.js
  prised/@rule/unicode-evidence.js
  prised/@core/runtime/markup.js
  @output/helper/markup.js
  prised/@core/pdf/method/legacy/codepage-names.js
  @entry/helper/limit.js

No JS runtime is needed and none is started: every expectation below is
derived from the JS source by hand, so a change on either side that breaks
the mirror fails here.

    python3 test/parser-tests/test_mirror.py
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "modules"))

from myangustis_parser.resources import font_names  # noqa: E402
from myangustis_parser.normalize import judgement  # noqa: E402
from myangustis_parser.entry import limits  # noqa: E402
from myangustis_parser.output import markup  # noqa: E402
from myangustis_parser.normalize import mm_score  # noqa: E402
from myangustis_parser.workflow import pipeline  # noqa: E402
from myangustis_parser.normalize import unicode_evidence  # noqa: E402


def _judge_evidence(slots: int):
    """A judgement pack whose candidate touched ``slots`` positions."""
    return {
        "originalHasText": True,
        "hasMyanmar": True,
        "aligned": True,
        "candidateChanged": slots > 0,
        "candidateAligned": True,
        "candidateSlots": slots,
        "count": 1,
        "rawScore": 1.0,
        "candidateScore": 1.0,
    }


def main() -> int:
    checks = []

    def check(name, condition, detail=""):
        checks.append((name, bool(condition), detail))

    # ── judgement: English evidence ───────────────────────────────────────
    english = judgement.english_likeness("The quick brown fox jumps over the lazy dog")
    check("english verdict", english["verdict"] == "english", english)
    check("english score", english["score"] == 1.0, english)

    junk = judgement.english_likeness("wnnkxcvbnmq")
    check("junk verdict", junk["verdict"] == "not-english", junk)
    check("junk violation rate", junk["violationRate"] == 1.0, junk)

    thin = judgement.english_likeness("Of the")
    check("thin evidence abstains", thin["verdict"] is None, thin)
    check("thin evidence has spaces", thin["hasSpaces"] is True, thin)

    # ── judgement: non-body page shapes ──────────────────────────────────
    check("page numbers", judgement.only_page_numbers("12\nPage 3"))
    check("not page numbers", not judgement.only_page_numbers("12\nChapter"))
    check("date header", judgement.only_non_body_header("January 5, 2024"))
    check("typed-by header", judgement.only_non_body_header("Typed by - ko.min 2024"))
    check("address header", judgement.only_non_body_header("www.example.com/read"))
    check("body is not header", not judgement.only_non_body_header("The quick brown fox"))

    # ── judgement: world-word fix ────────────────────────────────────────
    check("world word with evidence",
          judgement.correct_world_word("\u1000\u101a\u103c\u103c", True) == "\u1000\u101a\u103c")
    check("world word only on evidence",
          judgement.correct_world_word("\u1000\u101a\u103c\u103c", False) == "\u1000\u101a\u103c\u103c")

    # ── mm-score: Unicode mark order ─────────────────────────────────────
    check("aligned marks", mm_score.mark_order_aligned("\u1000\u103b\u103d\u1031\u102c"))
    check("crossed marks", not mm_score.mark_order_aligned("\u1031\u1000"))
    check("spaces do not reset the syllable", not mm_score.mark_order_aligned("\u1031 \u1000"))

    # ── judgement: page evidence + lane selection ────────────────────────
    swap = lambda text: text.replace("\u1031\u1000", "\u1000\u1031")  # noqa: E731
    judge = judgement.judge_page_lines(["\u1031\u1000\u102c"], swap)
    check("judge counts lines", judge["count"] == 1, judge)
    check("judge sees Myanmar", judge["hasMyanmar"] is True, judge)
    check("judge reports misalignment", judge["aligned"] is False, judge)
    check("judge candidate changed", judge["candidateChanged"] is True, judge)
    check("judge candidate slots", judge["candidateSlots"] >= 1, judge)

    check("zawcode needs more than one slot",
          judgement.select_page_decision(_judge_evidence(5), "font-cmap") == "aligned")
    check("zawcode at the threshold",
          judgement.select_page_decision(_judge_evidence(6), "font-cmap") == "zawcode")
    check("zawcode never on a Zawgyi codepage",
          judgement.select_page_decision(_judge_evidence(6), "font-cmap",
                                         zawgyi_codepage=True) == "aligned")
    legacy = _judge_evidence(0)
    legacy["aligned"] = False
    check("legacy page stays legacy",
          judgement.select_page_decision(legacy, "legacy") == "legacy")
    check("crossed cmap page -> rabbit",
          judgement.select_page_decision({**legacy, "aligned": False}, "font-cmap") == "rabbit")
    no_myanmar = {**_judge_evidence(0), "hasMyanmar": False}
    check("no Myanmar -> aligned",
          judgement.select_page_decision(no_myanmar, "font-cmap") == "aligned")
    check("no Myanmar legacy -> legacy",
          judgement.select_page_decision(no_myanmar, "legacy") == "legacy")
    check("unicode lane decisions",
          judgement.is_unicode_lane_decision("unaligned-unicode")
          and not judgement.is_unicode_lane_decision("rabbit"))
    check("unicode lane by category",
          judgement.is_unicode_lane_decision("legacy", "UNICODE"))

    # ── judgement: instruction lane ──────────────────────────────────────
    check("source encoding wins",
          judgement.instruction_lane({"fonts": []}, "zawgyi-one")
          == {"parser": "font-cmap", "reason": "source-encoding"})
    check("no fonts", judgement.instruction_lane({"fonts": []}, "auto")
          == {"parser": "font-cmap", "reason": "no-fonts"})
    check("legacy font goes legacy",
          judgement.instruction_lane(
              {"fonts": [{"baseFont": "WinInnwa", "subtype": "TrueType", "toUnicode": True}]},
              "auto") == {"parser": "legacy", "reason": "legacy-font", "fonts": ["WinInnwa"]})
    check("CID Unicode face wins over legacy name",
          judgement.instruction_lane(
              {"fonts": [{"baseFont": "Myanmar3", "subtype": "Type0", "toUnicode": True},
                         {"baseFont": "WinInnwa", "subtype": "TrueType", "toUnicode": True}]},
              "auto")["reason"] == "unicode-font")
    check("CID Zawgyi face wins",
          judgement.instruction_lane(
              {"fonts": [{"baseFont": "Zawgyi-One", "subtype": "Type0", "toUnicode": True}]},
              "auto")["reason"] == "cid-zawgyi-font")
    check("short legacy name is not evidence",
          judgement.instruction_lane(
              {"fonts": [{"baseFont": "MS", "subtype": "TrueType", "toUnicode": True}]},
              "auto")["reason"] == "no-legacy-evidence")
    check("mapped font present, legacy carries no map",
          judgement.instruction_lane(
              {"fonts": [{"baseFont": "WinInnwa", "subtype": "TrueType", "toUnicode": False},
                         {"baseFont": "Helvetica", "subtype": "TrueType", "toUnicode": True}]},
              "auto")["reason"] == "no-legacy-evidence")

    # ── judgement: text keeping ──────────────────────────────────────────
    check("normalize keeps the trailing empty line",
          list(judgement.normalize_page_lines("a\nb\n", lambda t: t.upper())) == ["A", "B", ""])
    check("normalize output text",
          judgement.normalize_output_text("a\nb", lambda t: t.upper()) == "A\nB")

    # ── font registry ────────────────────────────────────────────────────
    check("subset prefix + hex escape",
          font_names.normalise_font_name("ABCDEE+Zawgyi#2DOne") == "zawgyione")
    sample_ayar = sorted(font_names.AYAR_FONT_NAMES)[0]
    check("ayar registry face is legacy", font_names.is_legacy_font_name(sample_ayar),
          sample_ayar)
    check("unicode face is not legacy", not font_names.is_legacy_font_name("Myanmar3"))
    check("family ayar", font_names.legacy_font_family("Arlarwade") == "ayar")
    check("family wininnwa", font_names.legacy_font_family("WinInnwa") == "wininnwa")
    check("family unknown", font_names.legacy_font_family("Helvetica") is None)
    check("unknown legacy layout is flagged unknown",
          font_names.legacy_layout_for_font("Helvetica")["known"] is False)
    check("ayar layout",
          font_names.legacy_layout_for_font("Arlarwade")["layout"] == "ayar")
    check("unresolved legacy face", font_names.is_unresolved_legacy_font("WWinPonnya"))
    check("unicode font", font_names.is_unicode_font("ABCDEE+Padauk"))
    check("only unicode fonts", font_names.has_only_unicode_fonts(["Padauk", "Myanmar3"]))
    check("mixed fonts are not only-unicode",
          not font_names.has_only_unicode_fonts(["Padauk", "WinInnwa"]))

    # ── regional runs ────────────────────────────────────────────────────
    mon = "\u1000\u1050\u1031"
    check("regional run untouched",
          unicode_evidence.preserve_regional_runs(mon, lambda t: t[::-1]) == mon)
    check("other spans transformed",
          unicode_evidence.preserve_regional_runs("ab\u1000\u102c " + mon,
                                                  lambda t: t[::-1])
          == " \u102c\u1000ba" + mon)
    check("no regional -> straight transform",
          unicode_evidence.preserve_regional_runs("abc", lambda t: t.upper()) == "ABC")

    # ── markup: writer half ──────────────────────────────────────────────
    lines = [
        [0, 700, 24, "Title", "Anon-Bold"],
        [0, 660, 12, "Body & more", "Anon-Bold"],
        [0, 620, 12, "", "Anon"],
        [0, 600, 12, "Next", "Anon-Italic"],
    ]
    marked = markup.lines_to_markup(lines)
    check("heading from size jump", marked.startswith("<h1>Title</h1>"), marked)
    check("paragraph break after a large gap", "\n\n" in marked, marked)
    check("bold from the font name", "<b>Body &amp; more</b>" in marked, marked)
    check("italic from the font name", "<i>Next</i>" in marked, marked)
    check("empty line dropped", "None" not in marked and "\n\n\n" not in marked, marked)

    check("escape", markup.escape_markup_text("a<b>&c") == "a&lt;b&gt;&amp;c")
    check("unescape", markup.unescape_markup("a&lt;b&gt;&amp;c") == "a<b>&c")
    check("strip", markup.strip_markup("<b>a</b><h1>b</h1>") == "ab")
    check("text to markup",
          markup.text_to_markup(" one \n\ntwo\n\n") == "one\n\ntwo")
    check("marked text keeps DOCX marks",
          markup.marked_text_to_markup("<b>one</b> & two") == "<b>one</b> &amp; two")
    check("page to markup uses lines",
          markup.page_to_markup({"lines": [[0, 10, 11, "x", "A"]], "text": "x"}) == "x")

    # ── markup: reader half ──────────────────────────────────────────────
    blocks = markup.parse_markup("<h1>Title</h1>\n\nPara <b>bold</b> plain")
    check("parse block count", len(blocks) == 2, blocks)
    check("parse heading tag", blocks[0]["tag"] == "h1", blocks[0])
    check("parse heading lines", blocks[0]["lines"] == [[{"text": "Title", "bold": False,
                                                         "italic": False}]], blocks[0])
    runs = blocks[1]["lines"][0]
    check("parse runs", [run["text"] for run in runs] == ["Para ", "bold", " plain"], runs)
    check("parse bold run", [run["bold"] for run in runs] == [False, True, False], runs)
    check("parse unescapes content", markup.parse_markup("a &amp; b")[0]["lines"][0][0]["text"]
          == "a & b")
    check("parse empty page", markup.parse_markup("") == [])

    # ── page_markup: geometry -> markup, text-only pages flow ─────────────
    page = {"lines": [[72, 700, 24, "Title", "Anon"],
                      [72, 660, 12, "Body", "Anon"],
                      [72, 620, 12, "More", "Anon"]],
            "text": "Title\nBody\nMore"}
    built = pipeline.page_markup(page)
    check("pipeline page_markup uses geometry", built.startswith("<h1>Title</h1>"), built)
    flowed = pipeline.page_markup({"text": "one\n\ntwo"})
    check("pipeline page_markup flows text", flowed == "one\n\ntwo", flowed)
    check("pipeline page_markup keeps DOCX marks",
          pipeline.page_markup({"text": "<b>x</b>", "marked": True}) == "<b>x</b>")

    # Parser has no site/owner quotas; generic image/archive safety remains.
    check("no caller page quota", not hasattr(limits, "MAX_PAGES"))
    check("no caller input quota", not hasattr(limits, "MAX_INPUT_MB"))
    check("image safety cap", limits.MAX_OCR_PIXELS > 0)
    check("archive safety cap", limits.MAX_DOCX_RATIO > 0)

    width = max(len(name) for name, _ok, _detail in checks)
    failures = 0
    for name, ok, detail in checks:
        failures += 0 if ok else 1
        print(f"{name:<{width}}  {'ok' if ok else 'FAIL'}"
              + (f"   {detail}" if detail and not ok else ""))
    print(f"\n{len(checks) - failures}/{len(checks)} checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
