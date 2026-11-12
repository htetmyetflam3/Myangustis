import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
COMPARE = REPO / 'C.Proofreading/architecture/tools/fallacy-comparison/compare.py'
spec = importlib.util.spec_from_file_location('fallacy_comparison', COMPARE)
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class EnginePosComparisonTests(unittest.TestCase):
    def test_knowledge_does_not_assign_codes_to_families(self):
        master = {
            'top': {'engine_defined_family': ['ကောင်းကင်']},
            'resolution': {'single': {}}, 'dictionary': {}, 'mapData': {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('master.enc', 'rules.js'):
                (root / name).write_bytes(b'fixture')
            with patch.object(comparison, 'REPO', root), \
                 patch.object(comparison, 'engine_data', return_value={
                     'master': str(root / 'master.enc'), 'sha256': hashlib.sha256(b'fixture').hexdigest()}), \
                 patch.object(comparison, 'RULES', root / 'rules.js'), \
                 patch.object(comparison, 'load_master', return_value=master), \
                 patch.object(comparison, '_rules_document', return_value={}), \
                 patch.object(comparison, 'sequence_catalog', return_value=[]):
                data = comparison.knowledge(root)
        self.assertNotIn('pos_codes', data)
        binding = data['bindings'][0]
        self.assertNotIn('pos_code', binding)
        self.assertEqual(binding['family'], 'engine_defined_family')

        evidence = comparison.Evidence(data).analyze('ကောင်းကင်{n,engine_tag}  ။<eos>\n', retain=1)
        hit = evidence['lexical_evidence'][0]
        self.assertEqual(hit['engine_raw_pos'], [['n', 'engine_tag']])
        self.assertNotIn('raw_pos_support', hit)
        self.assertEqual(evidence['binding_occurrences'][0]['examples'][0]['engine_raw_pos'], [['n', 'engine_tag']])

    def test_register_tagger_consumes_streamed_pos_metadata(self):
        register_spec = importlib.util.spec_from_file_location('register_for_stream_test', REPO / 'C.Proofreading/register.py')
        register = importlib.util.module_from_spec(register_spec)
        register_spec.loader.exec_module(register)
        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / 'source.txt'
            source.write_text('ကောင်းကင်သည် ကြည်လင်သည်။', encoding='utf-8')
            raw, meta = register.run_tagger(str(source), str(Path(tmp) / 'work'))
            self.assertEqual(raw, meta['raw_pos'])
            self.assertTrue(any(tags for _, tags, _ in register.parse_raw_pos_text(raw)))
            self.assertNotIn('raw_pos_path', meta)

    def test_python_tagger_calls_engine_and_preserves_raw_pos(self):
        with tempfile.TemporaryDirectory() as tmp:
            first, cached = comparison.tag_burmese('ကောင်းကင်သည် ကြည်လင်သည်။', Path(tmp))
            self.assertFalse(cached)
            parsed = list(comparison.read_tagged(first['raw_pos']))
            self.assertTrue(any(token['raw_pos'] for line in parsed for token in line))
            second, cached = comparison.tag_burmese('ကောင်းကင်သည် ကြည်လင်သည်။', Path(tmp))
            self.assertTrue(cached)
            self.assertEqual(first['raw_pos'], second['raw_pos'])


if __name__ == '__main__':
    unittest.main()
