#!/usr/bin/env python3
"""Offline tests for the RapidAPI translator client, chapter runner and MCP server.

A local HTTP server imitates the three documented endpoints, including failures,
so the tests need no key and no internet:

    python3 -m unittest discover -s mt/tests -v
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.parse import parse_qsl, urlsplit

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
ROOT = MT.parent
sys.path.insert(0, str(MT))

import api_translate  # noqa: E402
from rapidapi_translator import (  # noqa: E402
    CachedTranslator,
    RapidApiClient,
    TranslatorError,
    chunk_texts,
    load_env_file,
    parse_chapters,
    split_text,
)

KEY = "test-key-0123456789"
BURMESE = "မြန်မာ:"  # what a real my-target answer starts with
HOST = "test.example"
LANGUAGE = {"language": "zh-Hant", "language_name": "Chinese (Traditional)"}


# ---------------------------------------------------------------- mock API


class _Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self):  # noqa: N802 - BaseHTTPRequestHandler API
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8")
        parsed = urlsplit(self.path)
        record = {
            "path": parsed.path,
            "params": dict(parse_qsl(parsed.query)),
            "body": body,
            "content_type": self.headers.get("Content-Type", ""),
            "key": self.headers.get("X-RapidAPI-Key", ""),
            "host": self.headers.get("X-RapidAPI-Host", ""),
        }
        self.server.requests.append(record)
        directive = self.server.directives.pop(0) if self.server.directives else None
        if directive is not None:
            if directive.get("redirect"):
                self.send_response(307)
                self.send_header("Location", "/translate")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            self._send(directive.get("status", 200), directive.get("payload", {}),
                       directive.get("headers"))
            return
        if parsed.path == "/detect":
            self._send(200, {"status": True, "data": dict(LANGUAGE)})
        elif parsed.path == "/translate":
            self._send(200, {"status": True, "data": {
                "translated_text": BURMESE + body,
                "source_language": "zh-Hant",
                "source_language_name": "Chinese (Traditional)",
            }})
        elif parsed.path == "/translate/batch":
            texts = json.loads(body)
            self._send(200, {"status": True, "data": {
                "translated_texts": [BURMESE + text for text in texts],
                "source_language": "zh-Hant",
                "source_language_name": "Chinese (Traditional)",
            }})
        else:
            self._send(404, {"status": False, "error": "unknown path"})

    def _send(self, status, payload, headers=None):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8") \
            if not isinstance(payload, bytes) else payload
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):  # silence the test log
        pass


class MockApi:
    def __init__(self):
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
        self.httpd.daemon_threads = True
        self.httpd.requests = []
        self.httpd.directives = []
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.httpd.shutdown()
        self.httpd.server_close()

    @property
    def url(self):
        return f"http://127.0.0.1:{self.httpd.server_address[1]}"

    @property
    def requests(self):
        return self.httpd.requests

    def queue(self, status=200, payload=None, headers=None, redirect=False):
        self.httpd.directives.append({
            "status": status, "payload": payload or {}, "headers": headers,
            "redirect": redirect,
        })

    def last(self):
        return self.requests[-1]


class ApiTestCase(unittest.TestCase):
    def setUp(self):
        self.api = MockApi().start()
        self.addCleanup(self.api.stop)
        self.tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmpdir.cleanup)
        self.tmp = Path(self.tmpdir.name)
        self.cache = self.tmp / "cache.sqlite3"
        patcher = mock.patch.dict(os.environ, {
            "RAPIDAPI_KEY": KEY,
            "RAPIDAPI_BASE_URL": self.api.url,
            "RAPIDAPI_HOST": HOST,
            "RAPIDAPI_CACHE": str(self.cache),
        })
        patcher.start()
        self.addCleanup(patcher.stop)

    def client(self, **kwargs):
        kwargs.setdefault("backoff", 0.01)
        return RapidApiClient(**kwargs)

    def cached(self, **kwargs):
        kwargs.setdefault("backoff", 0.01)
        kwargs.setdefault("cache_path", self.cache)
        return CachedTranslator(**kwargs)


# ---------------------------------------------------------------- client


class ClientTests(ApiTestCase):
    def test_detect_posts_raw_text(self):
        result = self.client().detect("大周，帝都盛京。")
        self.assertEqual(result["language"], "zh-Hant")
        record = self.api.last()
        self.assertEqual(record["path"], "/detect")
        self.assertEqual(record["body"], "大周，帝都盛京。")
        self.assertTrue(record["content_type"].startswith("text/plain"))
        self.assertEqual(record["key"], KEY)
        self.assertEqual(record["host"], HOST)

    def test_translate_uses_query_and_raw_body(self):
        data = self.client().translate("你好", "my", "auto")
        self.assertEqual(data["translated_text"], BURMESE + "你好")
        record = self.api.last()
        self.assertEqual(record["path"], "/translate")
        self.assertEqual(record["params"], {"source": "auto", "target": "my"})
        self.assertEqual(record["body"], "你好")
        self.assertTrue(record["content_type"].startswith("text/plain"))

    def test_batch_deduplicates_and_keeps_order(self):
        result = self.client().translate_batch(["一", "二", "一", "三"], "my")
        self.assertEqual(result.texts, [BURMESE + "一", BURMESE + "二", BURMESE + "一", BURMESE + "三"])
        self.assertEqual(result.requests, 1)
        self.assertEqual(json.loads(self.api.last()["body"]), ["一", "二", "三"])
        self.assertEqual(self.api.last()["params"], {"source": "auto", "target": "my"})

    def test_batch_chunks_by_item_limit(self):
        texts = [f"第{i}段" for i in range(5)]
        result = self.client(max_items=2).translate_batch(texts, "my")
        self.assertEqual(result.texts, [BURMESE + text for text in texts])
        self.assertEqual(result.requests, 3)

    def test_batch_chunks_by_character_limit(self):
        texts = ["一" * 30, "二" * 30, "三" * 30]
        result = self.client(max_chars=50).translate_batch(texts, "my")
        self.assertEqual(result.texts, [BURMESE + text for text in texts])
        self.assertEqual(result.requests, 3)

    def test_long_string_is_split_and_rejoined(self):
        text = "第一句話。第二句話。第三句話。第四句話。"
        client = self.client(max_chars=12)
        result = client.translate_batch([text], "my")
        self.assertEqual(result.requests, 2)
        self.assertTrue(result.texts[0].startswith(BURMESE + "第一句話。"))
        self.assertIn("第四句話", result.texts[0])

    def test_status_false_raises(self):
        self.api.queue(200, {"status": False, "error": "quota exhausted"})
        with self.assertRaises(TranslatorError) as caught:
            self.client().translate("hi", "my")
        self.assertIn("quota exhausted", str(caught.exception))

    def test_forbidden_redacts_key(self):
        self.api.queue(403, {"message": f"invalid key {KEY}"})
        with self.assertRaises(TranslatorError) as caught:
            self.client().translate("hi", "my")
        message = str(caught.exception)
        self.assertNotIn(KEY, message)
        self.assertIn("<redacted>", message)
        self.assertIn("HTTP 403", message)

    def test_429_is_retried(self):
        self.api.queue(429, {"error": "slow down"}, {"Retry-After": "0"})
        self.api.queue(429, {"error": "slow down"}, {"Retry-After": "0"})
        client = self.client()
        result = client.translate_batch(["一"], "my")
        self.assertEqual(result.texts, [BURMESE + "一"])
        self.assertEqual(client.stats["retries"], 2)
        self.assertEqual(client.stats["requests"], 3)

    def test_retries_stop_at_max_attempts(self):
        self.api.queue(500, {"error": "boom"})
        self.api.queue(500, {"error": "boom"})
        client = self.client(max_attempts=2)
        with self.assertRaises(TranslatorError) as caught:
            client.translate("hi", "my")
        self.assertEqual(caught.exception.attempts, 2)
        self.assertEqual(len(self.api.requests), 2)

    def test_redirect_is_not_followed(self):
        self.api.queue(redirect=True)
        with self.assertRaises(TranslatorError) as caught:
            self.client().translate("hi", "my")
        self.assertIn("redirect", str(caught.exception))
        self.assertEqual(len(self.api.requests), 1)

    def test_non_json_response(self):
        self.api.queue(200, b"<html>gateway error</html>")
        with self.assertRaises(TranslatorError) as caught:
            self.client().translate("hi", "my")
        self.assertIn("not JSON", str(caught.exception))

    def test_missing_key_is_refused(self):
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}):
            with self.assertRaises(TranslatorError) as caught:
                RapidApiClient()
        self.assertIn("RAPIDAPI_KEY", str(caught.exception))


class EnvFileTests(ApiTestCase):
    def write_env(self, text, name=".env"):
        path = self.tmp / name
        path.write_text(text, encoding="utf-8")
        return path

    def test_parse_forms(self):
        path = self.write_env(
            "# comment\n"
            "\n"
            "RAPIDAPI_KEY=plain\n"
            "export QUOTED=\"with spaces\"\n"
            "SINGLE='single quoted'\n"
            "TRAILING=value # note\n"
            "not a pair\n"
            "1BAD=x\n"
            "EMPTY=\n"
        )
        from rapidapi_translator import parse_env_file
        values = parse_env_file(path)
        self.assertEqual(values["RAPIDAPI_KEY"], "plain")
        self.assertEqual(values["QUOTED"], "with spaces")
        self.assertEqual(values["SINGLE"], "single quoted")
        self.assertEqual(values["TRAILING"], "value")
        self.assertEqual(values["EMPTY"], "")
        self.assertNotIn("1BAD", values)
        self.assertNotIn("not a pair", values)

    def test_load_does_not_override_the_shell(self):
        path = self.write_env("RAPIDAPI_KEY=from-file\nOTHER=file\n")
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": "from-shell"}, clear=False):
            os.environ.pop("OTHER", None)
            loaded = load_env_file(path)
            self.assertEqual(os.environ["RAPIDAPI_KEY"], "from-shell")
            self.assertEqual(os.environ["OTHER"], "file")
        self.assertEqual(loaded, ["OTHER"])

    def test_empty_variable_counts_as_unset(self):
        path = self.write_env("RAPIDAPI_KEY=from-file\n")
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            self.assertEqual(load_env_file(path), ["RAPIDAPI_KEY"])
            self.assertEqual(os.environ["RAPIDAPI_KEY"], "from-file")

    def test_override_is_opt_in(self):
        path = self.write_env("RAPIDAPI_KEY=from-file\n")
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": "from-shell"}, clear=False):
            load_env_file(path, override=True)
            self.assertEqual(os.environ["RAPIDAPI_KEY"], "from-file")

    def test_no_path_does_nothing(self):
        with mock.patch.dict(os.environ, {"RAPIDAPI_ENV_FILE": ""}, clear=False):
            self.assertEqual(load_env_file(), [])

    def test_missing_file_raises(self):
        with self.assertRaises(TranslatorError) as caught:
            load_env_file(self.tmp / "nope.env")
        self.assertIn("no env file", str(caught.exception))

    def test_cli_reads_env_file(self):
        path = self.write_env("RAPIDAPI_KEY=from-file\n")
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            code = __import__("rapidapi_translator").main(
                ["--translate", "你好", "--target", "my", "--env-file", str(path),
                 "--cache", str(self.cache), "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(self.api.last()["key"], "from-file")

    def test_chapter_cli_reads_env_file(self):
        path = self.write_env("RAPIDAPI_KEY=from-file\n")
        source = self.tmp / "source.txt"
        source.write_text("===== 第一章 =====\n\n大周，帝都盛京。\n", encoding="utf-8")
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            code = api_translate.main([
                "--chapters", "1", "--source-file", str(source),
                "--out-dir", str(self.tmp / "out"), "--cache", str(self.cache),
                "--env-file", str(path), "--no-compare", "--run", "--json"])
        self.assertEqual(code, 0)
        self.assertEqual(self.api.last()["key"], "from-file")

    def test_bad_env_file_path_exits_2(self):
        with mock.patch.dict(os.environ, {"RAPIDAPI_KEY": ""}, clear=False):
            code = __import__("rapidapi_translator").main(
                ["--translate", "x", "--env-file", str(self.tmp / "nope.env")])
        self.assertEqual(code, 2)
        self.assertEqual(self.api.requests, [])


class CacheTests(ApiTestCase):
    def test_second_run_uses_cache(self):
        translator = self.cached()
        first = translator.translate_batch(["一", "二"], "my")
        self.assertEqual(first.requests, 1)
        self.assertEqual(first.cached, 0)
        before = len(self.api.requests)
        second = translator.translate_batch(["一", "二"], "my")
        self.assertEqual(len(self.api.requests), before)
        self.assertEqual(second.requests, 0)
        self.assertEqual(second.cached, 2)
        self.assertEqual(second.cache_hits, [True, True])
        self.assertEqual(second.texts, first.texts)
        translator.close()

    def test_only_missing_strings_are_sent(self):
        translator = self.cached()
        translator.translate_batch(["一", "二"], "my")
        translator.translate_batch(["二", "三"], "my")
        self.assertEqual(json.loads(self.api.last()["body"]), ["三"])
        translator.close()

    def test_cache_key_includes_language_pair(self):
        translator = self.cached()
        translator.translate_batch(["一"], "my")
        translator.translate_batch(["一"], "en")
        self.assertEqual(len(self.api.requests), 2)
        translator.close()

    def test_disabled_cache_always_requests(self):
        translator = self.cached(enabled=False)
        translator.translate_batch(["一"], "my")
        translator.translate_batch(["一"], "my")
        self.assertEqual(len(self.api.requests), 2)
        translator.close()


class HelperTests(unittest.TestCase):
    def test_split_text_roundtrip(self):
        text = "第一句話。第二句話！第三句話？第四句話…第五句話；第六句話。"
        for limit in (5, 12, 20):
            pieces = split_text(text, limit)
            self.assertEqual("".join(pieces), text)
            self.assertTrue(all(len(piece) <= limit for piece in pieces))

    def test_split_keeps_spaces(self):
        text = "One sentence. Two sentence. Three sentence. Four sentence."
        self.assertEqual("".join(split_text(text, 20)), text)

    def test_chunk_texts_limits(self):
        chunks = list(chunk_texts(["一" * 10, "二" * 10, "三" * 10],
                                  max_chars=25, max_items=10))
        self.assertEqual([len(chunk) for chunk in chunks], [2, 1])
        chunks = list(chunk_texts(["a", "b", "c"], max_chars=100, max_items=2))
        self.assertEqual([len(chunk) for chunk in chunks], [2, 1])

    def test_parse_chapters(self):
        self.assertEqual(parse_chapters("1-2"), [1, 2])
        self.assertEqual(parse_chapters("1,3-4"), [1, 3, 4])
        self.assertEqual(parse_chapters(["1", "1"]), [1])
        with self.assertRaises(ValueError):
            parse_chapters("3-1")


# ---------------------------------------------------------------- chapters


SOURCE = """===== 第一章：測試一 =====

