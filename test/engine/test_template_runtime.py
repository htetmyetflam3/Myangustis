"""First template runtime: covered examples only; no extra grammar rules."""
import unittest
from copy import deepcopy

from myangustis_engine.api import pos_views, template_views
from myangustis_engine.Lexical.abstract.template_runtime import (
    analyse_sentence, _head_only, _tail_only, _mor_02_ka_role, _pe_boundary_filter,
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
        self.assertEqual(report(sentence, 'msp-03')['status'], 'unresolved')
        self.assertEqual(report(sentence, 'msp-04')['status'], 'unresolved')
        self.assertEqual(report(sentence, 'msp-05')['status'], 'unresolved')
        self.assertEqual(report(sentence, 'msp-06')['status'], 'unresolved')
        self.assertEqual(report(sentence, 'msp-07')['status'], 'unresolved')

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

    def test_msp03_two_slots_are_nested_under_end_verb(self):
        sentence = template_views('အိပ်ရာ သိမ်း။')[0]
        candidate = report(sentence, 'msp-03')
        self.assertEqual(candidate['status'], 'possible')
        analysis = candidate['analyses'][0]
        self.assertEqual(analysis['inherit'], ['msp-01'])
        root = analysis['head']['root']
        self.assertEqual((root['slot'], root['evidence']['surface']), ('V', 'သိမ်း'))
        child = root['children'][0]
        self.assertEqual((child['slot'], child['evidence'][0]['surface']), ('N1', 'အိပ်ရာ'))
        self.assertEqual(child['pe'], 'optional')
        self.assertEqual(analysis['tail']['status'], 'reject')
        self.assertEqual(report(sentence, 'msp-01')['status'], 'pending_fallback')

    def test_msp03_does_not_skip_other_tokens_or_approve_incomplete(self):
        data = load_template_data()
        tok = lambda s, p: {'syllables': [s], 'rawPos': p}
        tokens = [tok('အိပ်ရာ', ['n']), tok('သိမ်း', ['v']), tok('လား', ['n'])]
        original = deepcopy(tokens)
        self.assertEqual(report(analyse_sentence(tokens, complete=True, data=data), 'msp-03')['status'], 'unresolved')
        self.assertEqual(report(analyse_sentence(tokens[:2], complete=False, data=data), 'msp-03')['status'], 'unresolved')
        self.assertEqual(tokens, original)
        data['Templates']['msp-03']['head']['root']['children'][0]['slot'] = 'OTHER'
        self.assertEqual(report(analyse_sentence(tokens[:2], complete=True, data=data), 'msp-03')['status'], 'not_implemented')

    def test_book_locative_example_preserves_marker_and_verb_particles(self):
        sentence = template_views('ထမင်းဆိုင်မှာ စားမလား။')[0]
        candidate = report(sentence, 'msp-04')
        self.assertEqual(candidate['status'], 'possible')
        analysis = candidate['analyses'][0]
        root = analysis['head']['root']
        self.assertEqual(root['evidence']['surface'], 'စား')
        child = root['children'][0]
        self.assertEqual([t['surface'] for t in child['evidence']], ['ထမင်း', 'ဆိုင်'])
        self.assertEqual(child['must'], 'has_locative_particle')
        marker = child['marker_evidence']
        self.assertEqual(marker['surface'], 'မှာ')
        self.assertIn('နေရာပြဝိဘတ်', [c['type'] for c in marker['candidates']])
        self.assertIn('disambiguate', [c['type'] for c in marker['candidates']])
        self.assertEqual([t['surface'] for t in analysis['verb_unit_modifiers']], ['မ', 'လား'])
        self.assertEqual(analysis['inherit'], ['msp-01', 'msp-03'])
        self.assertEqual(report(sentence, 'msp-03')['status'], 'possible')

    def test_ambiguous_verb_particle_is_candidate_not_resolved(self):
        sentence = template_views('ဒီမှာ တည်းပါ။')[0]
        candidate = report(sentence, 'msp-04')
        self.assertEqual(candidate['status'], 'possible')
        modifier = candidate['analyses'][0]['verb_unit_modifiers'][0]
        self.assertEqual(modifier['surface'], 'ပါ')
        self.assertIn('n', modifier['rawPos'])
        self.assertEqual(modifier['selected_candidates'], ['p'])

    def test_book_msp05_ending_does_not_imply_full_parse(self):
        sentence = template_views('ထိုပညောင်ပင် တစ်မူကား အာဠာဝက ဘီလူးနေရာတည်း။')[0]
        candidate = report(sentence, 'msp-05')
        self.assertEqual(candidate['status'], 'unresolved')
        self.assertEqual([t['surface'] for t in candidate['ending_evidence']], ['တည်း'])
        self.assertEqual(candidate['analyses'], [])

    def test_owner_lsn_example_finds_ending_then_applies_style(self):
        sentence = template_views('ဦးဘက မန္တလေးကပြန်လာတယ်။')[0]
        style = sentence['style']
        self.assertEqual((style['status'], style['value']), ('selected', 'LSN'))
        self.assertEqual(style['scan'][0]['surface'], 'တယ်')
        occurrences = [x for x in style['applications'] if x['surface'] == 'က']
        self.assertEqual(len(occurrences), 2)
        for occurrence in occurrences:
            # Both 1:1 source paths survive; style alone does not establish
            # which occurrence is subject or source in an incomplete parse.
            self.assertIn(('သည်', 'style.LSN.!default'),
                          [(r['source'], r['path']) for r in occurrence['rules']])
            self.assertIn(('မှ', 'style.LSN.!default'),
                          [(r['source'], r['path']) for r in occurrence['rules']])

    def test_ending_style_is_selected_from_right_and_shared_style_is_skipped(self):
        lse = template_views('ဦးဘသည် မန္တလေးမှ ပြန်လာသည်။')[0]['style']
        self.assertEqual(lse['value'], 'LSE')
        self.assertEqual(lse['scan'][0]['surface'], 'သည်')
        data = load_template_data()
        tokens = [{'syllables': ['က'], 'rawPos': ['w']},
                  {'syllables': ['များ'], 'rawPos': ['n', 'p']}]
        style = analyse_sentence(tokens, complete=True, data=data)['style']
        self.assertEqual(style['value'], 'LSN')
        self.assertEqual([(x['surface'], x['styles']) for x in style['scan']],
                         [('များ', ['LSE', 'LSN']), ('က', ['LSN'])])
        self.assertEqual(analyse_sentence(tokens[1:], complete=True, data=data)['style']['status'], 'unresolved')
        self.assertEqual(analyse_sentence(tokens, complete=False, data=data)['style']['status'], 'unresolved')

    def test_style_never_classifies_noun_without_particle_candidate(self):
        tokens = [{'syllables': ['က'], 'rawPos': ['n']}]
        self.assertEqual(analyse_sentence(tokens, complete=True)['style']['status'], 'unresolved')

    def test_msp06_unknown_name_remains_one_conditional_noun_unit(self):
        for text, style, source_marker in (
                ('ဦးဘသည် မန္တလေးမှ ပြန်လာသည်။', 'LSE', 'မှ'),
                ('ဦးဘက မန္တလေးကပြန်လာတယ်။', 'LSN', 'က'),
                ('ဦးဘက စဖရန်စ္စစကိုက ပြန်လာတယ်။', 'LSN', 'က'),
                ('ဦးဘသည် စဖရန်စ္စစကိုမှ ပြန်လာသည်။', 'LSE', 'မှ')):
            with self.subTest(text=text):
                sentence = template_views(text)[0]
                self.assertEqual(sentence['style']['value'], style)
                candidate = report(sentence, 'msp-06')
                self.assertEqual(candidate['status'], 'possible')
                intended = 'စဖရန်စ္စစကို' if 'စဖရန်' in text else 'မန္တလေး'
                analyses = [a for a in candidate['analyses'] if a['bound_slots'] == ['pe1', 'pe2']]
                source = next(a['head']['root']['children'][0]['next'] for a in analyses
                              if a['head']['root']['children'][0]['next']['child']['unit_candidate']['surface'] == intended)
                self.assertEqual(source['evidence']['surface'], source_marker)
                noun = source['child']
                self.assertEqual(noun['unit_candidate']['status'], 'conditional')
                self.assertTrue(any('?' in t['rawPos'] for t in noun['evidence']))
                self.assertTrue(all(t['status'] == 'unresolved' for t in noun['evidence']))
                self.assertEqual(source['evidence']['rules'][0]['noun_type'], 'ထွက်ခွာရာပြ')

    def test_selected_pe_does_not_overlap_name_units_in_msp06(self):
        sentence = template_views('ဦးဘက စဖရန်စ္စစကိုက ပြန်လာတယ်။')[0]
        analyses = report(sentence, 'msp-06')['analyses']
        self.assertTrue(analyses)
        for analysis in analyses:
            node = analysis['head']['root']['children'][0]
            markers, noun_indices = set(), set()
            while node:
                if node.get('evidence'):
                    markers.add(node['evidence']['token_index'])
                    noun_indices.update(t['token_index'] for t in node['child']['evidence'])
                node = node.get('next')
            self.assertTrue(markers.isdisjoint(noun_indices))
        self.assertEqual([a['bound_slots'] for a in analyses], [['pe1', 'pe2']])
        rejected = report(sentence, 'msp-06')['rejected_analyses']
        self.assertEqual(rejected[0]['boundary_token_indices'], [2])
        self.assertEqual(rejected[0]['analysis']['bound_slots'], ['pe1'])
        # The ambiguous ကို remains in the name because no valid binding
        # selected it as a boundary.
        name = analyses[0]['head']['root']['children'][0]['next']['child']
        self.assertEqual(name['unit_candidate']['surface'], 'စဖရန်စ္စစကို')

    def test_pe_split_must_form_complete_binding_and_incomparable_paths_remain(self):
        # Two adjacent က tokens cannot both fill a role: the second would
        # have no noun child. Do not split solely because of a raw pe tag.
        sentence = template_views('ဦးဘကက ပြန်လာတယ်။')[0]
        report06 = report(sentence, 'msp-06')
        self.assertEqual(len(report06['analyses']), 1)
        self.assertEqual(report06['analyses'][0]['bound_slots'], ['pe1'])
        self.assertEqual(report06['rejected_analyses'], [])

        # A different marker set is not a strictly fuller version. Neither
        # independent completed binding is eliminated by the other's marker.
        def analysis(marker, noun_index, root=9):
            return {'head': {'root': {'evidence': {'token_index': root},
                'children': [{'evidence': {'token_index': marker},
                              'child': {'evidence': [{'token_index': noun_index}]}}]}},
                'verb_prefix_candidates': [], 'verb_suffix_candidates': []}
        first, second = analysis(2, 1), analysis(3, 2)
        kept, rejected = _pe_boundary_filter([first, second])
        self.assertEqual(kept, [first, second])
        self.assertEqual(rejected, [])
        # A different verb anchor is not evidence against this binding.
        fuller_other_root = analysis(3, 2, root=10)
        kept, rejected = _pe_boundary_filter([first, fuller_other_root])
        self.assertEqual(kept, [first, fuller_other_root])
        self.assertEqual(rejected, [])

    def test_msp06_subject_only_and_no_style(self):
        sentence = template_views('ဦးဘသည် ပြန်လာသည်။')[0]
        candidate = report(sentence, 'msp-06')
        self.assertEqual(candidate['status'], 'possible')
        self.assertEqual(candidate['analyses'][0]['bound_slots'], ['pe1'])
        no_style = template_views('အိပ်ရာ သိမ်း။')[0]
        self.assertEqual(report(no_style, 'msp-06')['status'], 'unresolved')

    def test_msp06_book_full_role_chain_with_real_tags(self):
        sentence = template_views('ဦးဘသည် မန္တလေးမှ ရန်ကုန်သို့ မီးရထားဖြင့် ပြန်လာသည်။')[0]
        candidate = report(sentence, 'msp-06')
        self.assertEqual(sentence['style']['value'], 'LSE')
        self.assertEqual(candidate['status'], 'possible')
        analysis = next(a for a in candidate['analyses'] if a['bound_slots'] == ['pe1', 'pe2', 'pe3', 'pe4'])
        roles = []
        node = analysis['head']['root']['children'][0]
        while node and node.get('evidence'):
            roles.append((node['class'], node['child']['unit_candidate']['surface'], node['evidence']['surface']))
            node = node.get('next')
        self.assertEqual(roles, [('subject-marker', 'ဦးဘ', 'သည်'),
                                 ('source', 'မန္တလေး', 'မှ'),
                                 ('goal', 'ရန်ကုန်', 'သို့'),
                                 ('instrument', 'မီးရထား', 'ဖြင့်')])
        self.assertTrue(any('?' in t['rawPos'] for t in analysis['unresolved_noun_tokens']))
        self.assertFalse(candidate['search_truncated'])
        # The fuller binding exposes real pe boundaries; over-grouped paths
        # are kept as rejected evidence, not valid analyses.
        self.assertEqual(len(candidate['analyses']), 1)
        self.assertEqual(len(candidate['rejected_analyses']), 2)

    def test_mor02_time_endings_and_default_place(self):
        endings = ['နာရီ', 'အချိန်', 'တုန်း', 'ရက်', 'လ', 'နှစ်', 'ခုနှစ်', 'မိနစ်', 'စဉ်', 'ခိုက်']
        for ending in endings:
            with self.subTest(ending=ending):
                decision = _mor_02_ka_role([{'surface': 'တစ်'}, {'surface': ending}], 'က')
                self.assertEqual(decision['result'], 'time')
                self.assertEqual(decision['matched_ending'], ending)
                self.assertEqual(decision['rule_id'], 'MOR-02')
        self.assertEqual(_mor_02_ka_role([{'surface': 'မန္တလေး'}], 'က')['result'], 'place')
        self.assertIsNone(_mor_02_ka_role([{'surface': 'နာရီ'}], 'မှ'))

    def test_mor02_real_tagged_time_ending_coverage(self):
        for ending in ('နာရီ', 'အချိန်', 'ရက်', 'လ', 'နှစ်', 'ခုနှစ်', 'မိနစ်'):
            with self.subTest(ending=ending):
                sentence = template_views(f'ဦးဘက {ending}က ပြန်လာတယ်။')[0]
                analyses = report(sentence, 'msp-06')['analyses']
                temporal = next(a for a in analyses if a['bound_slots'] == ['pe1', 'pe5'])
                node = temporal['head']['root']['children'][0]
                while node and node['slot'] != 'pe5':
                    node = node.get('next')
                self.assertEqual(node['evidence']['rules'][0]['context_rule']['matched_ending'], ending)
                self.assertFalse(any(a['bound_slots'] == ['pe1', 'pe2'] for a in analyses))
        # The tagger does not offer noun candidates for these standalone forms;
        # MOR-02 must not silently override POS to make the template fit.
        for ending in ('တုန်း', 'စဉ်', 'ခိုက်'):
            with self.subTest(ending=ending):
                sentence = template_views(f'ဦးဘက {ending}က ပြန်လာတယ်။')[0]
                self.assertEqual(report(sentence, 'msp-06')['status'], 'unresolved')

    def test_mor02_applies_to_marker_role_but_not_subject(self):
        for text, slot, expected, basis in (
            ('ဦးဘက စဖရန်စ္စစကိုက ပြန်လာတယ်။', 'pe2', 'place', 'default-place'),
            ('ဦးဘက တစ်နာရီက ပြန်လာတယ်။', 'pe5', 'time', 'listed-time-ending'),
            ('ဦးဘက သုံးရက်က ပြန်လာတယ်။', 'pe5', 'time', 'listed-time-ending'),
            # Owner's else means an unlisted time can be misclassified.
            ('ဦးဘက မနက်က ပြန်လာတယ်။', 'pe2', 'place', 'default-place'),
        ):
            with self.subTest(text=text):
                sentence = template_views(text)[0]
                candidate = report(sentence, 'msp-06')
                self.assertEqual(sentence['style']['value'], 'LSN')
                self.assertEqual(candidate['status'], 'possible')
                analysis = next(a for a in candidate['analyses'] if a['bound_slots'] == ['pe1', slot])
                node = analysis['head']['root']['children'][0]
                self.assertFalse(any('context_rule' in r for r in node['evidence']['rules']))
                while node and node['slot'] != slot:
                    node = node.get('next')
                decisions = [r['context_rule'] for r in node['evidence']['rules']]
                self.assertTrue(decisions)
                self.assertTrue(all(d['result'] == expected and d['basis'] == basis for d in decisions))
                self.assertNotIn(['pe1', 'pe5' if slot == 'pe2' else 'pe2'],
                                 [a['bound_slots'] for a in candidate['analyses']])
                self.assertFalse(any(a['bound_slots'] == ['pe1'] for a in candidate['analyses']))
                self.assertTrue(candidate['rejected_analyses'])
                self.assertFalse(candidate['search_truncated'])

    def test_msp06_more_roles_with_simulated_known_token(self):
        # Exercise slot wiring using the book's own examples with a simulated
        # dictionary candidate for the currently unrecognised syllable; this
        # does not imply the engine has fixed the real sentence.
        for text, expected in (
            ('ဦးဘသည် မန္တလေးမှ ရန်ကုန်သို့ ပြန်လာသည်။', ['pe1', 'pe2', 'pe3']),
            ('ဦးဘသည် မန္တလေးမှ ရန်ကုန်သို့ မီးရထားဖြင့် ပြန်လာသည်။', ['pe1', 'pe2', 'pe3', 'pe4']),
        ):
            with self.subTest(text=text):
                actual = template_views(text)[0]
                self.assertEqual(report(actual, 'msp-06')['status'], 'possible')
                tokens = deepcopy(actual['tokens'])
                for token in tokens:
                    if token['rawPos'] == ['?']:
                        token['rawPos'] = ['n']  # simulated input, not an override
                result = report(analyse_sentence(tokens, complete=True), 'msp-06')
                self.assertEqual(result['status'], 'possible')
                self.assertTrue(any(a['bound_slots'] == expected for a in result['analyses']))
                self.assertFalse(result['search_truncated'])

    def test_msp07_fronted_book_example_retains_evidence_without_guessing(self):
        sentence = template_views('မန္တလေးမှ ဦးဘ ပြန်လာသည်။')[0]
        result = report(sentence, 'msp-07')
        self.assertEqual(result['status'], 'unresolved')
        self.assertEqual(result['frontedRule'], 'outermost_N_is_TOPIC')
        self.assertEqual(result['inherit'], ['msp-06'])
        self.assertIn('မှ', [e['surface'] for e in result['marker_evidence']])
        self.assertEqual(result['analyses'], [])

    def test_template_pe_slot_names_are_preserved(self):
        templates = load_template_data()['Templates']
        for ident in ('msp-01', 'msp-03', 'msp-04', 'msp-06', 'msp-07'):
            self.assertEqual(templates[ident]['head']['slot'], 'pe')
        for ident in ('msp-03', 'msp-04'):
            self.assertEqual(templates[ident]['head']['root']['children'][0]['pe'], 'optional')
        self.assertEqual(templates['msp-05']['tail']['pe']['slot'], 'pe')
        for ident, count in (('msp-06', 5), ('msp-07', 4)):
            node = templates[ident]['head']['root']['children'][0]
            for i in range(1, count + 1):
                self.assertEqual(node['slot'], f'pe{i}')
                node = node.get('next')
            self.assertIsNone(node)

    def test_normal_pos_api_remains_unchanged(self):
        before = pos_views('စားမလား။')
        template_views('စားမလား။')
        self.assertEqual(pos_views('စားမလား။'), before)


if __name__ == '__main__':
    unittest.main()
