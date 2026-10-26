#!/usr/bin/env python3
"""Offline tests for the model installer.

The archive format is the thing under test: an `.argosmodel` is a zip with
`metadata.json`, `model/model.bin` and `sentencepiece.model`, sometimes wrapped
in one top-level folder. These tests build that archive, so no 86 MB download
and no network are involved.

    python3 -m unittest discover -s mt/tests -v
"""
from __future__ import annotations

import contextlib
import io
import json
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
sys.path.insert(0, str(MT))

import fetch_engine  # noqa: E402
import translate  # noqa: E402


def make_archive(path: Path, *, wrapper: str = "", unsafe: str = "") -> Path:
    """A minimal but structurally exact `.argosmodel`."""
    with zipfile.ZipFile(path, "w") as bundle:
        bundle.writestr(wrapper + "metadata.json",
                        json.dumps({"package_version": "1.0", "from_code": "zh",
                                    "to_code": "en"}))
        bundle.writestr(wrapper + "model/model.bin", b"\x00" * 64)
        bundle.writestr(wrapper + "model/config.json", "{}")
        bundle.writestr(wrapper + "sentencepiece.model", b"\x00" * 32)
        bundle.writestr(wrapper + "stanza/", b"")
        if unsafe:
            bundle.writestr(wrapper + unsafe, b"nope")
    return path


class LayoutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="fetch-engine-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.root = self.tmp / "packages"
        self.root.mkdir()

    def test_plain_archive_lands_where_translate_expects(self):
        archive = make_archive(self.tmp / "a.argosmodel", wrapper="")
        target = fetch_engine.unpack(archive, "zh-en", self.root)
        self.assertEqual(target, self.root / "translate-zh_en-1_0")
        self.assertTrue((target / "model" / "model.bin").is_file())
        self.assertTrue((target / "sentencepiece.model").is_file())
        self.assertTrue((target / "metadata.json").is_file())
        self.assertEqual(fetch_engine.installed("zh-en", self.root), target)

    def test_wrapped_archive_lands_in_the_same_place(self):
        archive = make_archive(self.tmp / "b.argosmodel",
                               wrapper="translate-zh_en-1_0/")
        target = fetch_engine.unpack(archive, "zh-en", self.root)
        self.assertEqual(target.name, "translate-zh_en-1_0")
        self.assertTrue((target / "model" / "model.bin").is_file())
        # the wrapper is stripped, not nested
        self.assertFalse((target / "translate-zh_en-1_0").exists())

    def test_unsafe_member_is_refused_and_nothing_is_installed(self):
        archive = make_archive(self.tmp / "c.argosmodel", unsafe="../escape.txt")
        with self.assertRaises(SystemExit):
            fetch_engine.unpack(archive, "zh-en", self.root)
        self.assertIsNone(fetch_engine.installed("zh-en", self.root))
        self.assertFalse((self.tmp / "escape.txt").exists())

    def test_rewriting_an_existing_package_replaces_it(self):
        first = make_archive(self.tmp / "d1.argosmodel")
        target = fetch_engine.unpack(first, "zh-en", self.root)
        (target / "stale.file").write_text("old", encoding="utf-8")
        second = make_archive(self.tmp / "d2.argosmodel")
        same = fetch_engine.unpack(second, "zh-en", self.root)
        self.assertEqual(same, target)
        self.assertFalse((target / "stale.file").exists())

    def test_not_an_argosmodel_is_named(self):
        path = self.tmp / "junk.zip"
        with zipfile.ZipFile(path, "w") as bundle:
            bundle.writestr("hello.txt", "x")
        with self.assertRaises(SystemExit) as caught:
            fetch_engine.unpack(path, "zh-en", self.root)
        self.assertIn("model/model.bin", str(caught.exception))

    def test_unknown_route_is_refused_before_cloning(self):
        with self.assertRaises(SystemExit) as caught:
            fetch_engine.fetch("my-en", self.root)
        self.assertIn("zh-en", str(caught.exception))


class RouteTests(unittest.TestCase):
    """The installer and the runner must advertise the same routes."""

    def test_installer_routes_match_translate_routes(self):
        self.assertEqual(set(fetch_engine.FILES), set(translate.ROUTES))

    def test_report_only_knows_the_two_real_routes(self):
        with tempfile.TemporaryDirectory() as tmp:
            payload = fetch_engine.report(tmp)
        self.assertEqual(sorted(payload["routes"]), ["en-zh", "zh-en"])
        self.assertEqual({row["state"] for row in payload["routes"].values()},
                         {"downloadable"})
        for stale in ("zt-en", "en-zt", "en-my", "my-en", "zh-my"):
            self.assertNotIn(stale, payload["routes"])


class CliTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="fetch-engine-cli-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.root = self.tmp / "packages"
        self.root.mkdir()

    def run_cli(self, *args):
        stdout = io.StringIO()
        with contextlib.redirect_stdout(stdout):
            code = fetch_engine.main([*args, "--package-dir", str(self.root)])
        return code, stdout.getvalue()

    def test_check_installs_nothing_and_writes_no_file(self):
        code, out = self.run_cli("--check")
        self.assertEqual(code, 0)
        self.assertIn("zh-en", out)
        self.assertIn("downloadable", out)
        self.assertEqual(list(self.root.iterdir()), [])
        self.assertFalse((MT / "engines.json").exists(),
                         "the installer must not write a file into the repo")

    def test_json_report_is_one_object(self):
        code, out = self.run_cli("--check", "--json")
        self.assertEqual(code, 0)
        payload = json.loads(out)
        self.assertEqual(payload["package_dir"], str(self.root))
        self.assertEqual(sorted(payload["routes"]), ["en-zh", "zh-en"])

    def test_check_shows_an_installed_model_and_its_size(self):
        make_archive(self.tmp / "a.argosmodel")
        fetch_engine.unpack(self.tmp / "a.argosmodel", "zh-en", self.root)
        code, out = self.run_cli("--check")
        self.assertEqual(code, 0)
        self.assertIn("installed", out)
        self.assertIn("translate-zh_en-1_0", out)

    def test_remove_deletes_only_that_route(self):
        make_archive(self.tmp / "a.argosmodel")
        fetch_engine.unpack(self.tmp / "a.argosmodel", "zh-en", self.root)
        make_archive(self.tmp / "b.argosmodel")
        fetch_engine.unpack(self.tmp / "b.argosmodel", "en-zh", self.root)
        code, out = self.run_cli("--remove", "zh-en", "--check")
        self.assertEqual(code, 0)
        self.assertIn("removed", out)
        self.assertIsNone(fetch_engine.installed("zh-en", self.root))
        self.assertIsNotNone(fetch_engine.installed("en-zh", self.root))


if __name__ == "__main__":
    unittest.main()
