"""The active JS-compatible POS stage is the extension point for future rules."""
import unittest
from copy import deepcopy

from myangustis_engine.bridge.Ginit import run_rule_engine
from myangustis_engine.Lexical_No_inspect.abstract.posoverride import (
    run_rule_engine as run_pos_override,
)


class PosStageTests(unittest.TestCase):
    def test_dual_tag_override_and_passthrough(self):
        lines = [
            {'isEos': True, 'tokens': [
                {'syllables': ['က'], 'ids': ['A001'], 'rawPos': ['n', 'v']},
                {'syllables': ['ခ'], 'ids': ['B001'], 'rawPos': ['v', 'n']},
                {'syllables': ['ဂ', 'ဃ'], 'ids': ['C001', 'D001'], 'rawPos': ['v', 'n', 'p']},
                {'syllables': ['။'], 'ids': ['။'], 'rawPos': ['eos']},
            ]},
            {'tokens': [{'syllables': ['င'], 'ids': ['E001'], 'rawPos': ['n']}]},
        ]
        before = deepcopy(lines)
        result = list(run_rule_engine(iter(lines)))
        tokens = result[0]['tokens']
        self.assertEqual([t['rawPos'] for t in tokens], [['rbvn'], ['rbvn'], ['v', 'n', 'p'], ['eos']])
        self.assertEqual([t['finalPos'] for t in tokens], ['rbvn', 'rbvn', 'v', 'eos'])
        self.assertEqual(tokens[2]['joinedIds'], 'C001D001')
        self.assertTrue(tokens[0]['isAmbiguous'])  # based on original candidates
        self.assertFalse(tokens[2]['isSingleSyllable'])
        self.assertTrue(all(t['matches'] == [] for t in tokens))
        self.assertEqual([t['position'] for t in tokens], [0, 1, 2, 3])
        self.assertEqual([(line['lineIndex'], line['isEos']) for line in result], [(0, True), (1, False)])
        self.assertEqual(lines, before)

    def test_standalone_override_is_js_passthrough(self):
        lines = [{'isEos': None, 'tokens': [
            {'syllables': ['က'], 'ids': ['A001'], 'rawPos': ['n', 'v']},
            {'syllables': ['ခ'], 'ids': ['B001'], 'rawPos': ['v']},
        ]}]
        before = deepcopy(lines)
        line = list(run_pos_override(lines, hash='ignored'))[0]
        first, second = line['tokens']
        self.assertEqual(first['rawPos'], ['n', 'v'])
        self.assertEqual(first['finalPos'], 'n')
        self.assertTrue(first['isAmbiguous'])
        self.assertEqual(first['matches'], [])
        self.assertEqual(second['finalPos'], 'v')
        self.assertFalse(line['isEos'])
        self.assertEqual(lines, before)

    def test_empty_candidates(self):
        tokens = [{'syllables': ['က'], 'ids': ['A001'], 'rawPos': []}]
        result = list(run_rule_engine([{'tokens': tokens}]))[0]['tokens'][0]
        self.assertIsNone(result['finalPos'])
        self.assertEqual(result['rawPos'], [])


if __name__ == '__main__':
    unittest.main()
