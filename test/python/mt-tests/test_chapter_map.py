#!/usr/bin/env python3
"""Tests for the DOCX chapter map and its use by the chapter runner.

A synthetic DOCX reproduces every heading form the real file contains: page
repeats, `第六四意` (OCR for 64), a bare `92`, `အခန်း(ရ)` (letter ရ for ၇),
`အခန်း94` (Arabic digits), `Chapter 1:` and the Burmese split at Chinese 61.

    python3 -m unittest discover -s mt/tests -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock
from xml.sax.saxutils import escape

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
sys.path.insert(0, str(MT))
sys.path.insert(0, str(HERE))

import api_translate  # noqa: E402
from chapter_map import (  # noqa: E402
    ChapterMapError,
    build_map,
    burmese_label,
    chinese_label,
    load_map,
    main as map_main,
    read_headings,
)
from test_rapidapi import ApiTestCase  # noqa: E402

DOCX_HEAD = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    "<w:body>"
)
DOCX_TAIL = "</w:body></w:document>"

DIGITS = "〇一二三四五六七八九"
MY_DIGITS = {str(number): chr(0x1040 + number) for number in range(10)}


def cn(number: int) -> str:
    """Chinese numeral as the novel writes it (1..999)."""
    text = ""
    if number >= 100:
        text += DIGITS[number // 100] + "百"
        number %= 100
    if number >= 20:
        text += DIGITS[number // 10] + "十"
        number %= 10
    elif number >= 10:
        text += "十"
        number %= 10
    if number or not text:
        text += DIGITS[number]
    return text


def my(number: int) -> str:
    return "".join(MY_DIGITS[digit] for digit in str(number))


def zh_heading(number: int, page: int = 1, pages: int = 1) -> str:
    if number == 64:
        title = "第六四意"                      # OCR damage: 章 replaced, 六四 glued
    elif number == 92:
        title = "92"                            # bare number
    else:
        title = f"第{cn(number)}章：章節標題"
    return f"[ZH] {title} — page {page}/{pages}"


def my_heading(number: int, page: int = 1, pages: int = 1) -> str:
    if number == 1:
        title = "Chapter 1: ပထမအခန်း"
    elif number == 5:
        title = "အခန်း (၅)"
    elif number == 7:
        title = "အခန်း(ရ)"                    # letter ရ used for ၇
    elif number in (93, 94):
        title = f"အခန်း{number}"               # Arabic digits
    else:
        title = f"အခန်း {my(number)}"
    return f"[MY] {title} — page {page}/{pages}"


def full_fixture(last_chinese: int = 193) -> list[str]:
    """Every page heading of a contiguous run, split at Chinese 61 and 137."""
    rows: list[str] = []
    burmese = 0
    for chinese in range(1, last_chinese + 1):
        burmese += 1
        rows.extend([zh_heading(chinese, 1, 2), my_heading(burmese, 1, 2)])
        rows.extend([zh_heading(chinese, 2, 2), my_heading(burmese, 2, 2)])
        if chinese in (61, 137):
            burmese += 1
            rows.extend([zh_heading(chinese, 2, 2), my_heading(burmese, 2, 2)])
    return rows


def write_docx(path: Path, headings: list[str]) -> Path:
    paragraphs = "".join(
        f"<w:p><w:r><w:t>{escape(text)}</w:t></w:r></w:p>"
        for text in [*headings, "just prose between headings"]
    )
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("word/document.xml", DOCX_HEAD + paragraphs + DOCX_TAIL)
    return path


class LabelTests(unittest.TestCase):
    def test_chinese_labels(self):
        self.assertEqual(chinese_label("[ZH] 第一章：只要被殺 — page 1/5"), 1)
        self.assertEqual(chinese_label("[ZH] 第一百九十三章:葉大人來了 — page 9/9"), 193)
        self.assertEqual(chinese_label("[ZH] 第六四意 — page 1/10"), 64)
        self.assertEqual(chinese_label("[ZH] 92 — page 1/9"), 92)
        self.assertEqual(chinese_label("[ZH] 第一百八十ー章 — page 1/1"), 181)
        self.assertIsNone(chinese_label("[ZH] no number here"))

    def test_burmese_labels(self):
        self.assertEqual(burmese_label("[MY] Chapter 1: သေလျှင်ပြိုင်ဘက်ကင်းပြီ"), 1)
        self.assertEqual(burmese_label("[MY] အခန်း (၅) — page 1/5"), 5)
        self.assertEqual(burmese_label("[MY] အခန်း(၆) — page 1/6"), 6)
        self.assertEqual(burmese_label("[MY] အခန်း(ရ) — page 1/7"), 7)
        self.assertEqual(burmese_label("[MY] အခန်း94 — page 1/8"), 94)
        self.assertEqual(burmese_label("[MY] အခန်း ၁၉၅ — page 9/9"), 195)
        self.assertIsNone(burmese_label("[MY] no number here"))


class MapTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.docx = write_docx(self.dir / "episodes.docx", full_fixture())

    def test_read_headings_only_returns_marked_paragraphs(self):
        rows = read_headings(self.docx)
        self.assertTrue(rows)
        self.assertTrue(all(kind in ("zh", "my") for kind, _ in rows))
        self.assertTrue(all(text.startswith(("[ZH]", "[MY]")) for _, text in rows))

    def test_pairs_collapse_page_repeats_and_keep_quirks(self):
        chapter_map = build_map(read_headings(self.docx))
        self.assertEqual(chapter_map.by_chinese[1], [1])
        self.assertEqual(chapter_map.by_chinese[5], [5])      # အခန်း (၅)
        self.assertEqual(chapter_map.by_chinese[7], [7])      # အခန်း(ရ)
        # offset +1 after the split at Chinese 61
        self.assertEqual(chapter_map.by_chinese[61], [61, 62])
        self.assertEqual(chapter_map.by_chinese[62], [63])
        self.assertEqual(chapter_map.by_chinese[64], [65])    # 第六四意
        self.assertEqual(chapter_map.by_chinese[92], [93])    # bare 92 ↔ အခန်း93
        self.assertEqual(chapter_map.by_chinese[93], [94])    # Arabic digits
        self.assertEqual(chapter_map.by_chinese[137], [138, 139])
        self.assertEqual(chapter_map.by_chinese[193], [195])
        self.assertNotIn(194, chapter_map.by_chinese)
        self.assertEqual(len(chapter_map.pairs), 195)

    def test_summary_points_at_the_boundary(self):
        chapter_map = load_map(self.docx)
        summary = chapter_map.summary()
        self.assertEqual(summary["last_existing"], {"chinese": 193, "burmese": [195]})
        self.assertEqual(summary["next_without_reference"], 194)
        self.assertEqual(summary["splits"], {61: [61, 62], 137: [138, 139]})
        self.assertEqual(summary["chinese_chapters"], 193)
        self.assertEqual(summary["burmese_chapters"], 195)
        self.assertEqual(chapter_map.warnings, [])

    def test_missing_docx_is_an_error(self):
        with self.assertRaises(ChapterMapError):
            load_map(self.dir / "nope.docx")

    def test_docx_without_headings_is_an_error(self):
        empty = write_docx(self.dir / "empty.docx", [])
        with self.assertRaises(ChapterMapError):
            load_map(empty)

    def test_page_mismatch_is_reported_not_paired(self):
        chapter_map = build_map([
            ("zh", "[ZH] 第二章 — page 1/3"),
            ("my", "[MY] အခန်း 2 — page 2/3"),
        ])
        self.assertEqual(chapter_map.pairs, [])
        self.assertTrue(any("page mismatch" in warning for warning in chapter_map.warnings))

    def test_order_regression_is_reported(self):
        chapter_map = build_map([
            ("zh", "[ZH] 第二章 — page 1/1"),
            ("my", "[MY] အခန်း 2 — page 1/1"),
            ("zh", "[ZH] 第一章 — page 1/1"),
            ("my", "[MY] အခန်း 1 — page 1/1"),
        ])
        self.assertTrue(any("backwards" in warning for warning in chapter_map.warnings))

    def test_cli_writes_and_reads_the_map(self):
        out = self.dir / "map.json"
        self.assertEqual(map_main(["--docx", str(self.docx), "--write", str(out)]), 0)
        payload = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual(payload["last_existing"], {"chinese": 193, "burmese": [195]})
        self.assertEqual(payload["next_without_reference"], 194)
        self.assertEqual(len(payload["pairs"]), 195)


SOURCE = """===== 第六十一章：測試 =====

