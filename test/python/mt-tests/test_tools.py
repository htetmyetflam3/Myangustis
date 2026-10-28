"""Tests for the chapter title tools and the merged DOCX."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

import _paths  # noqa: F401 - configure the split proofreading modules

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3] / "C.Proofreading" / "main"
sys.path.insert(0, str(ROOT / "tools"))

import chapter_titles  # noqa: E402

class TitleTests(unittest.TestCase):
    def test_clean_title_drops_the_page_marker(self):
        self.assertEqual(
            chapter_titles.clean_title(
                "[ZH] 第一百九十三章:葉大人來了，青天就有了 — page 9/9"),
            "葉大人來了，青天就有了")

    def test_a_numbered_chapter_without_a_title_stays_empty(self):
        self.assertEqual(chapter_titles.clean_title("[ZH] 第一百零一章 — page 3/5"), "")

    def test_burmese_heading_is_not_echoed_as_a_title(self):
        self.assertEqual(chapter_titles.clean_title("[MY] အခန်း ၁၉၅ — page 9/9"), "")

    def test_reading_the_real_docx(self):
        docx = ROOT / "content" / "merged" / "episodes.docx"
        if not docx.is_file():
            self.skipTest("no merged DOCX in this checkout")
        chapters = chapter_titles.read_titles(docx)
        self.assertGreater(len(chapters), 100)
        self.assertIn(193, chapters)
        # The DOCX is the human-translated span; past it there is nothing.
        self.assertNotIn(194, chapters)

    def test_summary_counts_without_inventing(self):
        chapters = {1: {"chinese": 1, "title": "A", "burmese": 1,
                        "burmese_title": "", "page": 1},
                    3: {"chinese": 3, "title": "", "burmese": None,
                        "burmese_title": "", "page": None}}
        summary = chapter_titles.summarise(chapters)
        self.assertEqual(summary["missing_in_span"], [2])
        self.assertEqual(summary["with_burmese"], 1)


if __name__ == "__main__":
    unittest.main()
