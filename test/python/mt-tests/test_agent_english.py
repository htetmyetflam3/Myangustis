"""Local-only tests for the three-column English review and Burmese context."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "mt"))

import agent_english  # noqa: E402
import mcp_server  # noqa: E402
from chapter_map import ChapterMap  # noqa: E402


class EnglishComparisonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "chinese.txt"
        self.source.write_text(
            "===== 第十章：測試 =====\n\n"
            "第一句。第二句！\n\n"
            "第二段。\n", encoding="utf-8")
        self.machine = self.root / "machine.en.txt"
        self.machine.write_text(
            "Chapter 10: test\n================\n"
            "Machine one.\nMachine two!\nMachine three.\n", encoding="utf-8")
        self.api = self.root / "ch0010.en.jsonl"
        records = [
            {"chapter": 10, "index": 1, "source": "第一句。第二句！",
             "target": "API paragraph one."},
            {"chapter": 10, "index": 2, "source": "第二段。",
             "target": "API paragraph two."},
        ]
        self.api.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n"
                                          for row in records), encoding="utf-8")

    def test_per_paragraph_three_way_alignment_groups_local_sentences(self):
        result = agent_english.compare_english_chapter(
            10, source_file=self.source, machine_file=self.machine,
            api_file=self.api)
        self.assertEqual(result["window"], {
            "start": 1, "count": 2, "total": 2, "more": False, "next_start": None,
        })
        self.assertEqual(result["lines"][0]["zh"], "第一句。第二句！")
        self.assertEqual(result["lines"][0]["machine_en"], "Machine one. Machine two!")
        self.assertEqual(result["lines"][0]["api_en"], "API paragraph one.")
        self.assertTrue(result["alignment"]["api_en"]["source_checked"])

    def test_consolidated_local_machine_file_is_parsed(self):
        one_file = self.root / "zh-en.txt"
        one_file.write_text(
            "===== Chapter 10 — Test =====\n\n"
            "Machine one.\nMachine two!\nMachine three.\n\n",
            encoding="utf-8")
        result = agent_english.compare_english_chapter(
            10, source_file=self.source, machine_file=one_file, api_file=self.api)
        self.assertEqual(result["lines"][0]["machine_en"], "Machine one. Machine two!")
        self.assertEqual(result["alignment"]["machine_en"]["file"], str(one_file))

    def test_refuses_shifted_api_jsonl(self):
        data = self.api.read_text(encoding="utf-8").replace("第一句。第二句！", "different source")
        self.api.write_text(data, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "source mismatch"):
            agent_english.compare_english_chapter(
                10, source_file=self.source, machine_file=self.machine,
                api_file=self.api)

    def test_refuses_local_mt_line_count_mismatch(self):
        self.machine.write_text("Chapter 10\n=====\nOnly one line.\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "alignment refused"):
            agent_english.compare_english_chapter(
                10, source_file=self.source, machine_file=self.machine,
                api_file=self.api)

    def test_default_inputs_are_the_two_consolidated_files(self):
        machine = self.root / "zh-en.txt"
        machine.write_text(
            "===== Chapter 10 — Test =====\n\n"
            "Machine one.\nMachine two!\nMachine three.\n\n",
            encoding="utf-8")
        api = self.root / "english.txt"
        api.write_text(
            "===== Chapter 10 — Test =====\n\n"
            "API paragraph one.\n\nAPI paragraph two.\n\n",
            encoding="utf-8")
        from unittest.mock import patch
        with patch.object(agent_english, "DEFAULT_MACHINE_FILE", machine):
            with patch.object(agent_english, "DEFAULT_API_FILE", api):
                result = agent_english.compare_english_chapter(10, source_file=self.source)
        self.assertEqual(result["alignment"]["machine_en"]["file"], str(machine))
        self.assertEqual(result["alignment"]["api_en"]["file"], str(api))

    def test_default_api_does_not_fall_back_to_per_chapter_files(self):
        from unittest.mock import patch
        api = self.root / "english.txt"
        api.write_text("===== Chapter 11 — Other =====\n\nText.\n\n", encoding="utf-8")
        fallback = self.root / "rapidapi" / "ch0010.en.jsonl"
        fallback.parent.mkdir()
        fallback.write_text("{}", encoding="utf-8")
        with patch.object(agent_english, "DEFAULT_API_FILE", api):
            with self.assertRaisesRegex(ValueError, "has no chapter 10"):
                agent_english._api_english(10, ["第一句。", "第二段。"], None, None)

    def test_one_file_api_rows_are_streamed_and_count_checked(self):
        one_file = self.root / "english.txt"
        one_file.write_text(
            "===== Chapter 10 — Test =====\n\nAPI paragraph one.\n\n"
            "API paragraph two.\n\n", encoding="utf-8")
        result = agent_english.compare_english_chapter(
            10, source_file=self.source, machine_file=self.machine,
            api_file=one_file)
        self.assertEqual([row["api_en"] for row in result["lines"]],
                         ["API paragraph one.", "API paragraph two."])

    def test_mcp_tool_dispatch_returns_the_same_alignment(self):
        server = mcp_server.Server(enabled_cache=False, source_file=self.source)
        result = server.call_tool("compare_english_chapter", {
            "chapter": 10, "machine_file": str(self.machine), "api_file": str(self.api),
        })
        self.assertEqual(result["lines"][0]["api_en"], "API paragraph one.")
        self.assertIn("previous_burmese_context",
                      {tool["name"] for tool in mcp_server.TOOLS})


class BurmeseContextTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.burmese = self.root / "burmese.txt"
        self.burmese.write_text(
            "Chapter 108: one\nမတိုင်မီ တစ်ကြောင်း။\nပုလိပ်နတ်ဘုရားကို ခေါ်သည်။\nနောက်တစ်ကြောင်း။\n"
            "Chapter 109: two\nနတ်တို့ စောင့်နေကြသည်။\n", encoding="utf-8")
        self.mapping = ChapterMap([(8, 108), (9, 109)])

    def test_requires_current_chapter_and_searches_two_previous_chapters(self):
        from unittest.mock import patch
        with patch.object(agent_english, "load_or_derive", return_value=self.mapping):
            result = agent_english.previous_burmese_context(
                10, "နတ်", burmese_file=self.burmese, docx=self.root / "unused.docx",
                before=1, after=1)
        self.assertEqual(result["current_chinese_chapter"], 10)
        self.assertEqual([(row["chinese"], row["burmese"])
                          for row in result["searched_chapters"]], [(8, 108), (9, 109)])
        self.assertEqual(result["hit_count"], 2)
        self.assertIn("encoding damage", result["note"])
        first = result["hits"][0]
        self.assertEqual(first["burmese_chapter"], 108)
        self.assertEqual(first["context"][0]["text"], "မတိုင်မီ တစ်ကြောင်း။")
        self.assertTrue(first["context"][1]["match"])

    def test_mcp_tool_dispatch_uses_the_required_chapter(self):
        from unittest.mock import patch
        server = mcp_server.Server(enabled_cache=False, existing=self.burmese)
        with patch.object(agent_english, "load_or_derive", return_value=self.mapping):
            result = server.call_tool("previous_burmese_context", {
                "chapter": 10, "keyword": "နတ်", "before": 0, "after": 0,
            })
        self.assertEqual(result["current_chinese_chapter"], 10)
        self.assertEqual([hit["burmese_chapter"] for hit in result["hits"]], [108, 109])

    def test_rejects_non_burmese_keyword(self):
        with self.assertRaisesRegex(ValueError, "Burmese"):
            agent_english.previous_burmese_context(194, "god")


if __name__ == "__main__":
    unittest.main()