葉寧走進大殿。
他知道，今天要出事了。
===== 第六十二章：測試 =====

第二天，殿門打開。
===== 第六十三章：測試 =====

風起。
===== 第六十四章：測試 =====

沒有人知道答案。
"""

EXISTING = """Chapter 61: ချီ
ပထမတစ်ကြောင်း။

Chapter 62: ချီ ဒုတိယ
ဒုတိယတစ်ကြောင်း။

Chapter 63: ချီ တတိယ
တတိယတစ်ကြောင်း။

Chapter 64: ချီ စတုတ္ထ
စတုတ္ထတစ်ကြောင်း။
"""


class _Capture:
    def __init__(self):
        self.text = ""

    def write(self, value):
        self.text += value

    def flush(self):
        pass


class RunnerUsesMapTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.source = self.tmp / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.existing = self.tmp / "existing.txt"
        self.existing.write_text(EXISTING, encoding="utf-8")
        self.docx = write_docx(self.tmp / "episodes.docx", [
            "[ZH] 第六十一章 — page 1/2", "[MY] အခန်း 61 — page 1/2",
            "[ZH] 第六十一章 — page 2/2", "[MY] အခန်း 62 — page 2/2",
            "[ZH] 第六十二章 — page 1/1", "[MY] အခန်း 63 — page 1/1",
            "[ZH] 第六十三章 — page 1/1", "[MY] အခန်း 64 — page 1/1",
        ])
        self.out = self.tmp / "out"

    def run_cli(self, *extra):
        return api_translate.main([
            "--source-file", str(self.source), "--existing", str(self.existing),
            "--docx", str(self.docx), "--out-dir", str(self.out),
            "--cache", str(self.cache), *extra,
        ])

    def plan(self, *extra):
        capture = _Capture()
        with mock.patch("sys.stdout", capture):
            code = self.run_cli(*extra, "--plan", "--json")
        return code, (json.loads(capture.text) if capture.text.strip() else None)

    def test_last_points_at_the_chapter_behind_the_existing_burmese(self):
        code, plan = self.plan("--chapters", "last")
        self.assertEqual(code, 0)
        self.assertEqual([row["chapter"] for row in plan["chapters"]], [63])
        self.assertEqual(plan["existing"]["last_with_reference"], 63)
        self.assertEqual(plan["existing"]["next_without_reference"], 64)

    def test_next_points_at_the_first_untranslated_chapter(self):
        code, plan = self.plan("--chapters", "next")
        self.assertEqual(code, 0)
        self.assertEqual([row["chapter"] for row in plan["chapters"]], [64])

    def test_existing_selects_every_chapter_with_a_counterpart(self):
        code, plan = self.plan("--chapters", "existing")
        self.assertEqual(code, 0)
        self.assertEqual([row["chapter"] for row in plan["chapters"]], [61, 62, 63])

    def test_compare_pulls_both_halves_of_a_split(self):
        self.assertEqual(self.run_cli("--chapters", "61", "--run", "--json"), 0)
        report = json.loads((self.out / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["chapters"][0]["reference_chapters"], [61, 62])
        comparison = next(self.out.glob("compare-*.md")).read_text(encoding="utf-8")
        self.assertIn("chapter 61 + 62", comparison)
        self.assertIn("ဒုတိယတစ်ကြောင်း။", comparison)
        self.assertIn("Chinese 61–63 ↔ Burmese 61–64", comparison)

    def test_reference_follows_the_offset(self):
        self.assertEqual(self.run_cli("--chapters", "63", "--run", "--json"), 0)
        report = json.loads((self.out / "report.json").read_text(encoding="utf-8"))
        self.assertEqual(report["chapters"][0]["reference_chapters"], [64])
        comparison = next(self.out.glob("compare-*.md")).read_text(encoding="utf-8")
        self.assertIn("Existing human Burmese — chapter 64", comparison)
        self.assertIn("စတုတ္ထတစ်ကြောင်း။", comparison)

    def test_no_map_falls_back_to_identity_and_says_so(self):
        self.assertEqual(self.run_cli("--chapters", "61", "--run", "--no-map", "--json"), 0)
        report = json.loads((self.out / "report.json").read_text(encoding="utf-8"))
        self.assertFalse(report["reference"]["docx_map"])
        comparison = next(self.out.glob("compare-*.md")).read_text(encoding="utf-8")
        self.assertIn("matched by number", comparison)


if __name__ == "__main__":
    unittest.main()
