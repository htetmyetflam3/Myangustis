"""One-file local MT outputs for the two Chinese/English routes."""
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "mt"))

import translate  # noqa: E402


class FakeEngine:
    name = "fake"

    def available(self):
        return True, "test engine"

    def translate(self, lines, source, target):
        return [f"{source}>{target}:{line}" for line in lines]


class OneFileTests(unittest.TestCase):
    def test_range_parser(self):
        self.assertEqual(translate.parse_chapter_range("1-408"), (1, 408))
        with self.assertRaises(ValueError):
            translate.parse_chapter_range("408-1")
        with self.assertRaises(ValueError):
            translate.parse_chapter_range("all")

    def test_scan_truncates_incomplete_last_chapter(self):
        text = (
            "===== Chapter 1 — First =====\n\ncomplete\n\n"
            "===== Chapter 2 — Second =====\n\npartial"
        )
        second = text.index("===== Chapter 2")
        self.assertEqual(translate.scan_onefile(text), ([1], second))

    def test_read_onefile_preserves_chapter_numbers_titles_and_bodies(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "zh-en.txt"
            path.write_text(
                "===== Chapter 7 — 中文题名 =====\n\nHello there.\nAnother line.\n\n",
                encoding="utf-8",
            )
            chapters = translate.read_onefile(path)
        self.assertEqual(len(chapters), 1)
        self.assertEqual(chapters[0].number, 7)
        self.assertEqual(chapters[0].title, "中文题名")
        self.assertEqual(chapters[0].body, "Hello there.\nAnother line.")

    def test_read_onefile_ignores_an_incomplete_tail(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "zh-en.txt"
            path.write_text(
                "===== Chapter 1 — First =====\n\nComplete.\n\n"
                "===== Chapter 2 — Second =====\n\nPartial",
                encoding="utf-8",
            )
            chapters = translate.read_onefile(path)
        self.assertEqual([chapter.number for chapter in chapters], [1])

    def test_select_unique_keeps_longest_body(self):
        chapters = [
            translate.Chapter(2, "short", "x", "chinese"),
            translate.Chapter(1, "one", "body", "chinese"),
            translate.Chapter(2, "long", "a much longer body", "chinese"),
        ]
        selected = translate.select_unique_chapters(chapters)
        self.assertEqual([(c.number, c.title) for c in selected], [(1, "one"), (2, "long")])

    def test_only_the_ocr_damaged_241_header_is_promoted_to_a_boundary(self):
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / "chinese.txt"
            source.write_text(
                "===== 第二百四十章：前章 =====\n前章正文。\n"
                "第二自四十一卓：第一頁 2/8\n第一頁正文。\n"
                "第二自四十一卓：第二頁 3/8\n第二頁正文。\n"
                "===== 第二百四十二章：後章 =====\n後章正文。\n"
                "第二百四十二卓：保留的頁眉。\n",
                encoding="utf-8",
            )
            chapters = translate.select_unique_chapters(translate.chinese_chapters(source))
        by_number = {chapter.number: chapter for chapter in chapters}
        self.assertEqual(by_number[241].body, "第一頁正文。\n第二頁正文。")
        self.assertEqual(by_number[241].title, "第二百四十一章")
        self.assertIn("第二百四十二卓", by_number[242].body)

    def test_chapter_241_ocr_page_headers_are_joined_once(self):
        fragments = [
            translate.Chapter(241, "第二自四十一卓", ": title 2/8\nfirst page\n", "chinese"),
            translate.Chapter(241, "第二自四十一卓", ": title 2/8\nfirst page\n", "chinese"),
            translate.Chapter(241, "第二自四十一卓", ": title 3/8\nsecond page\n", "chinese"),
        ]
        chapter = translate.select_unique_chapters(fragments)[0]
        self.assertEqual(chapter.title, "第二百四十一章")
        self.assertEqual(chapter.body, "first page\nsecond page")

    def test_run_onefile_writes_one_resumable_file(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "zh-en.txt"
            chapters = [
                translate.Chapter(1, "第一章", "你好。再见。", "chinese"),
                translate.Chapter(2, "第二章", "早上好。", "chinese"),
            ]
            with patch.object(translate, "resolve", return_value=FakeEngine()):
                result = translate.run_onefile(
                    "zh-en", engine_name="offline", output=output, chapters=chapters,
                    max_range=(1, 2),
                )
                resumed = translate.run_onefile(
                    "zh-en", engine_name="offline", output=output, chapters=chapters,
                    max_range=(1, 2),
                )
            self.assertEqual(result["translated"], 2)
            self.assertEqual(resumed["translated"], 0)
            self.assertEqual(resumed["skipped"], 2)
            self.assertEqual(len(list(Path(temp).iterdir())), 1)
            text = output.read_text(encoding="utf-8")
            self.assertEqual(text.count("===== Chapter "), 2)
            self.assertIn("zh>en:你好", text)

    def test_run_onefile_reports_failure_without_sidecar_files(self):
        class Unavailable(FakeEngine):
            def available(self):
                return False, "not installed"

        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / "zh-en.txt"
            with patch.object(translate, "resolve", return_value=Unavailable()):
                with self.assertRaisesRegex(RuntimeError, "not installed"):
                    translate.run_onefile(
                        "zh-en", engine_name="offline", output=output,
                        chapters=[translate.Chapter(1, "One", "text", "chinese")],
                        max_range=(1, 1),
                    )
            self.assertEqual(list(Path(temp).iterdir()), [])


if __name__ == "__main__":
    unittest.main()
