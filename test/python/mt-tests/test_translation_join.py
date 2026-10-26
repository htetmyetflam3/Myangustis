"""read_chapter joins the API's Burmese to paragraphs, and checks the alignment."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "mt"))

import agent_work  # noqa: E402


class TranslationJoinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.paragraphs = agent_work.chapter_paragraphs_by_number(1)

    def write(self, records):
        directory = tempfile.mkdtemp()
        path = Path(directory) / "ch0001.my.jsonl"
        with path.open("w", encoding="utf-8") as handle:
            for record in records:
                handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        return Path(directory)

    def fresh(self):
        return [agent_work.Paragraph(p.chapter, p.index, p.text)
                for p in self.paragraphs]

    def test_matching_source_is_attached(self):
        paras = self.fresh()
        directory = self.write([{"chapter": 1, "index": paras[0].index,
                                 "source": paras[0].text, "target": "ဘာသာပြန်"}])
        report = agent_work.load_translation(1, paras, directory)
        self.assertTrue(report["available"])
        self.assertEqual(report["attached"], 1)
        self.assertEqual(paras[0].translation, "ဘာသာပြန်")

    def test_mismatched_source_is_refused(self):
        paras = self.fresh()
        directory = self.write([{"chapter": 1, "index": paras[0].index,
                                 "source": "not this paragraph", "target": "WRONG"}])
        report = agent_work.load_translation(1, paras, directory)
        self.assertEqual(report["attached"], 0)
        self.assertEqual(report["mismatched"], 1)
        self.assertEqual(paras[0].translation, "")

    def test_missing_file_is_not_an_error(self):
        paras = self.fresh()
        report = agent_work.load_translation(1, paras, Path(tempfile.mkdtemp()))
        self.assertFalse(report["available"])
        self.assertIn("no API translation", report["detail"])

    def test_read_chapter_exposes_my_only_when_present(self):
        payload = agent_work.read_chapter(1, translations=Path(tempfile.mkdtemp()))
        self.assertFalse(payload["translation"]["available"])
        self.assertNotIn("my", payload["paragraphs"][0])


if __name__ == "__main__":
    unittest.main()


class SelectTests(unittest.TestCase):
    """`select` must hand back the real chapter, not a crawl artifact.

    A page header promoted to a chapter start parses the same number twice; the
    stub is a few hundred characters cut out of the middle of the real chapter.
    Last-wins used to return the stub.
    """

    def test_the_longest_body_wins(self):
        import api_translate
        from translate import Chapter
        stub = Chapter(61, "第六十一章", "短" * 40, "chinese")
        real = Chapter(61, "第六十一章: 我背刺了我自己？", "文" * 900, "chinese")
        chosen = api_translate.select([stub, real], [61])[0]
        self.assertEqual(len(chosen.body), 900)
        self.assertIn("背刺", chosen.title)

    def test_order_of_wanted_numbers_is_kept(self):
        import api_translate
        from translate import Chapter
        rows = [Chapter(n, f"第{n}章", "文" * (10 * n), "chinese") for n in (194, 195)]
        self.assertEqual([c.number for c in api_translate.select(rows, [195, 194])],
                         [195, 194])

    def test_a_missing_number_is_dropped_not_invented(self):
        import api_translate
        from translate import Chapter
        rows = [Chapter(194, "第194章", "文", "chinese")]
        self.assertEqual([c.number for c in api_translate.select(rows, [194, 195])],
                         [194])
