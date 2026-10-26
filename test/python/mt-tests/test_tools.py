"""The `tools/` scripts: read the sources without reading the sources.

Two of these exist because the only other way to answer their questions is to
scroll a 4 MB crawl or a 673 KB review by hand. The tests hold the line that
matters: a tool either answers from the file it is given, or says it cannot —
it never invents a chapter number or a title.
"""
from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "tools"))

import audit_source  # noqa: E402
import chapter_titles  # noqa: E402

SOURCE = """===== 第一章：開始 =====

第一段。

===== 第二章：繼續 =====

第二段。

*長按喜歡的段落可記錄想法第三章：貼在正文裡的標題

第三段。
===== 第四章：再來 =====

第四段。
"""


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.path = Path(self.tmpdir.name) / "source.txt"
        self.path.write_text(SOURCE, encoding="utf-8")

    def test_counts_chapters_and_finds_the_glued_heading(self):
        audit = audit_source.scan(self.path)
        self.assertEqual(audit["present"], [1, 2, 3, 4])
        self.assertEqual(audit["inline_headings"], 1)
        self.assertEqual(audit["inline_only"], [3])
        self.assertEqual(audit["missing"], [])

    def test_a_hole_is_reported_not_papered_over(self):
        self.path.write_text(
            "===== 第一章：一開始 =====\n\n一段。\n\n"
            "===== 第三章：跳過了 =====\n\n三段。\n", encoding="utf-8")
        audit = audit_source.scan(self.path)
        self.assertEqual(audit["missing"], [2])

    def test_check_exits_1_when_the_range_has_holes(self):
        stderr = io.StringIO()
        with contextlib.redirect_stderr(stderr), \
                contextlib.redirect_stdout(io.StringIO()):
            code = audit_source.main(["--source", str(self.path),
                                      "--check", "1-6", "--json"])
        self.assertEqual(code, 1)

    def test_check_exits_0_on_a_clean_range(self):
        with contextlib.redirect_stdout(io.StringIO()):
            code = audit_source.main(["--source", str(self.path),
                                      "--check", "1-4"])
        self.assertEqual(code, 0)

    def test_titles_come_from_the_source(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            audit_source.main(["--source", str(self.path), "--titles",
                               "--from", "2", "--to", "4", "--json"])
        rows = json.loads(stdout.getvalue())
        self.assertEqual([r["number"] for r in rows], [2, 3, 4])
        self.assertIn("繼續", rows[0]["title"])

    def test_a_missing_source_is_an_error_not_an_empty_report(self):
        with contextlib.redirect_stderr(io.StringIO()):
            code = audit_source.main(["--source", str(self.path) + ".nope"])
        self.assertEqual(code, 4)


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
