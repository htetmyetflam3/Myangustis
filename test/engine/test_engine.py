"""Engine unit and JS parity tests. Node is used only as a test oracle."""
import asyncio
import json
import os
import random
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(os.environ.get('MYANGUSTIS_JS_REFERENCE_ROOT', Path(__file__).resolve().parents[2]))
# MYANGUSTIS_TREE_DIR can point at externally built reference trees.
from types import SimpleNamespace
from myangustis_engine.init.bridge import bind_engine
from myangustis_engine.MonoSyllabism.utilities import formatter, buffer as utilities
from myangustis_engine.MonoSyllabism.main.grapheme import tree_loaded, cache_integrity, traverser
from myangustis_engine.MonoSyllabism.main.phoneme import lexer, phonology, classify_number
from myangustis_engine.MonoSyllabism.generators import pos_input, SfomatterForP
from myangustis_engine.MonoSyllabism.utilities import stream
from myangustis_engine.MonoSyllabism.graph import build as graph_build
from myangustis_engine.MonoSyllabism.map import loader as native_mapper
from myangustis_engine.logen import Logen, read_counts, read_tally
from myangustis_engine.secure_data import secure as data
pipeline = SimpleNamespace(fullstop_holder=pos_input.fullstop_holder, classify_number=classify_number.classify_number,
    to_line_strings=SfomatterForP.to_line_strings, collect_from_text=stream.collect_from_text)
trees = SimpleNamespace(walk=traverser.walk, walk_pos=traverser.walk_pos,
    verify_cache_tree=cache_integrity.verify_cache_tree, write_cache_manifest=cache_integrity.write_cache_manifest,
    cache_info=cache_integrity.cache_info, load_syllables_data=tree_loaded.load_syllables_data)

ORACLE = r'''
import * as map from './Architecture/Engine/MonoSyllabism/map/loader.js';
import { BindEngine } from './Architecture/Engine/init/bridge.js';
import readline from 'node:readline';
const reader = readline.createInterface({ input: process.stdin });
for await (const line of reader) {
  try {
    const {method, args} = JSON.parse(line);
    let result;
    if (method === 'tables') result = {newClause: map.newClause, ALL_DIGITS: [...map.ALL_DIGITS], PUNCTUATION: [...map.PUNCTUATION]};
    else if (method === 'bridge') {
      const value = BindEngine(args[0]);
      if (value && typeof value[Symbol.asyncIterator] === 'function') {
        result = []; for await (const item of value) result.push(item);
      } else result = await value;
    } else result = map[method](...args);
    process.stdout.write(JSON.stringify({result}) + '\n');
  } catch (error) { process.stdout.write(JSON.stringify({error: String(error)}) + '\n'); }
}
'''


class Oracle:
    def __init__(self):
        self.proc = subprocess.Popen(['node', '--no-warnings', '--input-type=module', '-e', ORACLE], cwd=ROOT,
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                     encoding='utf-8')

    def call(self, method, *args):
        self.proc.stdin.write(json.dumps({'method': method, 'args': args}, ensure_ascii=True) + '\n')
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError(self.proc.stderr.read())
        response = json.loads(line)
        if 'error' in response: raise RuntimeError(response['error'])
        return response['result']

    def __getattr__(self, method): return lambda *args: self.call(method, *args)

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=10)
        self.proc.stdout.close()
        self.proc.stderr.close()


def consume(value):
    async def go():
        if hasattr(value, '__aiter__'): return [x async for x in value]
        return await value
    return asyncio.run(go())


