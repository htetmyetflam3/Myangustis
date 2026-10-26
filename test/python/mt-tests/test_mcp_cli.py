"""The public MCP CLI: one flag per tool, no implicit server start."""
from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
CLI = ROOT / "mcp.py"


class McpCliTests(unittest.TestCase):
    def run_cli(self, *args):
        return subprocess.run(
            [sys.executable, str(CLI), *args], cwd=ROOT,
            capture_output=True, text=True, timeout=30,
        )

    def test_no_flags_prints_help_and_does_not_start_server(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Pick one command", result.stdout)
        self.assertIn("--translate_text", result.stdout)
        self.assertNotIn('"jsonrpc"', result.stdout)

    def test_selftest_lists_all_eighteen_tools(self):
        result = self.run_cli("--selftest", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(len(payload["tools"]), 18)

    def test_each_mcp_tool_has_its_exact_name_as_a_flag(self):
        sys.path.insert(0, str(ROOT / "tools"))
        from mcp_server import TOOLS
        from tools.mcp import build_parser
        options = build_parser()._option_string_actions
        for tool in TOOLS:
            with self.subTest(tool=tool["name"]):
                self.assertIn("--" + tool["name"], options)

    def test_tool_name_flags_are_aliases(self):
        result = self.run_cli("--read_chapter", "194", "--count", "1", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(payload["chapter"], 194)
        self.assertEqual(len(payload["paragraphs"]), 1)

    def test_get_title_spellings_and_audit_typo_alias(self):
        title = self.run_cli("--getTitle", "193")
        self.assertEqual(title.returncode, 0, title.stderr)
        self.assertIn("葉大人來了", title.stdout)
        audit = self.run_cli("--insecpt", "--check-range", "194-408")
        self.assertEqual(audit.returncode, 1)
        self.assertIn("298, 299", audit.stdout)
        self.assertNotIn("241", audit.stdout)

    def test_burmese_context_cli_requires_the_current_chapter(self):
        result = self.run_cli("--previous_burmese_context", "နတ်")
        self.assertEqual(result.returncode, 2)
        self.assertIn("needs --chapter", result.stderr)

    def test_conflicting_commands_are_usage_error(self):
        result = self.run_cli("--selftest", "--read", "194")
        self.assertEqual(result.returncode, 2)
        self.assertIn("one command per run", result.stderr)

    def test_unknown_tool_option_is_argparse_usage_error(self):
        result = self.run_cli("--not-a-tool")
        self.assertEqual(result.returncode, 2)
        self.assertIn("usage:", result.stderr)

    def test_config_launch_targets_root_cli_in_serve_mode(self):
        result = self.run_cli("--print-config", "--client", "kilo", "--json")
        self.assertEqual(result.returncode, 0, result.stderr)
        entry = json.loads(result.stdout)["mcp"]["rapidapi-translator"]
        self.assertEqual(Path(entry["command"][1]), CLI)
        self.assertEqual(entry["command"][2], "--serve")


if __name__ == "__main__":
    unittest.main()
