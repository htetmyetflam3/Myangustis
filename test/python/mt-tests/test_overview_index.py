"""The background-document index: sections the agent can pull one at a time."""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3] / "Proofreading" / "main"
sys.path.insert(0, str(ROOT / "mt"))

import overview_index as oi  # noqa: E402

SOURCE = ROOT / "content" / "review" / "burmese-overview.md"
INDEX = ROOT / "content" / "review" / "overview.yaml"


class OverviewIndexTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not INDEX.is_file():
            oi.build(SOURCE, INDEX)
        cls.index = oi.load(INDEX)
        cls.sections = cls.index["sections"]
        cls.lines = SOURCE.read_text(encoding="utf-8").splitlines()

    def section(self, section_id):
        return next(s for s in self.sections if s["id"] == section_id)

    def test_every_heading_is_indexed(self):
        headings = [i + 1 for i, line in enumerate(self.lines)
                    if oi.HEADING.match(line)]
        self.assertEqual([s["lines"][0] for s in self.sections], headings)

    def test_character_sections_are_classified(self):
        self.assertEqual(self.section("character-ကျီမင်းယွဲ့")["kind"], "character")

    def test_character_table_rows_point_at_their_section(self):
        rows = {row["name"]: row for row in self.index["characters"]}
        self.assertEqual(len(rows), 15)
        self.assertEqual(rows["ကျီမင်းယွဲ့"]["section"], "character-ကျီမင်းယွဲ့")

    def test_issue_sections_keep_the_chinese_term(self):
        issue = self.section("issue-聖院-အခန်း-၁၁-နဲ့-၁၇")
        self.assertEqual(issue["kind"], "issue")

    def test_arc_chapters_are_parsed_from_burmese_digits(self):
        arc = next(s for s in self.sections if s["id"].startswith("arc-ဒုတိယ"))
        self.assertEqual(arc["chapters"], [11, 20])

    def test_chapter_17_falls_in_the_second_arc(self):
        arc = next(s for s in self.sections if s["kind"] == "arc"
                   and s["chapters"][0] <= 17 <= s["chapters"][1])
        self.assertEqual(arc["id"].split("-")[0], "arc")
        self.assertTrue(arc["title"].startswith("ဒုတိယပိုင်း"))

    def test_container_shows_only_its_preamble(self):
        title = self.sections[0]
        self.assertEqual(title["lines"][1], len(self.lines))
        self.assertLess(oi.own_end(title, self.sections), 20)

    def test_ranges_match_the_source(self):
        for section in self.sections:
            start = section["lines"][0]
            self.assertIn(section["title"], self.lines[start - 1])

    def test_slug_keeps_burmese_marks(self):
        self.assertEqual(oi.slugify("ယဲ့နင်", 3), "ယဲ့နင်")
        self.assertEqual(oi.slugify("၂။ 聖院 — အခန်း ၁၁", 3), "聖院-အခန်း-၁၁")


if __name__ == "__main__":
    unittest.main()
