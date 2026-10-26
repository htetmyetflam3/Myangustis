"""`--tools` narrows the advertised schema, which is paid for every request.

Eighteen tool schemas are ~12.9k characters, and they ride along with *every*
request. On a free 8,000-token-per-minute budget that is a large part of the
minute before the model reads anything, so the server can be started with only
the tools the current phase needs. The tools stay in the code; the advertisement
shrinks.
"""
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "tools"))

import mcp_server  # noqa: E402

ALL = {tool["name"] for tool in mcp_server.TOOLS}


def advertised(server) -> list[str]:
    listed = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    return [tool["name"] for tool in listed["result"]["tools"]]


class ResolutionTests(unittest.TestCase):
    def test_no_spec_means_every_tool(self):
        self.assertIsNone(mcp_server.resolve_tools(None))
        self.assertIsNone(mcp_server.resolve_tools("   "))
        self.assertEqual(len(advertised(mcp_server.Server(enabled_cache=False))), len(ALL))

    def test_a_group_resolves_to_its_tools(self):
        self.assertEqual(mcp_server.resolve_tools("names"),
                         {"lookup_name", "check_names", "register_name"})

    def test_several_groups_and_bare_names(self):
        wanted = mcp_server.resolve_tools("names,segment_text")
        self.assertIn("check_names", wanted)
        self.assertIn("segment_text", wanted)
        self.assertNotIn("translate_text", wanted)

    def test_english_group_and_preset(self):
        self.assertEqual(mcp_server.resolve_tools("english"), {
            "compare_english_chapter", "previous_burmese_context",
        })
        preset = mcp_server.resolve_tools("english-review")
        self.assertIn("compare_english_chapter", preset)
        self.assertIn("previous_burmese_context", preset)
        self.assertNotIn("translate_text", preset)

    def test_presets_shrink_the_schema(self):
        full = len(json.dumps(mcp_server.TOOLS, ensure_ascii=False))
        for preset in ("lean", "survey", "edit"):
            server = mcp_server.Server(enabled_cache=False,
                                       tools=mcp_server.resolve_tools(preset))
            subset = server.handle({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
            size = len(json.dumps(subset["result"]["tools"], ensure_ascii=False))
            self.assertLess(size, full * 0.8, preset)
        lean = mcp_server.Server(enabled_cache=False,
                                 tools=mcp_server.resolve_tools("lean"))
        self.assertLess(len(json.dumps(lean.handle(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})["result"]["tools"],
            ensure_ascii=False)), 6000)

    def test_an_unknown_spec_is_an_error_not_a_silent_full_list(self):
        with self.assertRaises(ValueError):
            mcp_server.resolve_tools("nmaes")

    def test_every_group_and_preset_names_real_tools(self):
        for group, members in mcp_server.TOOL_GROUPS.items():
            for name in members:
                self.assertIn(name, ALL, group)
        for preset, members in mcp_server.TOOL_PRESETS.items():
            for name in members:
                self.assertTrue(name in mcp_server.TOOL_GROUPS or name in ALL, preset)


class CallTests(unittest.TestCase):
    def test_a_disabled_tool_refuses_instead_of_pretending(self):
        server = mcp_server.Server(enabled_cache=False,
                                   tools=mcp_server.resolve_tools("lean"))
        with self.assertRaises(ValueError) as caught:
            server.call_tool("register_name", {"key": "x", "burmese": "က"})
        self.assertIn("--tools", str(caught.exception))

    def test_an_enabled_tool_still_answers(self):
        server = mcp_server.Server(enabled_cache=False,
                                   tools=mcp_server.resolve_tools("lean"))
        result = server.call_tool("check_names", {"text": "လျိုကျင်းက"})
        self.assertTrue(result["variants"])

    def test_the_default_server_is_unchanged(self):
        server = mcp_server.Server(enabled_cache=False)
        self.assertEqual(set(advertised(server)), ALL)


if __name__ == "__main__":
    unittest.main()
