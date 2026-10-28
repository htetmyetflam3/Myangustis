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

REPO = Path(__file__).resolve().parents[3]
COMPARE = REPO / 'C.Proofreading/main/tools/fallacy-comparison/compare.py'
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
            for name in ('master.enc', 'rules.js', 'box.wasm'):
                (root / name).write_bytes(b'fixture')
            with patch.object(comparison, 'REPO', root), \
                 patch.object(comparison, 'engine_data', return_value={
                     'master': str(root / 'master.enc'), 'sha256': hashlib.sha256(b'fixture').hexdigest()}), \
                 patch.object(comparison, 'RULES', root / 'rules.js'), \
                 patch.object(comparison, 'BOX_WASM', root / 'box.wasm'), \
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

    def test_knowledge_reads_sealed_data_and_keeps_family_labels_unmapped(self):
        master = {
            'top': {'engine_family': ['ကောင်းကင်'], 'wibat': {'n': {}, 'v': {}}},
            'resolution': {'single': {}}, 'dictionary': {}, 'mapData': {},
        }
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ('index-path.js', 'Architecture/_index.js', 'Architecture/Engine/_path.js',
                         'Architecture/Engine/.data/secure.js', 'Architecture/Engine/bridge/bind-engine.js',
                         'Architecture/host/config.js', 'Architecture/host/job-store.js',
                         'tools-box/js/engine-data.js'):
                target = root / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(REPO / name, target)
            (root / 'package.json').write_text('{"type":"module"}')
            rules = root / 'rules.js'
            rules.write_text('{}')
            box = root / 'box.wasm'
            box.write_bytes(b'fixture')
            key = 'ab' * 32
            script = """
                import { createCipheriv } from 'node:crypto';
                import { writeFileSync } from 'node:fs';
                const key = Buffer.from(process.argv[1], 'hex');
                const iv = Buffer.alloc(12, 7);
                const cipher = createCipheriv('aes-256-gcm', key, iv);
                const body = Buffer.concat([cipher.update(process.argv[2], 'utf8'), cipher.final()]);
                writeFileSync(process.argv[3], Buffer.concat([Buffer.from('MGR1'), iv, cipher.getAuthTag(), body]));
            """
            subprocess.run(['node', '--input-type=module', '-e', script, key,
                            json.dumps(master, ensure_ascii=False), str(root / 'Architecture/Engine/.data/master.json.enc')], check=True)
            with patch.dict(os.environ, {'MASTER_JSON_KEY': key}), \
                 patch.object(comparison, 'REPO', root), \
                 patch.object(comparison, 'DATA_BRIDGE', root / 'tools-box/js/engine-data.js'), \
                 patch.object(comparison, 'RULES', rules), \
                 patch.object(comparison, 'BOX_WASM', box):
                data = comparison.knowledge(root)
                register_spec = importlib.util.spec_from_file_location('register_for_data_test', REPO / 'C.Proofreading/register.py')
                register = importlib.util.module_from_spec(register_spec)
                register_spec.loader.exec_module(register)
                with patch.object(register, 'DATA_BRIDGE', str(root / 'tools-box/js/engine-data.js')):
                    self.assertEqual(register.load_master(), ({}, {}))
                    self.assertEqual(register.engine_data('paths')['master'], str(root / 'Architecture/Engine/.data/master.json.enc'))
            self.assertNotIn('pos_codes', data)
            self.assertNotIn('pos_code', data['bindings'][0])
            self.assertEqual(data['bindings'][0]['family'], 'engine_family')
            self.assertEqual(data['sources']['master_sha256'], hashlib.sha256((root / 'Architecture/Engine/.data/master.json.enc').read_bytes()).hexdigest())

    def test_parser_reads_encrypted_override_through_engine_bridge(self):
        modules = REPO / 'B.Parser/main/Python/modules'
        sys.path.insert(0, str(modules))
        self.addCleanup(lambda: sys.path.remove(str(modules)))
        scan_spec = importlib.util.spec_from_file_location('parser_scan_for_data_test', modules / 'scan.py')
        scan = importlib.util.module_from_spec(scan_spec)
        scan_spec.loader.exec_module(scan)
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'override.json.enc'
            key = 'cd' * 32
            script = """
                import { createCipheriv } from 'node:crypto';
                import { writeFileSync } from 'node:fs';
                const iv = Buffer.alloc(12, 8);
                const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.argv[1], 'hex'), iv);
                const body = Buffer.concat([cipher.update('{"fixture":true}', 'utf8'), cipher.final()]);
                writeFileSync(process.argv[2], Buffer.concat([Buffer.from('MGR1'), iv, cipher.getAuthTag(), body]));
            """
            subprocess.run(['node', '--input-type=module', '-e', script, key, str(target)], check=True)
            with patch.dict(os.environ, {'MASTER_JSON_KEY': key}):
                self.assertEqual(scan._read_sealed(str(target)), {'fixture': True})

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
