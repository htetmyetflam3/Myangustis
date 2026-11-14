"""Differential GSUB checks against a pinned upstream JS snapshot.

Runs only when Node and the main-branch reference commit are available. The
runtime parser never runs Node; this test makes the reference temporary.
"""
import base64
import json
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest

from myangustis_parser.extract.ttf_gsub import parse_gsub
from test_ttf_gsub import font_with_gsub, single, ligature, multiple

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = '67f02845bcd266ff764fcc167a3337626eb1c75f'
PREFIX = 'B.Parser/architecture/'


def git_file(path):
    return subprocess.run(['git', 'show', f'{REFERENCE}:{PREFIX}{path}'], cwd=ROOT,
                          capture_output=True, check=True).stdout


class GsubJsParityTest(unittest.TestCase):
    def test_synthetic_tables_match_js_reference(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git are required for JS differential checks')
        try:
            gsub = git_file('@core/pdf/method/unicode/ttf/ttf-gsub.js')
            cmap = git_file('@core/pdf/method/unicode/ttf/ttf-cmap.js')
            pylib = git_file('@helper/pylib.js')
        except subprocess.CalledProcessError:
            self.skipTest('Pinned JS reference commit not present in local git history')
        rng = random.Random(37)
        fixtures = [font_with_gsub([(1, [single([1], [3])]), (4, [ligature(3, 4, [2])])]),
                    font_with_gsub([(1, [single([1], [3])]),
                                    (2, [multiple(1, [1, 10]), multiple(1, [1, 11])])])]
        for _ in range(250):
            a, b, c, d = rng.sample(range(1, 1000), 4)
            fixtures.append(font_with_gsub([
                (1, [single([a, b], [c, d])]),
                (4, [ligature(c, rng.randrange(1001, 2000), [d])]),
                (2, [multiple(a, [a, b]), multiple(a, [a, c])])]))
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'package.json').write_text('{"type":"module"}')
            (path / 'ttf-gsub.js').write_bytes(gsub)
            (path / 'ttf-cmap.js').write_bytes(cmap.replace(b'../../../../../@helper/pylib.js', b'./pylib.js'))
            (path / 'pylib.js').write_bytes(pylib)
            (path / 'check.mjs').write_text('''
import fs from 'node:fs';
import {parseTtfGsubReverse, parseTtfVariantSlots} from './ttf-gsub.js';
const inputs = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(inputs.map(x => {
  const d = Buffer.from(x, 'base64');
  return {reverse: [...parseTtfGsubReverse(d)], variants: parseTtfVariantSlots(d)};
})));
''')
            payload = json.dumps([base64.b64encode(data).decode() for data in fixtures]).encode()
            raw = subprocess.run(['node', str(path / 'check.mjs')], input=payload,
                                 capture_output=True, check=True, timeout=30).stdout
        for index, (data, js) in enumerate(zip(fixtures, json.loads(raw))):
            reverse, variants = parse_gsub(data)
            self.assertEqual(reverse, {int(key): value for key, value in js['reverse']}, index)
            self.assertEqual({tuple(sorted(x)) for x in variants},
                             {tuple(sorted(x)) for x in js['variants']}, index)


if __name__ == '__main__': unittest.main()
