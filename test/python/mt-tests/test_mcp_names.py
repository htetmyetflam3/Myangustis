"""The four review/name tools, in process, with no network and no writes.

`register_name` is pointed at a temporary copy of the list; the real
`content/reference/EtoBnames.txt` is never touched.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "tools"))

import mcp_server  # noqa: E402
import names  # noqa: E402

SAMPLE = """\
Ye Nin = ယဲ့နင်
Liu Jin = လျိုချင်း
"""


class NameToolTests(unittest.TestCase):
    def setUp(self):
        self.server = mcp_server.Server(enabled_cache=False)
        self.tmp = tempfile.TemporaryDirectory()
        self.list_path = Path(self.tmp.name) / "EtoBnames.txt"
        self.list_path.write_text(SAMPLE, encoding="utf-8")
        self._original = names.NAMES_FILE
        names.NAMES_FILE = self.list_path

    def tearDown(self):
        names.NAMES_FILE = self._original
        self.tmp.cleanup()

    # -- lookup_name ---------------------------------------------------
    def test_lookup_by_key(self):
        result = self.server.call_tool("lookup_name", {"term": "Liu Jin"})
        self.assertEqual(result["entries"][0]["burmese"], "လျိုချင်း")
        self.assertEqual(result["entries"][0]["line"], 2)

    def test_lookup_by_burmese_form(self):
        result = self.server.call_tool("lookup_name", {"term": "ယဲ့နင်"})
        self.assertEqual(result["entries"][0]["key"], "Ye Nin")

    def test_lookup_without_a_term_lists_everything(self):
        result = self.server.call_tool("lookup_name", {})
        self.assertEqual(result["count"], 2)

    def test_lookup_unknown_suggests_registering(self):
        result = self.server.call_tool("lookup_name", {"term": "Nobody Here"})
        self.assertEqual(result["count"], 0)
        self.assertIn("register_name", result["suggestion"])

    # -- check_names ---------------------------------------------------
    def test_exact_hit(self):
        result = self.server.call_tool("check_names", {"text": "ယဲ့နင် က လာတယ်။"})
        self.assertEqual([row["burmese"] for row in result["hits"]], ["ယဲ့နင်"])
        self.assertEqual(result["verdict"], "clean")

    def test_variant_is_reported_with_its_canonical_form(self):
        result = self.server.call_tool("check_names", {"text": "လျိုကျင်း က လာတယ်။"})
        self.assertEqual(len(result["variants"]), 1)
        self.assertEqual(result["variants"][0]["canonical"], "လျိုချင်း")
        self.assertIn("list wins", result["verdict"])

    def test_empty_text_is_an_error(self):
        with self.assertRaises(ValueError):
            self.server.call_tool("check_names", {"text": "   "})

    # -- register_name -------------------------------------------------
    def test_register_appends(self):
        result = self.server.call_tool(
            "register_name", {"key": "Shen Ji", "burmese": "ရှန်းကျီ"})
        self.assertEqual(result["added"]["key"], "Shen Ji")
        self.assertIn("Shen Ji = ရှန်းကျီ",
                      self.list_path.read_text(encoding="utf-8"))

    def test_register_refuses_a_second_spelling(self):
        result = self.server.call_tool(
            "register_name", {"key": "Liu Jin", "burmese": "လျိုကျင်း"})
        self.assertIsNone(result["added"])
        self.assertIn("already", result["refused"])

    def test_register_is_idempotent(self):
        first = self.server.call_tool(
            "register_name", {"key": "Shen Ji", "burmese": "ရှန်းကျီ"})
        second = self.server.call_tool(
            "register_name", {"key": "Shen Ji", "burmese": "ရှန်းကျီ"})
        self.assertEqual(second["added"]["line"], first["added"]["line"])
        self.assertEqual(self.list_path.read_text(encoding="utf-8").count("Shen Ji"), 1)


class BriefToolTests(unittest.TestCase):
    def setUp(self):
        self.server = mcp_server.Server(enabled_cache=False)

    def test_brief_is_bounded_and_warns_about_voice(self):
        result = self.server.call_tool("review_brief", {})
        markdown = result["markdown"]
        self.assertLess(len(markdown), 60_000)
        self.assertIn("reviewer's voice is casual by design", markdown)
        self.assertIn("## Known translation defects", markdown)
        self.assertIn("## The story, part by part", markdown)
        self.assertGreater(result["characters"], 5)

    def test_a_smaller_budget_is_smaller(self):
        big = self.server.call_tool("review_brief", {"chars_per_arc": 420})["markdown"]
        small = self.server.call_tool("review_brief", {"chars_per_arc": 60})["markdown"]
        self.assertLess(len(small), len(big))

    def test_bad_argument(self):
        with self.assertRaises(ValueError):
            self.server.call_tool("review_brief", {"chars_per_arc": "many"})


class SchemaTests(unittest.TestCase):
    def test_the_four_tools_are_advertised(self):
        server = mcp_server.Server(enabled_cache=False)
        listed = server.handle({"id": 1, "method": "tools/list"})
        tools = {tool["name"]: tool for tool in listed["result"]["tools"]}
        for name in ("review_brief", "lookup_name", "check_names", "register_name",
                     "save_verse", "export_verse"):
            self.assertIn(name, tools)
        self.assertEqual(tools["save_verse"]["inputSchema"]["required"],
                         ["chapter", "kind"])
        self.assertIn("poem", tools["save_verse"]["inputSchema"]["properties"]["kind"]["enum"])
        self.assertEqual(tools["check_names"]["inputSchema"]["required"], ["text"])
        self.assertEqual(tools["register_name"]["inputSchema"]["required"],
                         ["key", "burmese"])
        json.dumps({name: tool["inputSchema"] for name, tool in tools.items()})


if __name__ == "__main__":
    unittest.main()
