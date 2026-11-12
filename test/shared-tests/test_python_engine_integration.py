"""In-process Engine integration and Python JSON-loader regression tests."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from myangustis_engine.secure_data import secure
from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import TREE_DIR
from myangustis_parser.resources import maps, engine as parser_engine

ROOT = Path(__file__).resolve().parents[2]


def module_at(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class NativeJsonLoaderTests(unittest.TestCase):
    def test_plain_and_sealed_json_in_python_without_node(self):
        key = bytes(range(32))
        iv = bytes(range(12))
        content = {'mapData': {'Glue': [], 'IMPOSTER': {}}, 'dictionary': {'NOUN': ['က']}}
        ciphertext = AESGCM(key).encrypt(iv, json.dumps(content).encode(), None)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            sealed = root / 'master.json.enc'
            sealed.write_bytes(b'MGR1' + iv + ciphertext[-16:] + ciphertext[:-16])
            plain = root / 'plain.json'
            plain.write_text('{"plain": true}')
            with patch.dict(os.environ, {'MASTER_JSON_KEY': key.hex()}), \
                 patch.object(secure, 'MASTER_ENC', sealed), \
                 patch.object(subprocess, 'run', side_effect=AssertionError('no child processes')):
                parser_engine.clear_cache()
                self.addCleanup(parser_engine.clear_cache)
                self.assertEqual(parser_engine.read_master_json(), content)
                self.assertEqual(maps.read_json(sealed), content)
                self.assertEqual(maps.read_json(plain), {'plain': True})
                self.assertEqual(parser_engine.master_info()['master'], str(sealed))

    def test_bundled_parser_maps_are_available(self):
        for name in ('burmese-inventory.json', 'legacy-font-names.json',
                     'cipher-map.json', 'zawcode-draft-glyphs.json'):
            with self.subTest(name=name):
                self.assertIsInstance(maps.load_map(name), dict)


@unittest.skipUnless(secure.MASTER_ENC.exists() and (TREE_DIR / 'CACHE-MANIFEST.json').exists(),
                     'External engine master and prebuilt reference trees are needed')
class NativeEngineCallerTests(unittest.TestCase):
    def test_parser_proofreading_and_scraper_call_engine_without_node(self):
        tag_dir = ROOT / 'C.Proofreading/architecture/tools/Burmese-Pos'
        sys.path.insert(0, str(tag_dir))
        sys.path.insert(0, str(ROOT / 'D.Scraper/architecture/result'))
        try:
            import tag
            import text_collect
            from myangustis_engine.api import segment_text
            from myangustis_parser.normalize.cleanup import order_text
            text = 'မင်္ဂလာပါ။'
            with tempfile.TemporaryDirectory() as tmp, \
                 patch.object(subprocess, 'run', side_effect=AssertionError('no child processes')):
                result = tag.tag_text(text, work=Path(tmp))
                self.assertTrue(result and result[0]['tokens'])
                metadata = json.loads((Path(tmp) / 'result.json').read_text())
                self.assertIn('{', metadata['raw_pos'])
                self.assertEqual(text_collect._segment_documents([text], lambda _: None), [segment_text(text)])
                self.assertTrue(order_text(text))
        finally:
            sys.path.remove(str(tag_dir))
            sys.path.remove(str(ROOT / 'D.Scraper/architecture/result'))
