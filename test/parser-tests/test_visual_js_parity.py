"""Compare witnessed visual recovery against JS for real checked-in fonts."""
import json
from pathlib import Path
import random
import shutil
import subprocess
import tempfile
import unittest

from test_decoder_js_parity import FILES
from test_gsub_js_parity import git_file
from test_visual_unicode import FONT, MM3, fixture, tharlon_mapping, decoder_for, raw
from myangustis_parser.extract.pdf_visual import decode_visual_unicode_run
from myangustis_parser.extract.pdf_extract import parse_ttf_cmap


class VisualJsParityTest(unittest.TestCase):
    def test_witnessed_font_runs_match_js(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git are required')
        if int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'])) < 22:
            self.skipTest('JS reference requires Node 22+')
        if not FONT.exists() or not MM3.exists():
            self.skipTest('Reference fonts unavailable')
        try:
            files = {name: git_file(name) for name in FILES}
        except subprocess.CalledProcessError:
            self.skipTest('Pinned JS reference commit absent')
        script = '''
import fs from 'node:fs';
import {DocumentDecoding, FontDecoder} from './@core/pdf/method/decoder.js';
import {parseTtfCmap} from './@core/pdf/method/unicode/ttf/ttf-cmap.js';
import {matchVisualUnicodeGlyphs, decodeVisualUnicodeRun} from './@core/pdf/method/legacy/codepage-visual.js';
const spec = JSON.parse(fs.readFileSync(0, 'utf8'));
const bytes = fs.readFileSync(spec.font);
const own = new Map(); own.direct = new Map(); own.ambiguous = new Set();
for (const [cp,id] of parseTtfCmap(bytes)) {
 if (!id) continue;
 const prior=own.get(id); if (prior === undefined || cp < prior) own.set(id,cp);
 if (own.direct.has(id) && own.direct.get(id)!==cp) {own.direct.delete(id);own.ambiguous.add(id);}
 else if (!own.ambiguous.has(id)) own.direct.set(id,cp);
}
const d = new FontDecoder('F',{isCid:true,ownGids:own,doc:new DocumentDecoding('font'),toUnicode:new Map(spec.mapping)});
d.visualUnicodeGlyphs = matchVisualUnicodeGlyphs(d,bytes);
if (!d.visualUnicodeGlyphs) throw new Error('No witnessed visual glyphs');
const out = spec.runs.map(({ids,boundary}) => {
 let unresolved=0;
 const parts=ids.map(id=>Buffer.from([id >> 8, id & 255]).toString('latin1'));
 const text=decodeVisualUnicodeRun(d,parts,{startsAtBoundary:boundary,onUnresolved:()=>unresolved++});
 return [text,unresolved];
});
console.log(JSON.stringify({out, cmap:[...parseTtfCmap(bytes)]}));
'''
        rng = random.Random(20261113)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'package.json').write_text('{"type":"module"}')
            for name, content in files.items():
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_bytes(content)
            (root / 'check.mjs').write_text(script)
            for font in (FONT, MM3):
                program, gid, own = fixture(font)
                if font == FONT:
                    mapping = tharlon_mapping(gid)
                else:
                    mapping = {gid('က'): ' ', gid('ခ'): 'ြ', gid('ဖ'): 'ြ', gid('ဒ'): 'ေ',
                               gid('င'): 'င', gid('မ'): 'မ', 228: 'ဒ', 239: ' ', 234: 'ျေ',
                               223: 'ာ', 224: 'ိ', 233: '်', 232: 'း', 259: 'ု', gid(' '): ' '}
                decoder = decoder_for(program, own, mapping)
                self.assertTrue(decoder.visual_unicode_glyphs)
                keys = list(mapping)
                runs = [{'ids': [rng.choice(keys) for _ in range(rng.randrange(1, 8))],
                         'boundary': bool(rng.randrange(2))} for _ in range(400)]
                spec = {'font': str(font), 'mapping': list(mapping.items()), 'runs': runs}
                result = subprocess.run(['node', str(root / 'check.mjs')], input=json.dumps(spec).encode(),
                                        capture_output=True, check=True, timeout=30)
                result_data = json.loads(result.stdout)
                self.assertEqual(parse_ttf_cmap(program), dict(result_data['cmap']))
                expected = result_data['out']
                for i, (run, js) in enumerate(zip(runs, expected)):
                    unresolved = []
                    py = decode_visual_unicode_run(decoder, [raw(gid) for gid in run['ids']],
                         starts_at_boundary=run['boundary'], on_unresolved=lambda: unresolved.append(True))
                    self.assertEqual([py, len(unresolved)], js, (font.name, i, run))


if __name__ == '__main__': unittest.main()
