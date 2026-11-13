"""Owner-directed correction in the bundled runtime dictionary."""
import unittest

from myangustis_engine.api import pos_views
from myangustis_engine.secure_data.secure import read_master_json, master_fingerprint
from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import verify_cache_tree


class DictionaryRepairTests(unittest.TestCase):
    def test_thain_is_verb_and_tree_matches_master(self):
        dictionary = read_master_json()['dictionary']
        self.assertNotIn('သိမ်း', dictionary['NOUN'])
        self.assertEqual(dictionary['VERB'].count('သိမ်း'), 1)
        self.assertEqual(verify_cache_tree()['sourceMasterSha256'], master_fingerprint())
        pos = pos_views('အိပ်ရာ သိမ်း။')['raw_pos']
        self.assertIn('သိမ်း{v}', pos)
        self.assertNotIn('သိမ်း{n}', pos)

    def test_koka_entry_removed_from_source_runtime_and_tree(self):
        import json
        from pathlib import Path
        source = json.loads((Path(__file__).resolve().parents[2] / 'secret/master.json').read_text(encoding='utf-8'))
        master = read_master_json()
        self.assertEqual(source, master)
        self.assertNotIn('ကို  က', master['dictionary']['NOUN'])
        self.assertIn('ကို', master['dictionary']['WIBAT'])
        self.assertIn('က', master['dictionary']['WIBAT'])
        self.assertEqual(verify_cache_tree()['sourceMasterSha256'], master_fingerprint())
        pos = pos_views('ဦးဘက စဖရန်စ္စစကိုက ပြန်လာတယ်။')['raw_pos']
        self.assertNotIn('ကိုက{n}', pos)
        self.assertIn('ကို{w,p}', pos)
        self.assertIn('က{w,cn,n}', pos)
