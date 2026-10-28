"""Tests for selecting the best chapter from a crawl."""
import unittest

import _paths  # noqa: F401 - configure the split proofreading modules


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


if __name__ == "__main__":
    unittest.main()