class EngineTests(unittest.TestCase):
    def test_formatter_output(self):
        self.assertEqual(formatter.to_syllable_line('နေ√ကောင်း√လား√'), 'နေ  ကောင်း  လား')
        self.assertEqual(formatter.to_burmese_line_with_pos({'tokens': [{'syllables': ['က'], 'rawPos': ['n', 'v']}]}, 'rawPos'), 'က{n,v}')
        self.assertFalse(hasattr(formatter, 'to_positions'))

    def test_trie_and_reverse(self):
        tree = {'Root': {'a': {'St-1': [{'b': ['x']}], 'St-F': [{'c': ['z']}]}}}
        rtl = {'St-1': {'b': {'001': ['a']}}, 'St-2': {'cb': {'002': ['a']}}}
        self.assertEqual(trees.walk('abcd', 0, tree, rtl), {'endPos': 3, 'lastValidPos': 3, 'id': 'a002'})
        self.assertEqual(trees.walk('q', 0, tree, rtl)['id'], None)
        pos = {'A': {'x': ['n'], 'St-1': {'B': {'St-2': {'C': {'x': ['v']}}}}}}
        self.assertEqual(trees.walk_pos(['A', 'B', 'C'], 0, pos)['lastValidPos'], 3)
        self.assertEqual(trees.walk_pos(['A', 'B'], 0, pos)['lastValidPos'], 1)

    def test_manifest_integrity_and_traversal_protection(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            (directory / 'tree.json').write_text('{}')
            (directory / 'CACHE-MANIFEST.json').write_text(json.dumps({'files': {'tree.json': 'incorrect'}}))
            with self.assertRaisesRegex(ValueError, 'integrity'):
                trees.verify_cache_tree(directory)
            (directory / 'CACHE-MANIFEST.json').write_text(json.dumps({'files': {'../other': 'bad'}}))
            with self.assertRaisesRegex(ValueError, 'path'):
                trees.verify_cache_tree(directory)
        if cache_integrity.TREE_DIR.joinpath('CACHE-MANIFEST.json').exists():
            self.assertIn('pos.tree.json', trees.verify_cache_tree()['files'])

    def test_holders_and_numbers(self):
        self.assertEqual(list(pipeline.fullstop_holder(['က√။√ခ√။√ဂ√', 'ဃ√'])), ['က√။√ခ√။√', 'ဂ√ √ဃ√'])
        for text, tag in [('09-12345678', 'phone'), ('2024', 'year'), ('၁၂/၃/၂၀၂၄', 'exactdate'), ('၂/၃', 'addr'), ('၂၅', 'count')]:
            self.assertEqual(pipeline.classify_number(text)['rawPos'], [tag])
        self.assertEqual(list(pipeline.to_line_strings(['ab', '\n', '\n', 'x'])), ['ab', '', 'x'])
        self.assertEqual(list(pipeline.to_line_strings(['abc', 'def', '\n'], 4)), [])

    def test_validation_and_placeholder(self):
        for request in [None, {}, {'sourceText': '', 'flag': 'bad'}, {'sourceText': '', 'flag': 'pos', 'hash': 'x'}]:
            with self.assertRaises(TypeError): bind_engine(request)
        with self.assertRaises(NotImplementedError): bind_engine({'sourceText': '', 'flag': 'pos', 'debug': True})


    def test_graph_build_is_separate(self):
        master = {'syllables': ['က', 'ခ'], 'dictionary': {'NOUN': ['က', 'က  ခ', 'ပျောက်']}}
        with tempfile.TemporaryDirectory() as tmp:
            result = graph_build.build(tmp, master, lambda s: {'က': 'A', 'ခ': 'B'}.get(s, s))
            self.assertEqual(result['failures'], 1)
            self.assertEqual(master['dictionary']['NOUN'][-1], 'ပျောက်')
            manifest = cache_integrity.verify_cache_tree(Path(tmp))
            self.assertIn('pos.tree.json', manifest['files'])
            pos = tree_loaded.load_tree('pos.tree.json', Path(tmp))
            self.assertEqual(pos['A001']['x'], ['n'])
            self.assertEqual(pos['A001']['St-1']['B001']['x'], ['n'])
            self.assertTrue((Path(tmp) / 'pos-fail.txt').exists())

    def test_runtime_never_builds_missing_trees(self):
        with tempfile.TemporaryDirectory() as tmp:
            env = dict(os.environ, MYANGUSTIS_TREE_DIR=tmp)
            script = """import asyncio
from myangustis_engine import bind_engine
async def main():
    async for _ in bind_engine({'sourceText': 'က', 'flag': 'syllable', 'log': False}): pass
asyncio.run(main())
"""
            proc = subprocess.run([sys.executable, '-c', script], cwd=ROOT, env=env, capture_output=True, text=True)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn('prebuilt tree manifest', proc.stderr)
            self.assertEqual(list(Path(tmp).iterdir()), [])

    def test_real_builder_matches_existing_trees(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest('cryptography is not installed')
        existing = Path(os.environ.get('MYANGUSTIS_TREE_DIR', ROOT / 'Architecture/Engine/.cache-tree'))
        if not data.MASTER_ENC.exists() or not existing.exists(): self.skipTest('reference data not available')
        with tempfile.TemporaryDirectory() as tmp:
            graph_build.build(tmp, data.read_master_json())
            for name in ('syllable.tree.json', 'rtl-tree.json', 'pos.tree.json', 'ref-syllables.json'):
                with self.subTest(name=name):
                    self.assertEqual(json.loads((Path(tmp) / name).read_text()), json.loads((existing / name).read_text()))
            self.assertEqual((Path(tmp) / 'syllable.mapped.txt').read_bytes(), (existing / 'syllable.mapped.txt').read_bytes())

    def test_bridge_logging(self):
        class Identity:
            def normalize(self, text): return text
            def mapperStr(self, text): return text
            def toBurmeseStr(self, text): return text
            def isTail(self, char): return False
            def isBase(self, char): return False
            def isLowercaseAZ(self, char): return False
            def tables(self): return {'PUNCTUATION': [], 'ALL_DIGITS': [], 'newClause': {}}
        with tempfile.TemporaryDirectory() as tmp:
            from contextlib import redirect_stdout
            from io import StringIO
            logger = Logen(batch=True, file=Path(tmp) / 'engine.log')
            with redirect_stdout(StringIO()):
                consume(bind_engine({'sourceText': 'က။', 'flag': 'pos', 'log': True}, runtime=Identity(), logger=logger))
            text = logger.file.read_text(encoding='utf-8')
            self.assertIn('segmenting...', text)
            self.assertIn('tagging...', text)
            self.assertEqual(logger.tracker('TAGGER').counters['tokenReceived'], 2)
            with redirect_stdout(StringIO()):
                consume(bind_engine({'sourceText': 'က။', 'flag': 'pos', 'log': False}, runtime=Identity(), logger=logger))
            self.assertEqual(logger.file.read_text(encoding='utf-8'), text)

    def test_caller_signature_and_path_requests_are_rejected(self):
        for request in (
            {'sourceText': 'က', 'flag': 'syllable', 'hash': 'a' * 72},
            {'sourceText': 'က', 'flag': 'pos', 'hash': None},
            {'sourceText': 'က', 'flag': 'pos', 'outputPath': '/tmp/out'},
        ):
            with self.subTest(request=request), self.assertRaises(TypeError):
                bind_engine(request)

    def test_utility_and_data(self):
        self.assertEqual(utilities.split_buffer('a\nb'), {'lines': 'a\n', 'remainder': 'b'})
        self.assertEqual(list(pipeline.collect_from_text('a😄b', 2)), ['a\ud83d', '\ude04b'])
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'input.txt'
            path.write_text('က\nhello\nနောက်', encoding='utf-8')
            self.assertEqual(''.join(utilities.collector(path, 1)), path.read_text(encoding='utf-8'))
            manifest_dir = Path(tmp) / 'tree'
            manifest_dir.mkdir()
            (manifest_dir / 'pos.tree.json').write_text('{"root": {}}')
            written = trees.write_cache_manifest(manifest_dir)
            self.assertEqual(written['counts']['posRoots'], 1)
            self.assertEqual(trees.cache_info(manifest_dir)['counts']['posRoots'], 1)
        self.assertIn('minimal_sentence_patterns', data.load_main_rules())
        self.assertEqual(data.load_template_data()['SyllableSchema']['main'], 'syllable')
        self.assertEqual(set(data.load_template_data()['Templates']), {f'msp-{i:02}' for i in range(1, 8)})
        self.assertIsInstance(data.load_template_data()['StyleSets']['E'], set)
        if data.MASTER_ENC.exists():
            self.assertEqual(data.master_fingerprint(), trees.verify_cache_tree()['sourceMasterSha256'])
        self.assertEqual(read_counts({'a': 2})['total'], 2)
        self.assertEqual(read_tally({'abc=>a': 2})['chars'], 4)

    def test_secure_master(self):
        try:
            import cryptography  # noqa: F401
        except ImportError:
            self.skipTest('cryptography is not installed')
        if not data.MASTER_ENC.exists(): self.skipTest('encrypted master not available')
        master = data.read_master_json()
        self.assertTrue(master['syllables'])
        self.assertGreater(len(trees.load_syllables_data()), 100)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'sample.json'
            from cryptography.hazmat.primitives.ciphers.aead import AESGCM
            key = data._key()
            iv = bytes(range(12))
            encrypted = AESGCM(key).encrypt(iv, b'{"ok":true}', None)
            Path(str(path) + '.enc').write_bytes(b'MGR1' + iv + encrypted[-16:] + encrypted[:-16])
            self.assertEqual(data.read_secure_json(path), {'ok': True})
            damaged = bytearray(Path(str(path) + '.enc').read_bytes()); damaged[-1] ^= 1
            Path(str(path) + '.enc').write_bytes(damaged)
            with self.assertRaises(Exception): data.read_secure_json(path)

    def test_logen(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Logen(batch=True, file=Path(tmp) / 'out' / 'log.txt', checks=True)
            events = []
            log.on_event('*', events.append)
            log.emit_event('segment', {'lines': 3})
            self.assertEqual(events, [{'event': 'segment', 'lines': 3}])
            log.record('segment', {'lines': 3})
            log.define_check('lines', after='segment', run=lambda data, chain: bool(chain))
            self.assertTrue(log.run_checks('segment', {})[0]['ok'])
            log.tracker('SEGMENT').sample('examples', 'a', 1)
            log.tracker('SEGMENT').sample('examples', 'b', 1)
            self.assertIn('SEGMENT.examples: b', log.flush_report(False))
            log.emit_log('ENGINE', 'success', 'done', {'n': 1})
            self.assertIn('done', log.file.read_text())


@unittest.skipUnless(shutil.which('node') and (ROOT / 'Architecture/Engine/MonoSyllabism/map/loader.js').exists(), 'JS engine and Node are needed for parity tests')
class JavaScriptParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.oracle = Oracle()
    @classmethod
    def tearDownClass(cls): cls.oracle.close()

    def test_bridge(self):
        texts = ['', 'မင်္ဂလာပါ။', 'ကျွန်တော် မြန်မာစာကို လေ့လာနေပါတယ်။ နေကောင်းလား။',
                 'ဦး နှင့် ဪ။ ၂၀၂၄ 09-12345678\nHello world!\n', 'a\n\nခ။ဂ။ဃ။', '😄က🙂', '{😄} က']
        for text in texts:
            for flag in ('syllable', 'pos'):
                with self.subTest(text=text, flag=flag):
                    request = {'sourceText': text, 'flag': flag, 'log': False}
                    expected = self.oracle.bridge(request)
                    actual = consume(bind_engine(request, runtime=self.oracle))
                    self.assertEqual(actual, expected)
                    self.assertEqual(consume(bind_engine(request)), expected)

    def test_template_snapshot_matches_javascript(self):
        template = ROOT / 'Architecture/Engine/knowledge/isTreasure/template.js'
        if not template.exists(): self.skipTest('JS templates not available')
        script = "import {Templates} from './Architecture/Engine/knowledge/isTreasure/template.js'; console.log(JSON.stringify(Templates));"
        output = subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=ROOT, text=True)
        js_templates = json.loads(output)
        self.assertEqual(data.load_template_data()['Templates'], js_templates)
        for name, expected_slots in [('msp-06', ['pe1', 'pe2', 'pe3', 'pe4', 'pe5']),
                                     ('msp-07', ['pe1', 'pe2', 'pe3', 'pe4'])]:
            template = js_templates[name]
            self.assertEqual(template['tail']['status'], 'reject')
            self.assertEqual(len(template['head']['root']['children']), 1)
            node, slots = template['head']['root']['children'][0], []
            while node:
                slots.append(node['slot'])
                node = node.get('next')
            self.assertEqual(slots, expected_slots)

    def test_native_mapper(self):
        texts = ['ကောင်းလား', 'မင်္ဂလာပါ', 'abc 12-34', 'ဉ့် ဥ်၊', 'ကာ့ာ', 'hello 😄 ကျောင်း', 'ဦး ၂၀၂၄', 'aက']
        for text in texts:
            for method in ('normalize', 'mapperNormalize', 'myNormalize', 'mapperStr', 'toBurmeseStr'):
                with self.subTest(text=text, method=method):
                    self.assertEqual(getattr(native_mapper, method)(text), self.oracle.call(method, text))

    def test_mixed_random_parity(self):
        rng = random.Random(391)
        words = ['မင်္ဂလာ', 'မြန်မာ', 'စား', '။', 'ကောင်း', '  ', '\n', '2024', 'abc', '၊', '😀']
        for _ in range(20):
            text = ''.join(rng.choice(words) for _ in range(rng.randint(1, 7)))
            for flag in ('pos', 'syllable'):
                request = {'sourceText': text, 'flag': flag, 'log': False}
                with self.subTest(text=text, flag=flag):
                    expected = self.oracle.bridge(request)
                    self.assertEqual(consume(bind_engine(request, runtime=self.oracle)), expected)
                    self.assertEqual(consume(bind_engine(request)), expected)


if __name__ == '__main__': unittest.main()
