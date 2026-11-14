"""Deterministic differential tests for the JS and Python font decoders.

The reference is loaded only in a temporary directory; Node is not part of
Python parser runtime. A clone without the pinned JS commit skips this test.
"""
import json
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest

from myangustis_parser.extract.pdf_fonts import DocumentDecoding, FontDecoder, LEGACY_CODE_PAGES, parse_cmap_stream
from test_gsub_js_parity import git_file

FILES = [
    '@core/pdf/method/decoder.js', '@core/pdf/method/values.js',
    '@core/pdf/method/unicode/cmap/cmap.js', '@core/pdf/method/unicode/ttf.js',
    '@core/pdf/method/unicode/ttf/ttf-cmap.js', '@core/pdf/method/unicode/ttf/ttf-gsub.js',
    '@core/pdf/method/pdfencoding/encodings.js', '@core/pdf/method/legacy/fallback.js',
    '@core/pdf/method/legacy/codepage-names.js', '@core/pdf/method/legacy/codepage-registry.js',
    '@core/pdf/method/legacy/codepage-confirmed.js', '@core/pdf/method/legacy/codepage-subset.js',
    '@core/pdf/method/legacy/codepage-visual.js', '@helper/pylib.js',
    '@jason-map/visual-unicode-glyph-evidence.json',
]


class DecoderJsParityTest(unittest.TestCase):
    def test_seeded_resource_decoding_matches_js(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git are required for JS differential checks')
        major = int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]']))
        if major < 22:
            self.skipTest('JS reference requires Node 22 or later')
        try:
            files = {name: git_file(name) for name in FILES}
        except subprocess.CalledProcessError:
            self.skipTest('Pinned JS reference commit not present in local git history')
        rng = random.Random(8)
        cases = []
        for i in range(400):
            cid = i % 2 == 0
            kind = 'legacy' if i % 3 == 0 else 'font'
            page = rng.choice(['ayar', 'wininnwa']) if kind == 'legacy' and not cid else None
            keys = rng.sample(range(1, 120), 7)
            values = ['က', 'ခ', 'ေ', ' ', 'u', 'k', 'ပ္ပ']
            tu = [[key, rng.choice(values)] for key in keys[:4]] if i % 4 else None
            gids = [[key, 0x1000 + rng.randrange(30)] for key in keys[3:]]
            declared = bool(i % 5 == 0 and not cid)
            encoding = [[key, chr(65 + rng.randrange(26))] for key in keys]
            data = bytes(sum(([0, rng.choice(keys)] if cid else [rng.choice(keys)] for _ in range(8)), []))
            cases.append({'name': 'WWinPonnya' if i % 17 == 0 else 'TestFont',
                          'kind': kind, 'cid': cid, 'page': page, 'gids': gids, 'tu': tu,
                          'hasEncoding': declared, 'encoding': encoding, 'data': data.hex()})
        # Mixed widths and truncated/invalid codes must remain visible; they
        # must never be zero-padded into another valid glyph.
        cmap = ('2 begincodespacerange <01> <01> <0001> <0001> endcodespacerange\n'
                '2 begincidchar <01> 5 <0001> 6 endcidchar')
        for raw in ('01', '0001', '010001ff', '00'):
            cases.append({'name': 'TestFont', 'kind': 'font', 'cid': True, 'page': None,
                          'gids': [[5, 0x1000], [6, 0x1001]], 'tu': None,
                          'hasEncoding': False, 'encoding': [], 'data': raw, 'cmap': cmap})
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text('{"type":"module"}')
            for name, content in files.items():
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(content)
            (root / 'check.mjs').write_text('''
import fs from 'node:fs';
import {DocumentDecoding, FontDecoder} from './@core/pdf/method/decoder.js';
import {parseCmapStream} from './@core/pdf/method/unicode/cmap/cmap.js';
import {AYAR_LEGACY_CODE_PAGE, WININNWA_LEGACY_CODE_PAGE} from './@core/pdf/method/legacy/codepage-registry.js';
const cases = JSON.parse(fs.readFileSync(0, 'utf8'));
console.log(JSON.stringify(cases.map(c => {
  const doc = new DocumentDecoding(c.kind);
  const gids = new Map(c.gids); gids.direct = new Map(c.gids); gids.ambiguous = new Set();
  const font = new FontDecoder('F', {baseFont: c.name, isCid: c.cid,
    toUnicode: c.tu === null ? null : new Map(c.tu), ownGids: gids, doc,
    cmap: c.cmap ? parseCmapStream(c.cmap) : null,
    hasEncoding: c.hasEncoding, encoding: new Map(c.encoding),
    fontLegacyCodePage: c.page === 'ayar' ? AYAR_LEGACY_CODE_PAGE :
      c.page === 'wininnwa' ? WININNWA_LEGACY_CODE_PAGE : null});
  if (c.kind === 'legacy') doc.legacyResources = new Set(c.cid ? [] : [font]);
  return font.decode(Buffer.from(c.data, 'hex').toString('latin1'));
})));
''')
            result = subprocess.run(['node', str(root / 'check.mjs')], input=json.dumps(cases).encode(),
                                    capture_output=True, check=True, timeout=30)
        js = json.loads(result.stdout)
        self.assertEqual(len(js), len(cases))
        for i, (case, expected) in enumerate(zip(cases, js)):
            decoder = FontDecoder('F', base_font=case['name'], is_cid=case['cid'],
                to_unicode=dict(case['tu']) if case['tu'] is not None else None,
                encoding=dict(case['encoding']), has_encoding=case['hasEncoding'],
                own_gids=dict(case['gids']), doc=DocumentDecoding(case['kind']),
                cmap=parse_cmap_stream(case['cmap'].encode()) if case.get('cmap') else None,
                font_legacy_code_page=LEGACY_CODE_PAGES.get(case['page']),
                selected_legacy=not case['cid'])
            self.assertEqual(decoder.decode(bytes.fromhex(case['data'])), expected, i)


if __name__ == '__main__': unittest.main()
