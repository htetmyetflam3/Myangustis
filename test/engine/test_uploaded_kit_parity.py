"""Differential tests against the uploaded JS kit, without editing it.

The kit's build-payload.js inlines mapData and removes duplicate exports before
execution. Materialize those same sourceMap substitutions in a temporary copy;
the checked-in source files themselves are the reference, not a Python mirror.
"""
import json
import random
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from myangustis_engine.MonoSyllabism.map import normalize, source_mapper
from myangustis_engine.MonoSyllabism.graph import disassembler
from myangustis_engine.api import pos_views, segment_text
from myangustis_engine.MonoSyllabism.utilities.buffer import read_and_prepare
from myangustis_engine.MonoSyllabism.map import loader
from myangustis_engine.secure_data.secure import read_master_json

ROOT = Path(__file__).resolve().parents[2]
KIT = ROOT / 'secret'
ORACLE = ROOT / 'test/engine/secret_reference.mjs'


@unittest.skipUnless(shutil.which('node') and (KIT / 'master.json').is_file(),
                     'Node and the uploaded secret/ kit are required')
class UploadedKitParity(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        target = Path(cls.temp.name)
        for directory in ('base', 'graph'):
            shutil.copytree(KIT / directory, target / directory)
        for file in ('support.js', 'package.json'):
            shutil.copyfile(KIT / file, target / file)
        cls.master = json.loads((KIT / 'master.json').read_text(encoding='utf-8'))
        src = (target / 'base/sourceMap.js').read_text(encoding='utf-8')
        # Equivalent to build-payload.js's mapData inlining and duplicate-export removal.
        old = 'import mapData from "./normalize.js" with { type: "json" };'
        if old not in src:
            raise RuntimeError('Kit sourceMap import changed; update test materialization')
        src = src.replace(old, 'const mapData = ' + json.dumps(cls.master['mapData'], ensure_ascii=True) + ';')
        old = 'export { MMap, NewMap, newClause, IMPOSTER, Priority,BLOCK_PUNCT,ALL_DIGITS, PUNCTUATION,Glue,BURMESE_DIGITS,ENGLISH_DIGITS};'
        if old not in src:
            raise RuntimeError('Kit sourceMap exports changed; update test materialization')
        src = src.replace(old, 'export { MMap, NewMap, newClause, IMPOSTER, Priority };')
        (target / 'base/sourceMap.js').write_text(src, encoding='utf-8')
        cls.proc = subprocess.Popen(['node', str(ORACLE), str(target)], stdin=subprocess.PIPE,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    text=True, encoding='utf-8')

    @classmethod
    def tearDownClass(cls):
        cls.proc.stdin.close()
        cls.proc.wait(timeout=15)
        cls.proc.stdout.close()
        cls.proc.stderr.close()
        cls.temp.cleanup()

    def reference(self, method, *args):
        self.proc.stdin.write(json.dumps({'method': method, 'args': args}, ensure_ascii=True) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            self.fail('JS reference terminated: ' + self.proc.stderr.read())
        value = json.loads(line)
        if 'error' in value:
            self.fail(value['error'])
        return value['result']

    def test_master_matches_uploaded_source(self):
        self.assertEqual(read_master_json(), self.master)

    def test_mapper_and_normalizer_against_js(self):
        rng = random.Random(385)
        chars = list('ကခဂငစညတဒနပမယရလဝသဟအဥဦါာိီုူဲံ့း္်ေျြွှ၀၁၂၃၄။၊ ABCxyz$#^{}09-/.')
        chars += ['😀', '\n', '\t', '\u200b', '\u00a0', '\ufeff', 'é', '\u0301']
        inputs = ['ကြည့်', 'ကျွန်တော့်', 'hello 123', '{}', 'က\u103a\u1037']
        inputs += [''.join(rng.choices(chars, k=rng.randrange(1, 40))) for _ in range(300)]
        for name, fn in (('normalize', normalize.normalize), ('reorderAndWrap', normalize.reorderAndWrap),
                         ('deleteEnglishBlocks', normalize.deleteEnglishBlocks),
                         ('mapperNormalize', normalize.mapperNormalize), ('myNormalize', normalize.myNormalize),
                         ('mapperStr', source_mapper.mapperStr), ('toBurmeseStr', source_mapper.toBurmeseStr)):
            for text in inputs:
                with self.subTest(method=name, text=text):
                    self.assertEqual(fn(text), self.reference(name, text))

    def test_actual_master_graph_against_js(self):
        syllables = self.master['syllables']
        if isinstance(syllables, dict):
            syllables = [item for group in syllables.values() if isinstance(group, list) for item in group]
        expected = self.reference('buildSyllableLookup', syllables)
        actual = disassembler.build_syllable_lookup(syllables, normalize.mapperNormalize)
        self.assertEqual(actual, expected)
        self.assertEqual(disassembler.Bb(actual['lookupData']), self.reference('Bb', expected['lookupData']))
        _, pos = disassembler.extract_pos_data(self.master)
        mapping = {}
        for row in actual['refArray']:
            mapping.setdefault(row['original'], row['id'])
        self.assertEqual(disassembler.build_pos_tree(mapping, pos),
                         self.reference('buildPosTreeFromObject', mapping, pos))

    def test_js_utf16_and_whitespace_edges(self):
        data = {'A': {'001': '😀', '002': 'က'}}
        self.assertEqual(disassembler.Bb(data), self.reference('Bb', data))
        syllables = ['😀က', 'က😀', 'မြန်မာ']
        self.assertEqual(disassembler.build_syllable_lookup(syllables, normalize.mapperNormalize),
                         self.reference('buildSyllableLookup', syllables))
        mapping, pos = {'x': 'A'}, {'NOUN': ['\u0085x\u0085', '\ufeffx\ufeff']}
        self.assertEqual(disassembler.build_pos_tree(mapping, pos),
                         self.reference('buildPosTreeFromObject', mapping, pos))
        self.assertEqual(disassembler.extract_pos_data({'dictionary': {}, 'NOUN': ['x']})[1], {})

    def test_end_to_end_uses_mapper_normalize(self):
        text = 'ကြည့် စောင့် hello 123။'
        result = segment_text(text)
        self.assertIn('ကြည့်', result)
        self.assertIn('စောင့်', result)
        self.assertIn('hello', result)
        self.assertIn('123', result)
        self.assertNotIn('  ်', result)
        self.assertIn('hello', pos_views(text)['syllable'])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input.txt'
            path.write_text(text, encoding='utf-8')
            self.assertEqual(''.join(read_and_prepare(path, loader)), normalize.mapperNormalize(text))


if __name__ == '__main__':
    unittest.main()
