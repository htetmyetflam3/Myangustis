"""The single-text-file batch mode: one `.txt`, no database, no sidecars.

`mt/api_translate.py --chapters 194-408 --target en --one-file out.txt --run`
translates the range and writes one file. These tests hold that promise: the
directory must contain the text and nothing else, a killed run must resume
without duplicating or leaving a stump, and a missing key must fail before any
file is created.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
sys.path.insert(0, str(MT))

import api_translate  # noqa: E402
from rapidapi_translator import TranslatorError  # noqa: E402
from translate import Chapter  # noqa: E402

SOURCE = """===== 第一百九十四章：善意 =====

大周，帝都盛京。

他叫葉寧。
===== 第一百九十五章：很賺 =====

第二段。

第三段。
===== 第一百九十六章：前路 =====

第四段。
"""


class FakeTranslator:
    """Stands in for CachedTranslator: counts calls, answers in English."""

    def __init__(self, *args, **kwargs):
        self.calls = 0
        self.closed = False

    def translate_batch(self, texts, target, source="auto"):
        self.calls += 1
        return SimpleNamespace(requests=1, texts=[f"EN({text})" for text in texts])

    def close(self):
        self.closed = True


def chapters(*numbers: int) -> list[Chapter]:
    return [Chapter(number=number, title=f"第{number}章", body="第一段。\n\n第二段。",
                    source="") for number in numbers]


class OneFileTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.dir = Path(self.tmpdir.name)
        self.path = self.dir / "english.txt"

    def write(self, selected, **kwargs):
        fake = FakeTranslator()
        result = api_translate.translate_into_one_file(
            selected, path=self.path, target="en", translator=fake, **kwargs)
        return result, fake

    def test_only_the_one_file_exists(self):
        self.write(chapters(194, 195))
        self.assertEqual([p.name for p in self.dir.iterdir()], ["english.txt"])

    def test_no_sqlite_and_no_sidecars_anywhere(self):
        self.write(chapters(194, 195, 196))
        names = {p.name for p in self.dir.rglob("*")}
        for forbidden in (".jsonl", ".sqlite3", ".md", ".json"):
            self.assertFalse([name for name in names if name.endswith(forbidden)],
                             f"unexpected {forbidden}: {sorted(names)}")

    def test_each_chapter_gets_one_heading(self):
        self.write(chapters(194, 195))
        text = self.path.read_text(encoding="utf-8")
        self.assertEqual(text.count("===== Chapter "), 2)
        self.assertIn("===== Chapter 194 — 第194章 =====", text)
        self.assertIn("EN(第一段。)", text)

    def test_a_second_run_adds_nothing(self):
        self.write(chapters(194, 195))
        before = self.path.read_text(encoding="utf-8")
        result, fake = self.write(chapters(194, 195))
        self.assertEqual(result["skipped"], 2)
        self.assertEqual(fake.calls, 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), before)

    def test_resume_starts_where_the_file_stops(self):
        self.write(chapters(194, 195))
        result, fake = self.write(chapters(194, 195, 196))
        self.assertEqual(result["skipped"], 2)
        self.assertEqual(fake.calls, 1)
        self.assertEqual(self.path.read_text(encoding="utf-8").count("Chapter "), 3)

    def test_a_killed_chapter_is_rewritten_not_duplicated(self):
        self.write(chapters(194, 195))
        text = self.path.read_text(encoding="utf-8")
        self.path.write_text(text + "===== Chapter 196 — 第196章 =====\n\nEN(第一",
                             encoding="utf-8")
        result, fake = self.write(chapters(194, 195, 196))
        after = self.path.read_text(encoding="utf-8")
        self.assertEqual(result["skipped"], 2)
        self.assertEqual(fake.calls, 1)
        self.assertEqual(after.count("Chapter 196"), 1)
        self.assertNotIn("EN(第一\n", after)
        self.assertTrue(after.endswith("\n\n"))

    def test_a_foreign_file_is_refused(self):
        self.path.write_text("some other notes\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self.write(chapters(194))

    def test_the_heading_is_the_cursor(self):
        self.write(chapters(194, 195, 196))
        text = self.path.read_text(encoding="utf-8")
        done, cut = api_translate.scan_block(text)
        self.assertEqual(done, [194, 195, 196])
        self.assertEqual(cut, len(text))


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.dir = Path(self.tmpdir.name)
        self.source = self.dir / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.path = self.dir / "english.txt"

    def base(self):
        return ["--source-file", str(self.source), "--no-map", "--target", "en"]

    def test_plan_creates_no_file(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = api_translate.main(["--chapters", "194-196", "--one-file",
                                       str(self.path), *self.base(), "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(len(json.loads(stdout.getvalue())["chapters"]), 3)
        self.assertFalse(self.path.exists())

    def test_a_range_is_accepted_without_allow_bulk(self):
        # The cap is gone here; the run reaches the key check and stops with 3.
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            with contextlib.redirect_stderr(io.StringIO()):
                code = api_translate.main(["--chapters", "194-196", "--run",
                                           "--one-file", str(self.path),
                                           *self.base()])
        self.assertEqual(code, 3)

    def test_a_missing_key_leaves_no_empty_file(self):
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            with contextlib.redirect_stderr(io.StringIO()):
                api_translate.main(["--chapters", "194", "--run", "--one-file",
                                    str(self.path), *self.base()])
        self.assertFalse(self.path.exists())

    def test_one_file_implies_english(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            api_translate.main(["--chapters", "194", "--one-file", str(self.path),
                                "--source-file", str(self.source), "--no-map",
                                "--json"])
        self.assertEqual(json.loads(stdout.getvalue())["target"], "en")

    def test_holes_in_a_range_are_skipped_under_one_file(self):
        stderr = io.StringIO()
        stdout = io.StringIO()
        with contextlib.redirect_stderr(stderr), contextlib.redirect_stdout(stdout):
            code = api_translate.main(["--chapters", "194-200", "--one-file",
                                       str(self.path), *self.base(), "--json"])
        self.assertEqual(code, 0)
        self.assertIn("197", stderr.getvalue().replace(", ", ","))
        self.assertEqual(len(json.loads(stdout.getvalue())["chapters"]), 3)


if __name__ == "__main__":
    unittest.main()
