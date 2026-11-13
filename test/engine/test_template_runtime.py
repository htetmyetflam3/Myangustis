"""First template runtime: covered examples only; no extra grammar rules."""
import unittest
from copy import deepcopy

from myangustis_engine.api import pos_views, template_views
from myangustis_engine.Lexical_No_inspect.abstract.template_runtime import (
    analyse_sentence, _head_only, _tail_only,
)
from myangustis_engine.secure_data.secure import load_template_data


def report(sentence, name):
    return next(item for item in sentence['templates'] if item['id'] == name)


class TemplateRuntimeTests(unittest.TestCase):
    def test_verb_only_question_uses_template_and_keeps_ambiguity(self):
        sentence = template_views('စားမလား။')[0]
        self.assertTrue(sentence['complete'])
        self.assertEqual(report(sentence, 'msp-01')['status'], 'pending_fallback')
        data = load_template_data()
        match = _head_only(sentence['tokens'], data, data['Templates']['msp-01'])
        self.assertEqual(match['status'], 'matched')
        result = match['analyses'][0]
        self.assertEqual(result['head']['slot'], 'pe')
        self.assertEqual(result['head']['relation'], 'sentence')
        self.assertEqual(result['head']['root']['slot'], 'V')
        self.assertEqual(result['head']['root']['evidence']['surface'], 'စား')
        self.assertEqual(result['head']['root']['evidence']['selected'], 'v')
        self.assertEqual([x['surface'] for x in result['verb_unit_modifiers']], ['မ', 'လား'])
        self.assertEqual([x['selected_candidates'] for x in result['verb_unit_modifiers']], [['p'], ['p']])
        self.assertIn('n', result['verb_unit_modifiers'][-1]['rawPos'])
        self.assertEqual(result['tail']['status'], 'reject')
        self.assertEqual(report(sentence, 'msp-02')['status'], 'pending_fallback')
        self.assertTrue(all(report(sentence, f'msp-0{i}')['status'] == 'not_implemented' for i in range(3, 8)))

    def test_noun_tail_and_sentence_boundaries(self):
        reports = template_views('မောင်မောင်။စားမလား။မောင်')
        self.assertEqual([r['complete'] for r in reports], [True, True, False])
        self.assertEqual(report(reports[0], 'msp-02')['status'], 'pending_fallback')
        data = load_template_data()
        first = _tail_only(reports[0]['tokens'], data['Templates']['msp-02'])
        self.assertEqual(first['status'], 'matched')
        tail = first['analyses'][0]['tail']
        self.assertEqual(tail['must'], 'end_with_punctuation')
        self.assertEqual([t['surface'] for t in tail['words']], ['မောင်', 'မောင်'])
        self.assertEqual(report(reports[1], 'msp-01')['status'], 'pending_fallback')
        self.assertEqual(report(reports[2], 'msp-02')['status'], 'unresolved')

    def test_covered_examples_wait_for_two_piece_stage(self):
        # One-sided fallbacks must not be approved while the two-piece parser
        # is unavailable, including on book examples.
        for text in ('မစားချင်ဘူး။', 'စားလိုက်ပါဦး။'):
            with self.subTest(text=text):
                self.assertEqual(report(template_views(text)[0], 'msp-01')['status'], 'pending_fallback')
        self.assertEqual(report(template_views('ချမ်းသာကြပါစေ။')[0], 'msp-01')['status'], 'pending_fallback')

    def test_fallback_is_not_approved_before_two_piece_stage(self):
        data = load_template_data()
        data['Templates']['msp-01']['seq'] = ['n', 'n', 'p']
        tokens = [{'syllables': ['စား'], 'ids': ['x'], 'rawPos': ['v']}]
        self.assertEqual(report(analyse_sentence(tokens, complete=True, data=data), 'msp-01')['status'], 'pending_fallback')

    def test_ambiguous_paths_are_not_mutated_or_fabricated(self):
        tokens = [{'syllables': ['စား'], 'ids': ['x'], 'rawPos': ['n', 'v']},
                  {'syllables': ['လား'], 'ids': ['y'], 'rawPos': ['n', 'p']}]
        before = deepcopy(tokens)
        result = analyse_sentence(tokens, complete=True)
        self.assertEqual(tokens, before)
        self.assertEqual(report(result, 'msp-01')['status'], 'pending_fallback')
        self.assertEqual(report(result, 'msp-02')['status'], 'pending_fallback')
        data = load_template_data()
        # Both fallback probes retain the candidates, but neither is yet selected.
        head = _head_only(tokens, data, data['Templates']['msp-01'])
        tail = _tail_only(tokens, data['Templates']['msp-02'])
        self.assertEqual(head['status'], 'matched')
        self.assertEqual(tail['status'], 'matched')
        root = head['analyses'][0]['head']['root']['evidence']
        self.assertEqual(root['rawPos'], ['n', 'v'])

    def test_normal_pos_api_remains_unchanged(self):
        before = pos_views('စားမလား။')
        template_views('စားမလား။')
        self.assertEqual(pos_views('စားမလား။'), before)


if __name__ == '__main__':
    unittest.main()
