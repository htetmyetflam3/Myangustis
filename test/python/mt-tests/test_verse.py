"""The verse store: the agent's judgement in, a reviewable section out.

The point of these tests is what the module does *not* do. There is no
`detect_verse()`, no line-length heuristic, no regex for parallel couplets. A
tool that guessed would either bury real poems among ordinary sentences or miss
them, and the agent re-matching tone is already reading every paragraph. So the
store records a decision and renders it; it never makes one.
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
MT = Path(__file__).resolve().parents[3] / "Proofreading" / "main" / "mt"
sys.path.insert(0, str(MT))
sys.path.insert(0, str(HERE))

import verse  # noqa: E402


class FakeParagraph:
    def __init__(self, index, text):
        self.index = index
        self.text = text
        self.id = f"0194-{index:03d}-deadbeef"


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        patcher = mock.patch.object(
            verse, "_paragraph",
            lambda chapter, selector, source=None: (FakeParagraph(int(selector), "風兒也吹倦了，"), 166))
        patcher.start()
        self.addCleanup(patcher.stop)

    def add(self, **kwargs):
        defaults = dict(kind="poem", paragraph="161",
                        english="Even the wind has grown weary of blowing.")
        defaults.update(kwargs)
        return verse.save(194, directory=self.dir, **defaults)

    def test_a_line_is_stored_with_its_chinese(self):
        record = self.add(note="closing couplet")
        self.assertEqual(record["kind"], "poem")
        self.assertEqual(record["zh"], "風兒也吹倦了，")
        self.assertEqual(record["english"], "Even the wind has grown weary of blowing.")
        self.assertEqual(record["paragraphs"], 166)
        rows = verse.load(194, self.dir)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["note"], "closing couplet")

    def test_the_english_source_is_recorded(self):
        self.assertEqual(self.add(english_source="mt")["english_source"], "mt")
        with self.assertRaises(verse.VerseError):
            self.add(paragraph="162", english_source="google")

    def test_resaving_one_paragraph_replaces_it(self):
        self.add()
        self.add(english="The wind itself is tired of blowing.")
        rows = verse.load(194, self.dir)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["english"], "The wind itself is tired of blowing.")

    def test_lines_come_back_in_paragraph_order(self):
        self.add(paragraph="166", kind="philosophy")
        self.add(paragraph="159", kind="maxim")
        self.assertEqual([row["index"] for row in verse.load(194, self.dir)], [159, 166])

    def test_none_records_that_the_chapter_was_checked(self):
        verse.save(194, kind="none", directory=self.dir, note="read twice")
        rows = verse.load(194, self.dir)
        self.assertEqual([row["kind"] for row in rows], ["none"])
        text = verse.render(194, directory=self.dir)
        self.assertIn("Checked, no verse found", text)
        self.assertIn("read twice", text)

    def test_none_contradicts_saved_lines(self):
        self.add()
        with self.assertRaises(verse.VerseError):
            verse.save(194, kind="none", directory=self.dir)

    def test_a_line_clears_an_earlier_none(self):
        verse.save(194, kind="none", directory=self.dir)
        self.add()
        self.assertEqual([row["kind"] for row in verse.load(194, self.dir)], ["poem"])

    def test_a_verse_line_needs_english_and_a_paragraph(self):
        with self.assertRaises(verse.VerseError):
            verse.save(194, kind="poem", english="", directory=self.dir)
        with self.assertRaises(verse.VerseError):
            verse.save(194, kind="poem", english="something", directory=self.dir)
        with self.assertRaises(verse.VerseError):
            self.add(kind="haiku")

    def test_render_is_a_review_section_not_prose(self):
        self.add(kind="philosophy", paragraph="159", english="I never belonged here.",
                 mt_english="I did not belong to this world at all.",
                 note="free indirect")
        text = verse.render(194, directory=self.dir)
        self.assertTrue(text.startswith("# Chapter 194"))
        self.assertIn("**Chinese.** 風兒也吹倦了，", text)
        self.assertIn("**zh-en.**", text)
        self.assertIn("**English (agent).**", text)
        self.assertIn("**Why.** free indirect", text)
        self.assertIn("not part of the draft", text)

    def test_render_says_so_when_nothing_was_judged(self):
        text = verse.render(194, directory=self.dir)
        self.assertIn("Nothing recorded for this chapter", text)
        self.assertIn("save_verse", text)

    def test_export_writes_the_markdown(self):
        self.add()
        report = verse.export(194, directory=self.dir)
        self.assertTrue(report["file"].endswith("ch0194.verse.md"))
        self.assertEqual(report["lines"], 1)
        self.assertEqual(report["kinds"], {"poem": 1})
        self.assertFalse(report["checked"])
        self.assertTrue(Path(report["file"]).is_file())
        self.assertFalse(verse.export(195, directory=self.dir)["lines"])

    def test_the_store_is_jsonl(self):
        self.add()
        path = self.dir / "ch0194.verse.jsonl"
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["paragraph_id"], "0194-161-deadbeef")

    def test_mt_lines_reads_consolidated_zh_en_file(self):
        with tempfile.TemporaryDirectory() as temp:
            onefile = Path(temp) / "zh-en.txt"
            onefile.write_text(
                "===== Chapter 194 — title =====\n\nThe wind is tired.\nA second line.\n\n"
                "===== Chapter 195 — title =====\n\nAnother chapter.\n\n",
                encoding="utf-8")
            self.assertEqual(verse.mt_lines(194, onefile),
                             ["The wind is tired.", "A second line."])
            self.assertEqual(verse.mt_lines(196, onefile), [])

    def test_mt_lines_reads_the_zh_en_chapter(self):
        chapters = self.dir / "zh-en"
        chapters.mkdir()
        (chapters / "ch0194.en.txt").write_text(
            "Chapter 194: Test\n=================\nThe wind is tired.\n", encoding="utf-8")
        self.assertEqual(verse.mt_lines(194, chapters), ["The wind is tired."])
        self.assertEqual(verse.mt_lines(195, chapters), [])


class ChapterExportTests(unittest.TestCase):
    """The verse section lands at the end of the chapter file, not in a drawer."""

    def setUp(self):
        import agent_work
        from test_agent_work import SOURCE
        from test_chapter_map import write_docx  # noqa: F401  (import keeps parity)
        self.agent_work = agent_work
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = Path(self.tmp.name)
        self.source = self.dir / "source.txt"
        self.source.write_text(SOURCE, encoding="utf-8")
        self.dir_verse = self.dir / "verse"
        patcher = mock.patch.object(verse, "DEFAULT_DIR", self.dir_verse)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.store = agent_work.DraftStore(self.dir / "drafts.sqlite3")
        self.addCleanup(self.store.close)

    def test_export_appends_the_section_when_verse_exists(self):
        report = self.store.export(61, self.dir / "out", source=self.source)
        self.assertIsNone(report["verse"])
        verse.save(61, kind="poem", paragraph="1",
                   english="Leaves fall in the great hall.", directory=self.dir_verse)
        report = self.store.export(61, self.dir / "out", source=self.source)
        self.assertEqual(report["verse"], {"lines": 1, "kinds": ["poem"]})
        text = Path(report["files"][1]).read_text(encoding="utf-8")
        self.assertIn("poems, songs and philosophy lines", text)
        self.assertIn("Leaves fall in the great hall.", text)
        self.assertIn("not part of the draft", text)

    def test_the_draft_text_file_never_gets_verse(self):
        verse.save(61, kind="poem", paragraph="1",
                   english="Leaves fall.", directory=self.dir_verse)
        report = self.store.export(61, self.dir / "out", source=self.source)
        body = Path(report["files"][0]).read_text(encoding="utf-8")
        self.assertNotIn("Leaves fall.", body)


class NoDetectionTests(unittest.TestCase):
    def test_there_is_no_detector(self):
        """If someone adds one, this fails and the argument gets re-read."""
        for name in dir(verse):
            self.assertNotIn("detect", name.lower(), name)
            self.assertNotIn("guess", name.lower(), name)


if __name__ == "__main__":
    unittest.main()
