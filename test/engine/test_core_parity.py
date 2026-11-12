"""Differential checks against the actual JS engine; Node is a test oracle only."""
import json
import os
import random
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(os.environ.get('MYANGUSTIS_JS_REFERENCE_ROOT', Path(__file__).resolve().parents[2]))
REFERENCE = ROOT / 'Architecture/python/tests/core_reference.mjs'
JS_ENGINE = ROOT / 'Architecture/Engine/MonoSyllabism/map/loader.js'
KIT_FUNCTION = ROOT / 'Architecture/wasm/wasm-kit/base/function.js'
# MYANGUSTIS_TREE_DIR can point at externally built reference trees.

from myangustis_engine.MonoSyllabism.map import loader, source_mapper, function
from myangustis_engine.MonoSyllabism.main.grapheme import traverser, reverse, tree_loaded
from myangustis_engine.MonoSyllabism.main.phoneme import lexer, phonology, classify_number
from myangustis_engine.MonoSyllabism.utilities import formatter


@unittest.skipUnless(shutil.which('node') and JS_ENGINE.exists() and KIT_FUNCTION.exists(),
                     'Node, the JS engine, and the WASM kit are required for differential tests')
class CoreParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proc = subprocess.Popen(['node', '--no-warnings', str(REFERENCE)], cwd=ROOT,
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding='utf-8')

    @classmethod
    def tearDownClass(cls):
        cls.proc.stdin.close()
        cls.proc.wait(timeout=10)
        cls.proc.stdout.close()
        cls.proc.stderr.close()

    def reference(self, op, *args):
        self.proc.stdin.write(json.dumps({'op': op, 'args': args}, ensure_ascii=True) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise AssertionError('JS oracle terminated: ' + self.proc.stderr.read())
        result = json.loads(line)
        if 'error' in result:
            raise AssertionError(result['error'])
        return result['result']

    def test_normalize_and_both_variants(self):
        rng = random.Random(3214)
        corpus = ['က\u103a\u1037', 'ဥ်', 'ဉ့်', 'ကာာ', 'ကေ့', 'က့်', '  abc  123',
                  '{abc}', '{A^$}', 'a{က}b', '{{a}}', '{x', 'x}', '\ufeff2024\ufeff',
                  '\u00852024\u0085', '\ud83d\ude00', '\ud83d', '\ude00', '😀']
        chars = list('ကခဂငစဆညတဒနပဗမယရလဝသဟအဥဦႆါာိီုူဲံ့း္်ေျြွှဿ၀၁၂၃၄၅၆၇၈၉။၊ ABCxyz$#^{}09-/.')
        chars += ['😀', '\n', '\t', '\u200b', '\u00a0', '\ufeff', 'é', 'e\u0301']
        corpus.extend(''.join(rng.choices(chars, k=rng.randrange(45))) for _ in range(600))
        # Include every listed imposter, including its relevant context.
        for entry in loader.tables()['IMPOSTER'].values():
            corpus.extend(entry['imposters'])
        for method in ('normalize', 'mapperNormalize', 'myNormalize'):
            for text in corpus:
                with self.subTest(method=method, text=text):
                    self.assertEqual(getattr(loader, method)(text), self.reference(method, text))

    def test_brace_bypass_compose_decompose_and_mapping(self):
        mm, ascii_to_mm = source_mapper._maps()
        table = loader.tables()
        cases = ['{A^}', '{A^$}', '{aက}', '{abc}A^', 'A^{a}', '{{A^}}', '{A^', 'A^}',
                 '{}', '{{}}', '{🙂}', '\ud83d\ude00', '$🙂', '$A$B', 'ကင်္က', 'xy#က']
        rng = random.Random(882)
        chars = list('ABCxyzကခဂငျြေ္်^${} !') + ['😀']
        cases += [''.join(rng.choices(chars, k=rng.randrange(30))) for _ in range(450)]
        for text in cases:
            with self.subTest(text=text):
                self.assertEqual(function.compose(text, ascii_to_mm, set(table['NewMap']['Base'])), self.reference('compose', text))
                self.assertEqual(function.decompose(text, set(table['MMap']['Base'])), self.reference('decompose', text))
                self.assertEqual(loader.mapperStr(text), self.reference('mapperStr', text))
                self.assertEqual(loader.toBurmeseStr(text), self.reference('toBurmeseStr', text))
        # Important: compose is global in JS, while decompose bypasses braces.
        self.assertEqual(function.compose('{A^}', ascii_to_mm, set(table['NewMap']['Base'])), '{a}')
        self.assertEqual(function.decompose('{aက}', set(table['MMap']['Base'])), '{aက}')
        self.assertEqual(loader.toBurmeseStr('{aက}'), 'aက')

    def test_forward_reverse_and_pos_walkers(self):
        rng = random.Random(166)
        refs = tree_loaded.load_tree('ref-syllables.json')
        for row in refs:
            text = row['mapped'] + 'A'
            if text:
                self.assertEqual(traverser.walk(text, 0), self.reference('walk', text, 0), msg=repr(text))
        tree = tree_loaded.load_tree('pos.tree.json')
        roots = list(tree)
        for _ in range(600):
            root = rng.choice(roots)
            node, ids = tree[root], [root]
            for step in range(1, rng.randrange(2, 7)):
                choices = node.get(f'St-{step}', {})
                if not choices: break
                token = rng.choice(list(choices)); ids.append(token); node = choices[token]
            ids.append(rng.choice(roots))
            self.assertEqual(traverser.walk_pos(ids, 0), self.reference('walkPos', ids, 0), msg=repr(ids))
        rtl = tree_loaded.load_tree('rtl-tree.json')
        for step in rtl.values():
            for body, by_suffix in list(step.items())[:100]:
                for roots in by_suffix.values():
                    if roots:
                        root = roots[0]
                        text = root + body[::-1]
                        self.assertEqual(reverse.walk_reverse(rtl, text, root), self.reference('walkReverse', text, root))
        # Empty JS arrays/objects are truthy, unlike Python containers.
        fixture = {'St-1': [], 'St-F': [{'A': ['001']}]}
        expected = self.reference('walkFixture', fixture, 'A')
        self.assertEqual(traverser.walk('\x01A', 0, {'Root': {'\x01': fixture}}, {}), expected)
        pos_fixture = {'x': ['n'], 'St-1': {'A': {}}}
        expected = self.reference('walkPosFixture', pos_fixture, ['A'])
        self.assertEqual(traverser.walk_pos(['__fixture', 'A'], 0, {'__fixture': pos_fixture}), expected)
        self.assertEqual(traverser.walk('😀A', 1), self.reference('walk', '😀A', 1))

    def test_number_classification(self):
        cases = ['', '09-12345678', '၀၉၁၂၃၄၅၆၇၈၉', '0999999', '091234567890',
                 '1199', '1200', '1400', '1401', '1899', '1900', '2100', '2101',
                 '၂၀၂၄', '1/2/2024', '1,2,3', '1.2.3', '1/2', '1 2',
                 '\ufeff2024\ufeff', '\u00852024\u0085', '\t2024\n', '😀2024', '1-/3.4']
        rng = random.Random(717)
        chars = list('0123456789၀၁၂၃၄၅၆၇၈၉,./- abc') + ['\ufeff', '\u0085', '\u00a0']
        cases += [''.join(rng.choices(chars, k=rng.randrange(20))) for _ in range(800)]
        for text in cases:
            self.assertEqual(classify_number.classify_number(text), self.reference('classifyNumber', text), msg=repr(text))

    def test_segmentor_and_pos_tagger(self):
        rng = random.Random(991)
        chars = list('ABCxyzကခဂငြျွေိီုူ္်၀၁၂၃၄၉။၊ #^${}09-/.') + ['😀', '\n', '\u200b']
        blocks = [['{🙂}'], ['ABC\n', 'A^$ {aက}'], ['\ud83d\ude00'], ['x{missing', '}x']]
        blocks += [[''.join(rng.choices(chars, k=rng.randrange(40))) for _ in range(rng.randrange(1, 4))] for _ in range(450)]
        for stream in blocks:
            self.assertEqual(list(lexer.run_segmentor(stream, loader)), self.reference('segment', stream), msg=repr(stream))
        syllables = list(tree_loaded.mappings()['burmese']) + ['၀၉၁၂၃၄၅၆၇၈၉', '၂၀၂၄', ' ', '\t', '။', '၊', '{abc}', 'abc', '?']
        units = [['ဪ√ဦး√။√', ' '], ['၀၉၁၂၃၄၅၆၇၈၉√။√', '။√']]
        units += [['√'.join(rng.choices(syllables, k=rng.randrange(1, 12))) + '√'
                   for _ in range(rng.randrange(1, 4))] for _ in range(350)]
        for lines in units:
            self.assertEqual(list(phonology.run_tagger(lines, loader)), self.reference('tagger', lines), msg=repr(lines))

    def test_js_whitespace_formatting(self):
        self.assertEqual(formatter.to_syllable_line('\ufeff√A√'), 'A')
        self.assertEqual(formatter.to_syllable_line('\u0085√A√'), '\u0085  A')
        self.assertEqual(classify_number.classify_number('\ufeff2024\ufeff'), {'rawPos': ['year']})
        self.assertEqual(classify_number.classify_number('\u00852024\u0085'), {'rawPos': ['count']})
