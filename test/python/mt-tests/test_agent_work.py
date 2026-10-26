#!/usr/bin/env python3
"""Tests for the agent draft workspace (read / save / export) and its MCP tools.

No network and no API key are involved: drafting is local. A small Chinese
source, a small existing Burmese file and a synthetic DOCX provide the book.

    python3 -m unittest discover -s mt/tests -v
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
sys.path.insert(0, str(MT))
sys.path.insert(0, str(MT.parent / "tools"))
sys.path.insert(0, str(HERE))

import agent_work  # noqa: E402
from agent_work import (  # noqa: E402
    DraftError,
    DraftStore,
    chapter_paragraphs_by_number,
    paragraph_id,
    read_chapter,
)
from test_chapter_map import write_docx  # noqa: E402
from test_rapidapi import ApiTestCase  # noqa: E402

SOURCE = """===== 第六十一章：測試 =====

葉寧走進大殿。
“你來了？”她問。
他知道，今天要出事了。
===== 第六十二章：測試 =====

第二天，殿門打開。
風起。
"""

BURMESE = """Chapter 61: ချီ
ပ ထမ တစ် ကြောင်း။
ဒု တိယ တစ် ကြောင်း။

Chapter 62: ချီ ဒုတိယ
တ တိယ တစ် ကြောင်း။
"""


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.source = self.dir / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.existing = self.dir / "existing.txt"
        self.existing.write_text(BURMESE, encoding="utf-8")
        self.docx = write_docx(self.dir / "episodes.docx", [
            "[ZH] 第六十一章 — page 1/1", "[MY] အခန်း 61 — page 1/1",
            "[ZH] 第六十二章 — page 1/1", "[MY] အခန်း 62 — page 1/1",
        ])
        self.store = DraftStore(self.dir / "drafts.sqlite3")
        self.addCleanup(self.store.close)

    def read(self, chapter=61, **kwargs):
        return read_chapter(chapter, source=self.source, existing=self.existing,
                            docx=self.docx, store=self.store, **kwargs)

    # -- ids and reading --------------------------------------------

    def test_paragraph_ids_are_stable_and_text_bound(self):
        paragraphs = chapter_paragraphs_by_number(61, source=self.source)
        self.assertEqual(len(paragraphs), 3)
        first = paragraphs[0].id
        self.assertRegex(first, r"^0061-001-[0-9a-f]{8}$")
        self.assertEqual(first, chapter_paragraphs_by_number(61, source=self.source)[0].id)
        self.assertNotEqual(first, paragraph_id(61, 1, "different text"))
        self.assertNotEqual(first, paragraph_id(62, 1, paragraphs[0].text))

    def test_read_returns_text_ids_and_reference(self):
        payload = self.read()
        self.assertEqual(payload["chapter"], 61)
        self.assertEqual([row["index"] for row in payload["paragraphs"]], [1, 2, 3])
        self.assertEqual(payload["paragraphs"][1]["zh"], "“你來了？”她問。")
        self.assertEqual(payload["reference"]["chapters"], [61])
        self.assertEqual(payload["reference"]["lines"], 2)
        self.assertEqual(payload["drafts"], {"saved": 0, "missing": 3, "ids": []})
        self.assertTrue(payload["style"]["rules"])
        self.assertIn("content/reference/style-sample.txt", payload["style"]["files"])

    def test_read_can_skip_the_reference(self):
        payload = self.read(with_reference=False)
        self.assertEqual(payload["reference"]["lines"], 0)

    def test_reference_limit_is_reported(self):
        payload = self.read(reference_lines_limit=1)
        self.assertEqual(len(payload["reference"]["sample"]), 1)
        self.assertTrue(payload["reference"]["truncated"])

    def test_read_unknown_chapter(self):
        with self.assertRaises(DraftError) as caught:
            self.read(999)
        self.assertIn("no Chinese chapter 999", str(caught.exception))

    # -- saving ------------------------------------------------------

    def test_save_draft_records_provenance(self):
        paragraph = chapter_paragraphs_by_number(61, source=self.source)[1]
        result = self.store.save(paragraph, "သူ လာ ပြီ။", mt_text="raw mt",
                                 model="grok", note="tone: LSN")
        self.assertEqual(result["status"], "saved")
        row = self.store.find(61, 2)
        self.assertEqual(row["draft_text"], "သူ လာ ပြီ။")
        self.assertEqual(row["mt_text"], "raw mt")
        self.assertEqual(row["model"], "grok")
        self.assertEqual(row["note"], "tone: LSN")
        self.assertEqual(row["status"], "draft")

    def test_save_is_an_upsert_and_keeps_the_machine_text(self):
        paragraph = chapter_paragraphs_by_number(61, source=self.source)[0]
        self.store.save(paragraph, "first", mt_text="mt one", model="m1")
        self.store.save(paragraph, "second", model="m2")
        row = self.store.find(61, 1)
        self.assertEqual(row["draft_text"], "second")
        self.assertEqual(row["mt_text"], "mt one")     # not cleared
        self.assertEqual(row["model"], "m2")

    def test_empty_draft_is_refused(self):
        paragraph = chapter_paragraphs_by_number(61, source=self.source)[0]
        with self.assertRaises(DraftError):
            self.store.save(paragraph, "   ")
        self.assertEqual(self.store.ids_for(61), [])

    def test_find_by_id_prefix(self):
        paragraph = chapter_paragraphs_by_number(61, source=self.source)[2]
        self.store.save(paragraph, "text")
        self.assertIsNotNone(self.store.find(61, paragraph.id[:10]))
        self.assertIsNone(self.store.find(61, "nope"))

    def test_note_requires_an_existing_draft(self):
        with self.assertRaises(DraftError):
            self.store.note(61, 1, "too early")
        paragraph = chapter_paragraphs_by_number(61, source=self.source)[0]
        self.store.save(paragraph, "text")
        self.store.note(61, 1, "checked against chapter 61 reference")
        self.assertEqual(self.store.find(61, 1)["note"],
                         "checked against chapter 61 reference")

    def test_read_reports_saved_drafts(self):
        paragraph = chapter_paragraphs_by_number(61, source=self.source)[0]
        self.store.save(paragraph, "text")
        payload = self.read()
        self.assertEqual(payload["drafts"]["saved"], 1)
        self.assertEqual(payload["drafts"]["missing"], 2)

    # -- export ------------------------------------------------------

    def test_export_writes_text_and_comparison(self):
        paragraphs = chapter_paragraphs_by_number(61, source=self.source)
        self.store.save(paragraphs[0], "ပထမ။", mt_text="mt-1", model="grok")
        self.store.save(paragraphs[2], "တတိယ။", mt_text="mt-3", model="grok")
        out = self.dir / "out"
        result = self.store.export(61, out, source=self.source)
        self.assertEqual(result["drafted"], 2)
        self.assertEqual(result["missing"], 1)
        self.assertEqual(result["missing_first"], [2])
        text = (out / "ch0061.draft.my.txt").read_text(encoding="utf-8")
        self.assertIn("ပထမခ", text.replace("ပထမ။", "ပထမခ"))
        self.assertIn("တတိယ။", text)
        self.assertIn("“你來了？”她問。", text)     # missing draft keeps the source line
        compare = (out / "ch0061.draft.compare.md").read_text(encoding="utf-8")
        self.assertIn("2/3 paragraphs drafted", compare)
        self.assertIn("machine: mt-1", compare)
        self.assertIn("draft: ပထမ။", compare)
        self.assertIn("no draft yet", compare)

    def test_export_require_all_refuses_partial_chapters(self):
        paragraphs = chapter_paragraphs_by_number(61, source=self.source)
        self.store.save(paragraphs[0], "only one")
        with self.assertRaises(DraftError) as caught:
            self.store.export(61, self.dir / "out", require_all=True,
                              source=self.source)
        self.assertIn("missing drafts", str(caught.exception))

    def test_export_never_touches_machine_output(self):
        machine = self.dir / "machine"
        machine.mkdir()
        target = machine / "ch0061.my.txt"
        target.write_text("machine output\n", encoding="utf-8")
        paragraphs = chapter_paragraphs_by_number(61, source=self.source)
        self.store.save(paragraphs[0], "draft")
        self.store.export(61, self.dir / "drafts", source=self.source)
        self.assertEqual(target.read_text(encoding="utf-8"), "machine output\n")

    # -- stats -------------------------------------------------------

    def test_stats_and_chapter_listing(self):
        for chapter, count in ((61, 2), (62, 1)):
            paragraphs = chapter_paragraphs_by_number(chapter, source=self.source)
            for paragraph in paragraphs[:count]:
                self.store.save(paragraph, f"draft {chapter}")
        self.assertEqual(self.store.stats()["drafts"], 3)
        self.assertEqual([row["chapter"] for row in self.store.chapters()], [61, 62])

    # -- CLI ---------------------------------------------------------

    def cli(self, *args):
        return agent_work.main([
            "--store", str(self.dir / "drafts.sqlite3"),
            "--source", str(self.source), "--existing", str(self.existing),
            "--docx", str(self.docx), *args,
        ])

    def test_cli_roundtrip(self):
        capture = _Capture()
        with mock.patch("sys.stdout", capture):
            self.assertEqual(self.cli("read", "61"), 0)
        payload = json.loads(capture.text)
        identifier = payload["paragraphs"][0]["id"]
        with mock.patch("sys.stdout", _Capture()):
            self.assertEqual(self.cli("save", "61", identifier, "--draft", "ပထမ။",
                                      "--model", "grok"), 0)
        with mock.patch("sys.stdout", _Capture()):
            self.assertEqual(self.cli("export", "61", "--out-dir",
                                      str(self.dir / "out")), 0)
        self.assertTrue((self.dir / "out" / "ch0061.draft.my.txt").is_file())

    def test_cli_rejects_bad_selector(self):
        self.assertEqual(self.cli("save", "61", "99", "--draft", "x"), 2)
        self.assertEqual(self.cli("read", "999"), 2)


class _Capture:
    def __init__(self):
        self.text = ""

    def write(self, value):
        self.text += value

    def flush(self):
        pass


class McpDraftTests(ApiTestCase):
    """The same workspace through the MCP tools the agent actually calls."""

    def setUp(self):
        super().setUp()
        self.source = self.tmp / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.existing = self.tmp / "existing.txt"
        self.existing.write_text(BURMESE, encoding="utf-8")
        self.docx = write_docx(self.tmp / "episodes.docx", [
            "[ZH] 第六十一章 — page 1/1", "[MY] အခန်း 61 — page 1/1",
            "[ZH] 第六十二章 — page 1/1", "[MY] အခန်း 62 — page 1/1",
        ])
        self.drafts = self.tmp / "agent-drafts.sqlite3"
        agent_work.DraftStore(self.drafts).close()

    def server(self):
        from mcp_server import Server
        return Server(enabled_cache=True, cache_path=self.cache,
                      source_file=self.source, existing=self.existing,
                      out_dir=self.tmp / "out", draft_store=self.drafts,
                      docx=self.docx)

    def call(self, name, **arguments):
        return self.server().call_tool(name, arguments)

    def test_read_chapter_tool(self):
        payload = self.call("read_chapter", chapter=61)
        self.assertEqual(payload["chapter"], 61)
        self.assertEqual(len(payload["paragraphs"]), 3)
        self.assertEqual(payload["reference"]["chapters"], [61])
        self.assertEqual(payload["drafts"]["saved"], 0)

    def test_read_chapter_window_keeps_turns_small(self):
        """A whole 166-paragraph chapter is ~13k tokens, re-sent every turn."""
        payload = self.call("read_chapter", chapter=61, start=2, count=1)
        self.assertEqual([item["index"] for item in payload["paragraphs"]], [2])
        self.assertEqual(payload["window"],
                         {"start": 2, "count": 1, "total": 3,
                          "more": True, "next_start": 3})
        last = self.call("read_chapter", chapter=61, start=3, count=10)
        self.assertFalse(last["window"]["more"])
        self.assertIsNone(last["window"]["next_start"])
        self.assertEqual(len(last["paragraphs"]), 1)

    def test_read_chapter_window_outside_the_chapter_is_an_error(self):
        with self.assertRaises(ValueError):
            self.call("read_chapter", chapter=61, start=99)

    def test_save_then_read_and_export(self):
        payload = self.call("read_chapter", chapter=61)
        first = payload["paragraphs"][0]["id"]
        saved = self.call("save_draft", chapter=61, paragraph=first,
                          draft="ပထမ။", mt="mt-1", model="grok")
        self.assertEqual(saved["status"], "saved")
        again = self.call("read_chapter", chapter=61)
        self.assertEqual(again["drafts"]["saved"], 1)
        exported = self.call("export_drafts", chapter=61,
                             out_dir=str(self.tmp / "export"))
        self.assertEqual(exported["drafted"], 1)
        self.assertEqual(exported["missing"], 2)
        self.assertTrue(Path(exported["files"][0]).is_file())

    def test_bad_arguments_are_tool_errors(self):
        with self.assertRaises(ValueError):
            self.call("save_draft", chapter=61, paragraph="99", draft="x")
        with self.assertRaises(ValueError):
            self.call("save_draft", chapter=61, paragraph="1", draft="  ")
        with self.assertRaises(ValueError):
            self.call("read_chapter", chapter=True)


if __name__ == "__main__":
    unittest.main()
