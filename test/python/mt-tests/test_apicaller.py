#!/usr/bin/env python3
"""Offline tests for the two-chapter caller.

No key and no network here: the selection rules, the two-chapter limit and the
free plan are what this file checks. The paid path is exercised in
`test_rapidapi.py` through the MCP tool, which calls the same `translate_pair`.

    python3 -m unittest discover -s mt/tests -v
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
ROOT = MT.parent
sys.path.insert(0, str(MT))

import apicaller  # noqa: E402
import api_translate  # noqa: E402
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


class FakeMap:
    """The shape `resolve` reads, without building a DOCX."""

    chinese_covered = [1, 193]
    last_chinese = 193
    next_chinese = 194
    burmese_chapters = [1, 195]
    last_burmese = 195
    pairs = [(number, number) for number in range(1, 194)]


def chapters(*numbers: int) -> list[Chapter]:
    return [Chapter(number=number, title=f"第{number}章", body="段落。", source="")
            for number in numbers]


class SpecTests(unittest.TestCase):
    def test_ampersand_and_plus_mean_the_same_pair(self):
        for spec in ("194&195", "194+195", "194,195", "194-195", "194 195",
                     "--194&195"):
            with self.subTest(spec=spec):
                self.assertEqual(apicaller.parse_spec(spec), [194, 195])

    def test_single_chapter_is_allowed(self):
        self.assertEqual(apicaller.parse_spec("194"), [194])

    def test_repeated_numbers_collapse(self):
        self.assertEqual(apicaller.parse_spec("194&194&195"), [194, 195])

    def test_three_chapters_are_refused_with_the_next_commands(self):
        with self.assertRaises(apicaller.PairError) as caught:
            apicaller.parse_spec("194&195&196")
        message = str(caught.exception)
        self.assertIn("2 at a time", message)
        self.assertIn("--194+195", message)
        self.assertIn("--196", message)

    def test_all_is_refused(self):
        with self.assertRaises(apicaller.PairError):
            apicaller.resolve("all", chapters(194, 195), FakeMap())

    def test_absorb_only_rewrites_chapter_tokens(self):
        self.assertEqual(apicaller.absorb(["--194&195", "--run"]),
                         ["--chapters", "194&195", "--run"])
        self.assertEqual(apicaller.absorb(["--chapters", "1-2", "--json"]),
                         ["--chapters", "1-2", "--json"])
        self.assertEqual(apicaller.absorb(["--out-dir", str(ROOT)]),
                         ["--out-dir", str(ROOT)])

    def test_absorb_handles_a_range(self):
        self.assertEqual(apicaller.absorb(["--194-195"]),
                         ["--chapters", "194-195"])


class SelectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="apicaller-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def touch(self, number: int, target: str = "my") -> None:
        path = self.tmp / f"ch{number:04d}.{target}.jsonl"
        path.write_text("{}\n", encoding="utf-8")

    def test_default_pair_starts_after_the_human_translation(self):
        numbers, selected, note = apicaller.resolve(
            None, chapters(193, 194, 195, 196), FakeMap(), out_dir=self.tmp)
        self.assertEqual(numbers, [194, 195])
        self.assertEqual([chapter.number for chapter in selected], [194, 195])
        self.assertIn("after the human translation", note)

    def test_default_pair_advances_past_finished_chapters(self):
        self.touch(194)
        self.touch(195)
        numbers, _, _ = apicaller.resolve(
            None, chapters(193, 194, 195, 196, 197), FakeMap(), out_dir=self.tmp)
        self.assertEqual(numbers, [196, 197])

    def test_other_target_does_not_move_the_cursor(self):
        self.touch(194, target="en")
        numbers, _, _ = apicaller.resolve(
            None, chapters(194, 195), FakeMap(), out_dir=self.tmp)
        self.assertEqual(numbers, [194, 195])

    def test_nothing_left_is_an_actionable_error(self):
        self.touch(194)
        with self.assertRaises(apicaller.PairError) as caught:
            apicaller.resolve(None, chapters(194), FakeMap(), out_dir=self.tmp)
        self.assertIn("--status", str(caught.exception))

    def test_explicit_pair_needs_no_map(self):
        numbers, _, note = apicaller.resolve(
            "194&195", chapters(194, 195), None, out_dir=self.tmp)
        self.assertEqual(numbers, [194, 195])
        self.assertEqual(note, "requested")

    def test_missing_chapter_is_named(self):
        with self.assertRaises(apicaller.PairError) as caught:
            apicaller.resolve("194&195", chapters(194), None, out_dir=self.tmp)
        self.assertIn("195", str(caught.exception))

    def test_status_counts_what_is_left(self):
        self.touch(194)
        payload = apicaller.status(FakeMap(), chapters(194, 195, 196),
                                   out_dir=self.tmp)
        self.assertEqual(payload["done"], 1)
        self.assertEqual(payload["pending"], 2)
        self.assertEqual(payload["next"], [195, 196])
        self.assertEqual(payload["human_translation"]["chinese"], [1, 193])


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="apicaller-cli-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.source = self.tmp / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.out = self.tmp / "out"

    def run_cli(self, *args):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            code = apicaller.main(list(args))
        return code, stdout.getvalue(), stderr.getvalue()

    def base(self):
        return ["--source-file", str(self.source), "--out-dir", str(self.out),
                "--no-map"]

    def test_plan_writes_nothing_and_costs_nothing(self):
        code, out, _ = self.run_cli(*self.base(), "--194&195", "--json")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["pair"]["chapters"], [194, 195])
        self.assertEqual(payload["totals"]["requests"], 2)  # 3 paragraphs, 2 requests
        self.assertFalse(self.out.exists())

    def test_plan_lists_the_files_the_run_would_write(self):
        code, out, _ = self.run_cli(*self.base(), "--194+195")
        self.assertEqual(code, 0)
        self.assertIn("ch0194.my.jsonl", out)
        self.assertIn("pair-0194-0195.my.txt", out)
        self.assertIn("--194+195 --run", out)

    def test_three_chapters_exit_2_without_a_key(self):
        code, _, err = self.run_cli(*self.base(), "--194&195&196")
        self.assertEqual(code, 2)
        self.assertIn("2 at a time", err)

    def test_status_without_a_map_still_reports(self):
        code, out, _ = self.run_cli(*self.base(), "--status", "--json")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["mode"], "status")
        self.assertEqual(payload["next"], [])

    def test_api_translate_accepts_a_bulk_run(self):
        """The batch engine has no pair cap; apicaller.py is where it lives.

        With no key the run stops at 3 — before the first request — which is the
        proof it got past selection instead of being refused for its size.
        """
        with unittest.mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            with contextlib.redirect_stderr(io.StringIO()):
                code = api_translate.main(
                    ["--chapters", "194-196", "--run", "--no-compare",
                     "--source-file", str(self.source), "--no-map"])
        self.assertEqual(code, 3)

    def test_api_translate_plan_still_allows_three(self):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = api_translate.main(["--chapters", "194-196", "--source-file",
                                       str(self.source), "--no-map", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(len(json.loads(stdout.getvalue())["chapters"]), 3)


if __name__ == "__main__":
    unittest.main()