大周，帝都盛京。
“我就這麼穿越了？”
[[KMTCRAWLER MARKER 2]]
===== 第二章：測試二 =====

他叫葉寧。
PS: 求推薦票！
..........................................................................
(活動時間：10月1日到10月7日)
[[KMTCRAWLER MARKER 3]]
"""

EXISTING = """Chapter 1: ပထမအခန်း
မဟာကျိုးဧကရာဇ်တိုင်းပြည်၊ ရှန်းကျင်းနန်းမြို့တော်။
wunzinnosp

Chapter 2: ဒုတိယအခန်း
သူ့နာမည်က ယဲ့နင်။
"""


class ChapterTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.source = self.tmp / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.existing = self.tmp / "existing.txt"
        self.existing.write_text(EXISTING, encoding="utf-8")
        self.out = self.tmp / "out"

    def test_paragraphs_drop_crawler_junk(self):
        chapters = api_translate.chinese_chapters(self.source)
        paragraphs = api_translate.chapter_paragraphs(chapters[0])
        self.assertEqual(paragraphs, ["大周，帝都盛京。", "“我就這麼穿越了？”"])
        notes = api_translate.chapter_paragraphs(chapters[0], keep_notes=True)
        self.assertEqual(notes, paragraphs)
        second = api_translate.chapter_paragraphs(chapters[1])
        self.assertEqual(second, ["他叫葉寧。"])

    def test_plan_makes_no_request(self):
        chapters = api_translate.chinese_chapters(self.source)
        plan = api_translate.build_plan(chapters, target="my", source="auto",
                                        max_chars=4500, max_items=40)
        self.assertEqual(plan["totals"]["paragraphs"], 3)
        self.assertEqual(plan["totals"]["requests"], 2)
        self.assertEqual(self.api.requests, [])

    def test_run_writes_files(self):
        chapters = api_translate.chinese_chapters(self.source)
        report = api_translate.run(chapters, out_dir=self.out, cache_path=self.cache,
                                   existing_path=self.existing)
        self.assertEqual(report["totals"]["chapters"], 2)
        self.assertEqual(report["totals"]["paragraphs"], 3)
        self.assertEqual(report["totals"]["requests"], 2)
        for name in ("ch0001.my.jsonl", "ch0001.my.txt", "ch0002.my.txt",
                     "book.my.txt", "compare-ch001-ch002.md", "report.json"):
            self.assertTrue((self.out / name).is_file(), name)
        records = [json.loads(line) for line in
                   (self.out / "ch0001.my.jsonl").read_text(encoding="utf-8").splitlines()]
        self.assertEqual([row["source"] for row in records],
                         ["大周，帝都盛京。", "“我就這麼穿越了？”"])
        self.assertEqual([row["target"] for row in records],
                         [BURMESE + "大周，帝都盛京。", BURMESE + "“我就這麼穿越了？”"])
        comparison = (self.out / "compare-ch001-ch002.md").read_text(encoding="utf-8")
        self.assertIn("မဟာကျိုး", comparison)
        self.assertIn("Existing human Burmese — chapter 1", comparison)

    def test_second_run_hits_cache(self):
        chapters = api_translate.chinese_chapters(self.source)
        api_translate.run(chapters, out_dir=self.out, cache_path=self.cache,
                         existing_path=self.existing)
        before = len(self.api.requests)
        report = api_translate.run(chapters, out_dir=self.out, cache_path=self.cache,
                                   existing_path=self.existing)
        self.assertEqual(len(self.api.requests), before)
        self.assertEqual(report["totals"]["requests"], 0)
        self.assertEqual(report["totals"]["cached"], 3)

    def test_cli_plan_then_run(self):
        plan = api_translate.main([
            "--chapters", "1-2", "--source-file", str(self.source),
            "--out-dir", str(self.out), "--existing", str(self.existing),
            "--cache", str(self.cache), "--json",
        ])
        self.assertEqual(plan, 0)
        self.assertEqual(self.api.requests, [])
        code = api_translate.main([
            "--chapters", "1-2", "--source-file", str(self.source),
            "--out-dir", str(self.out), "--existing", str(self.existing),
            "--cache", str(self.cache), "--run", "--json",
        ])
        self.assertEqual(code, 0)
        self.assertTrue((self.out / "report.json").is_file())
        self.assertEqual(len(self.api.requests), 2)

    def test_target_check_reports_burmese_output(self):
        chapters = api_translate.chinese_chapters(self.source)
        report = api_translate.run(chapters, out_dir=self.out, cache_path=self.cache,
                                   existing_path=self.existing)
        check = report["target_check"]
        self.assertEqual(check["total"], 3)
        self.assertEqual(check["with_myanmar_script"], 3)
        self.assertEqual(check["unchanged"], 0)
        self.assertEqual(check["warnings"], [])

    def test_target_check_warns_when_nothing_is_translated(self):
        pairs = [("大周，帝都盛京。", "大周，帝都盛京。"),
                 ("他叫葉寧。", "他叫葉寧。")]
        check = api_translate.script_check(pairs, "my")
        self.assertEqual(check["unchanged"], 2)
        self.assertEqual(check["with_myanmar_script"], 0)
        self.assertTrue(any("Myanmar script" in w for w in check["warnings"]))
        self.assertTrue(any("identical" in w for w in check["warnings"]))

    def test_target_check_ignores_script_for_other_targets(self):
        check = api_translate.script_check([("大周", "The Great Zhou")], "en")
        self.assertNotIn("with_myanmar_script", check)
        self.assertEqual(check["warnings"], [])

    def test_cli_rejects_unknown_chapter(self):
        code = api_translate.main([
            "--chapters", "9", "--source-file", str(self.source),
            "--out-dir", str(self.out),
        ])
        self.assertEqual(code, 2)


# ---------------------------------------------------------------- MCP


SERVER = ROOT / "mcp.py"


class McpProcess:
    def __init__(self, env, args=()):
        self.proc = subprocess.Popen(
            [sys.executable, str(SERVER), "--serve", *args],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, cwd=str(ROOT), env=env)
        self.next_id = 0

    def request(self, method, params=None, timeout=20):
        self.next_id += 1
        payload = {"jsonrpc": "2.0", "id": self.next_id, "method": method}
        if params is not None:
            payload["params"] = params
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()
        return json.loads(self._readline(timeout))

    def notify(self, method, params=None):
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        self.proc.stdin.write(json.dumps(payload) + "\n")
        self.proc.stdin.flush()

    def _readline(self, timeout):
        box = {}

        def read():
            box["line"] = self.proc.stdout.readline()

        thread = threading.Thread(target=read, daemon=True)
        thread.start()
        thread.join(timeout)
        if thread.is_alive():
            self.proc.kill()
            raise AssertionError("MCP server did not answer in time")
        line = box.get("line", "")
        if not line:
            self.proc.kill()
            raise AssertionError("MCP server closed stdout: "
                                 + self.proc.stderr.read())
        return line

    def close(self):
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:  # pragma: no cover
            self.proc.kill()
        for stream in (self.proc.stdout, self.proc.stderr):
            if stream is not None:
                stream.close()


class McpTests(ApiTestCase):
    def env(self):
        environment = dict(os.environ)
        environment.update({
            "RAPIDAPI_KEY": KEY,
            "RAPIDAPI_BASE_URL": self.api.url,
            "RAPIDAPI_HOST": HOST,
            "RAPIDAPI_CACHE": str(self.cache),
        })
        return environment

    def start(self, env=None, args=()):
        process = McpProcess(env or self.env(), args)
        self.addCleanup(process.close)
        return process

    def test_handshake_and_tool_call(self):
        process = self.start()
        init = process.request("initialize", {
            "protocolVersion": "2025-06-18", "capabilities": {},
            "clientInfo": {"name": "test", "version": "0"},
        })
        self.assertEqual(init["result"]["protocolVersion"], "2025-06-18")
        self.assertEqual(init["result"]["serverInfo"]["name"], "rapidapi-translator")
        process.notify("notifications/initialized")
        listed = process.request("tools/list")
        names = {tool["name"] for tool in listed["result"]["tools"]}
        self.assertEqual(names, {"detect_language", "translate_text",
                                 "translate_batch", "translate_chapters",
                                 "read_chapter", "compare_english_chapter",
                                 "previous_burmese_context",
                                 "save_draft", "export_drafts",
                                 "lookup_word", "segment_text", "review_lookup",
                                 "review_brief", "lookup_name", "check_names",
                                 "register_name", "save_verse", "export_verse"})
        called = process.request("tools/call", {
            "name": "translate_text",
            "arguments": {"text": "你好", "target": "my"},
        })
        self.assertFalse(called["result"]["isError"])
        payload = json.loads(called["result"]["content"][0]["text"])
        self.assertEqual(payload["translated_text"], BURMESE + "你好")

    def test_batch_and_detect_tools(self):
        process = self.start()
        process.request("initialize", {"protocolVersion": "2025-06-18"})
        batch = process.request("tools/call", {
            "name": "translate_batch",
            "arguments": {"texts": ["一", "二"], "target": "my"},
        })
        payload = json.loads(batch["result"]["content"][0]["text"])
        self.assertEqual(payload["translations"], [BURMESE + "一", BURMESE + "二"])
        detect = process.request("tools/call", {
            "name": "detect_language", "arguments": {"text": "大周"},
        })
        payload = json.loads(detect["result"]["content"][0]["text"])
        self.assertEqual(payload["language"], "zh-Hant")

    def test_unknown_tool_and_method(self):
        process = self.start()
        process.request("initialize", {"protocolVersion": "2025-06-18"})
        unknown = process.request("tools/call", {"name": "nope", "arguments": {}})
        self.assertEqual(unknown["error"]["code"], -32602)
        method = process.request("resources/subscribe", {"uri": "x"})
        self.assertEqual(method["error"]["code"], -32601)

    def test_missing_key_is_a_tool_error(self):
        environment = self.env()
        environment["RAPIDAPI_KEY"] = ""
        process = self.start(environment)
        process.request("initialize", {"protocolVersion": "2025-06-18"})
        called = process.request("tools/call", {
            "name": "translate_text", "arguments": {"text": "你好"},
        })
        self.assertTrue(called["result"]["isError"])
        self.assertIn("RAPIDAPI_KEY", called["result"]["content"][0]["text"])

    def test_chapter_tool_writes_files(self):
        source = self.tmp / "source.txt"
        source.write_text(SOURCE, encoding="utf-8")
        existing = self.tmp / "existing.txt"
        existing.write_text(EXISTING, encoding="utf-8")
        out = self.tmp / "mcp-out"
        process = self.start(args=("--source-file", str(source),
                                   "--existing", str(existing)))
        process.request("initialize", {"protocolVersion": "2025-06-18"})
        called = process.request("tools/call", {
            "name": "translate_chapters",
            "arguments": {"chapters": "1-2", "target": "my", "out_dir": str(out)},
        }, timeout=60)
        self.assertFalse(called["result"]["isError"], called["result"])
        payload = json.loads(called["result"]["content"][0]["text"])
        self.assertEqual(payload["totals"]["paragraphs"], 3)
        self.assertEqual(payload["requested"], [1, 2])
        self.assertTrue((out / "report.json").is_file())
        # one pair per call: the pair's own copy, and no whole-book overwrite
        self.assertTrue((out / "report-0001-0002.json").is_file())
        self.assertTrue((out / "pair-0001-0002.my.txt").is_file())
        self.assertFalse((out / "book.my.txt").exists())
        self.assertEqual(payload["next"], [])

    def test_chapter_tool_refuses_more_than_a_pair(self):
        source = self.tmp / "source.txt"
        source.write_text(SOURCE, encoding="utf-8")
        process = self.start(args=("--source-file", str(source)))
        process.request("initialize", {"protocolVersion": "2025-06-18"})
        called = process.request("tools/call", {
            "name": "translate_chapters",
            "arguments": {"chapters": "1,2,3", "out_dir": str(self.tmp / "nope")},
        }, timeout=60)
        self.assertTrue(called["result"]["isError"], called["result"])
        self.assertIn("2 at a time", called["result"]["content"][0]["text"])
        self.assertFalse((self.tmp / "nope").exists())


class ConfigTests(unittest.TestCase):
    def run_server(self, *args, env=None):
        return subprocess.run([sys.executable, str(SERVER), *args],
                              capture_output=True, text=True, timeout=30,
                              env=env)

    def test_client_snippets(self):
        for client in ("json", "claude", "kilo", "codex", "gemini"):
            output = self.run_server("--print-config", "--client", client)
            self.assertEqual(output.returncode, 0, output.stderr)
            self.assertIn("mcp.py", output.stdout)
            if client == "claude":
                self.assertIn("claude mcp add --scope user", output.stdout)
                continue
            body = "\n".join(line for line in output.stdout.splitlines()
                             if not line.lstrip().startswith("#"))
            if client == "codex":
                try:
                    import tomllib
                except ImportError:  # pragma: no cover - python < 3.11
                    self.assertIn('env_vars = ["RAPIDAPI_KEY"]', body)
                    continue
                data = tomllib.loads(body)
                table = data["mcp_servers"]["rapidapi-translator"]
                self.assertEqual(table["env_vars"], ["RAPIDAPI_KEY"])
                self.assertTrue(table["args"][0].endswith("mcp.py"))
                continue
            data = json.loads(body)
            table = (data.get("mcp") or data.get("mcpServers"))["rapidapi-translator"]
            if client == "kilo":
                self.assertTrue(table["command"][0].endswith("python3"))
                self.assertIn("mcp.py", table["command"][1])
                self.assertEqual(table["environment"]["RAPIDAPI_KEY"],
                                 "{env:RAPIDAPI_KEY}")
            else:
                self.assertTrue(table["command"].endswith("python3"))
                self.assertTrue(table["args"][0].endswith("mcp.py"))
        unknown = self.run_server("--print-config", "--client", "nope")
        self.assertNotEqual(unknown.returncode, 0)

    def test_selftest_needs_no_key_or_network(self):
        environment = dict(os.environ, RAPIDAPI_KEY="")
        output = self.run_server("--selftest", env=environment)
        self.assertEqual(output.returncode, 0, output.stderr)
        payload = json.loads(output.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["tools"], ["detect_language", "translate_text",
                                            "translate_batch", "read_chapter",
                                            "compare_english_chapter",
                                            "previous_burmese_context",
                                            "save_draft", "export_drafts",
                                            "lookup_word", "review_lookup",
                                            "review_brief", "lookup_name",
                                            "check_names", "register_name",
                                            "save_verse", "export_verse",
                                            "segment_text", "translate_chapters"])
        self.assertEqual(payload["key"], "missing")

    def test_install_config_creates_file_with_placeholder(self):
        target = self._temp() / "nested" / "kilo.json"
        output = self.run_server("--install-config", "--client", "kilo",
                                 "--config", str(target))
        self.assertEqual(output.returncode, 0, output.stderr)
        self.assertEqual(json.loads(output.stdout)["status"], "created")
        entry = json.loads(target.read_text(encoding="utf-8"))["mcp"]["rapidapi-translator"]
        self.assertEqual(entry["type"], "local")
        self.assertEqual(entry["command"][0].rsplit("/", 1)[-1],
                         Path(sys.executable).name)
        self.assertTrue(entry["command"][1].endswith("mcp.py"))
        self.assertIn("--serve", entry["command"])
        self.assertEqual(entry["environment"], {"RAPIDAPI_KEY": "{env:RAPIDAPI_KEY}"})
        if os.name == "posix":
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)

    def test_install_config_merges_without_losing_keys(self):
        target = self._temp() / "kilo.json"
        target.write_text(json.dumps({"model": "x/y", "mcp": {"other": {"type": "local"}}}),
                          encoding="utf-8")
        output = self.run_server("--install-config", "--client", "kilo",
                                 "--config", str(target))
        self.assertEqual(json.loads(output.stdout)["status"], "merged")
        data = json.loads(target.read_text(encoding="utf-8"))
        self.assertEqual(data["model"], "x/y")
        self.assertIn("other", data["mcp"])
        self.assertIn("rapidapi-translator", data["mcp"])

    def test_install_config_is_idempotent(self):
        target = self._temp() / "kilo.json"
        self.run_server("--install-config", "--client", "kilo", "--config", str(target))
        before = target.read_text(encoding="utf-8")
        output = self.run_server("--install-config", "--client", "kilo",
                                 "--config", str(target))
        self.assertEqual(json.loads(output.stdout)["status"], "already")
        self.assertEqual(target.read_text(encoding="utf-8"), before)

    def test_install_config_refuses_jsonc(self):
        target = self._temp() / "kilo.jsonc"
        original = '{\n  // comment\n  "mcp": {}\n}\n'
        target.write_text(original, encoding="utf-8")
        output = self.run_server("--install-config", "--client", "kilo",
                                 "--config", str(target))
        self.assertEqual(output.returncode, 1)
        result = json.loads(output.stdout)
        self.assertEqual(result["status"], "manual")
        self.assertIn("rapidapi-translator", result["snippet"])
        self.assertEqual(target.read_text(encoding="utf-8"), original)

    def test_install_config_with_env_file_adds_args_and_drops_placeholder(self):
        env_file = self._temp() / ".env"
        env_file.write_text("RAPIDAPI_KEY=x\n", encoding="utf-8")
        target = self._temp() / "kilo.json"
        output = self.run_server("--install-config", "--client", "kilo",
                                 "--config", str(target), "--env-file", str(env_file))
        self.assertEqual(output.returncode, 0, output.stderr)
        entry = json.loads(target.read_text(encoding="utf-8"))["mcp"]["rapidapi-translator"]
        self.assertEqual(entry["command"][-2:], ["--env-file", str(env_file)])
        self.assertNotIn("environment", entry)

    def test_install_config_refuses_a_missing_env_file(self):
        target = self._temp() / "kilo.json"
        output = self.run_server("--install-config", "--client", "kilo",
                                 "--config", str(target),
                                 "--env-file", str(self._temp() / "nope.env"))
        self.assertEqual(output.returncode, 2)
        self.assertIn("no env file", output.stderr)
        self.assertFalse(target.exists())

    def test_print_config_refuses_a_missing_env_file(self):
        output = self.run_server("--print-config", "--client", "kilo",
                                 "--env-file", str(self._temp() / "nope.env"))
        self.assertEqual(output.returncode, 2)
        self.assertIn("no env file", output.stderr)

    def test_install_config_for_gemini_uses_env_expansion(self):
        target = self._temp() / "settings.json"
        self.run_server("--install-config", "--client", "gemini", "--config", str(target))
        entry = json.loads(target.read_text(encoding="utf-8"))["mcpServers"]["rapidapi-translator"]
        self.assertEqual(entry["env"], {"RAPIDAPI_KEY": "${RAPIDAPI_KEY}"})

    def test_install_config_for_codex_is_manual(self):
        output = self.run_server("--install-config", "--client", "codex")
        self.assertEqual(output.returncode, 1)
        result = json.loads(output.stdout)
        self.assertEqual(result["status"], "manual")
        self.assertIn("mcp_servers.rapidapi-translator", result["snippet"])

    def _temp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        return Path(directory.name)

    def test_print_config_is_valid_json(self):
        output = subprocess.run([sys.executable, str(SERVER), "--print-config"],
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(output.returncode, 0, output.stderr)
        payload = json.loads(output.stdout)
        server = payload["mcpServers"]["rapidapi-translator"]
        self.assertTrue(server["args"][0].endswith("mcp.py"))
        self.assertIn("RAPIDAPI_KEY", server["env"])

    def test_check_hides_key(self):
        environment = dict(os.environ, RAPIDAPI_KEY=KEY)
        output = subprocess.run([sys.executable, str(SERVER), "--check"],
                                capture_output=True, text=True, timeout=20,
                                env=environment)
        self.assertEqual(output.returncode, 0, output.stderr)
        self.assertNotIn(KEY, output.stdout)
        self.assertEqual(json.loads(output.stdout)["key"], "set")


if __name__ == "__main__":
    unittest.main()
