"""Compare PDF page finishing to pinned JS; Node is a test oracle only."""
import io
import json
from pathlib import Path
import random
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from myangustis_parser.resources.engine import read_master_json
from myangustis_parser.workflow.finish import finish_pdf_page
from test_gsub_js_parity import REFERENCE, ROOT


class PdfFinishJsParityTests(unittest.TestCase):
    def test_page_finish_matches_js(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git required')
        if int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'])) < 22:
            self.skipTest('JS reference requires Node 22+')
        archive = subprocess.run(['git', 'archive', REFERENCE, 'B.Parser/architecture'],
                                 cwd=ROOT, capture_output=True)
        if archive.returncode:
            self.skipTest('Pinned JS reference commit unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
                for member in tar.getmembers():
                    if member.isfile():
                        destination = root / member.name
                        destination.parent.mkdir(parents=True, exist_ok=True)
                        destination.write_bytes(tar.extractfile(member).read())
            (root / 'package.json').write_text('{"type":"module"}')
            master = root / 'master.json'
            master.write_text(json.dumps(read_master_json(), ensure_ascii=False))
            (root / 'B.Parser/_path.js').write_text('''
import fs from 'node:fs';
export const MAP_DIR = new URL('./architecture/@jason-map/', import.meta.url).pathname;
export async function getEngineData() { return {readMasterJson: () => JSON.parse(fs.readFileSync(process.env.PARITY_MASTER, 'utf8'))}; }
''')
            bridge = root / 'A.Engine/architecture/init/bridge.js'
            bridge.parent.mkdir(parents=True)
            bridge.write_text('export function BindEngine() { throw Error("test oracle does not run POS"); }')
            check = root / 'check.mjs'
            check.write_text('''
import fs from 'node:fs';
import {finishPageToFile, convertFinalizedPageText} from './B.Parser/architecture/@core/runtime/finalized-cmap.js';
const cases = JSON.parse(fs.readFileSync(0,'utf8'));
const outputs = cases.map(c => {
  const store = { *lines() { for (const s of c.text.split('\\n')) yield [0,0,12,s]; } };
  const page = finishPageToFile(store, {directory:process.env.PARITY_DIR,
     parsingPath:c.lane, sourceEncoding:c.encoding, fontNames:new Set(c.zawgyi ? ['Zawgyi-One'] : [])});
  try {
    const finished = [...page.text.chunks()].join('');
    return {decision:page.decision, category:page.category, finished,
      base:convertFinalizedPageText(finished,page,false), clean:convertFinalizedPageText(finished,page,true)};
  } finally { page.text.close(); }
});
console.log(JSON.stringify(outputs));
''')
            rng = random.Random(8675309)
            atoms = ['က', 'ခ', 'မ', 'ေ', 'ြ', 'ျ', 'ာ', 'ိ', 'ု', '်', '္', '့', 'း',
                     'ၻ', '႑', ' ', '\n', '\u200b', 'abc', 'ဝ', '၀', '😀', 'ကမ္ဘာ', 'ေြက']
            samples = ['', 'English heading', 'က', 'ေြက ေြခ ေြမ', 'ေြက', 'ကမ္ဘာ',
                       'ကမၻာ', 'မ်ဘာ', 'ကေိ', 'ေြက\nေြခ']
            samples += [''.join(rng.choice(atoms) for _ in range(rng.randint(1, 15))) for _ in range(300)]
            cases = [{'text': text, 'lane': rng.choice(('legacy', 'font-cmap')),
                      'encoding': rng.choice(('auto', 'unicode', 'zawgyi-one')),
                      'zawgyi': bool(rng.getrandbits(1))} for text in samples]
            import os
            env = dict(os.environ, PARITY_MASTER=str(master), PARITY_DIR=str(root))
            result = subprocess.run(['node', str(check)], input=json.dumps(cases).encode(),
                                    capture_output=True, check=True, timeout=60, env=env)
            expected = json.loads(result.stdout)
        # The one documented gap between this branch and the pinned mirror: the
        # legacy lane's own beautify rule (``normalize/legacy_order.arrange_legacy_order``)
        # is implemented in the parser and NOT in the JS -- ``finalized-cmap.js``
        # says "There is no legacy-specific reorder rule: extraction only decodes".
        # The divergence is therefore allowed ONLY on the legacy decision, and its
        # size is pinned so it cannot grow unnoticed. When main lands the rule,
        # delete this allowance and the count goes to zero.
        # See B.Parser/AUDIT.md, "The legacy ordering rule: two cases, chosen by
        # the code page".
        LEGACY_LANE_GAP = 39
        moved = []
        for index, (case, js) in enumerate(zip(cases, expected)):
            py = finish_pdf_page(case['text'], parsing_path=case['lane'],
                                 source_encoding=case['encoding'], zawgyi_codepage=case['zawgyi'])
            actual = {key: py[key] for key in js}
            # This tree names the no-rule decision ``pass-through``; the pinned
            # mirror still calls it ``aligned``. Map the word so a label difference
            # is not counted as a divergence.
            if actual['decision'] == 'pass-through':
                actual['decision'] = 'aligned'
            if actual == js:
                continue
            self.assertEqual(py['decision'], 'legacy',
                             f'sample {index} diverges from the mirror outside the '
                             f'documented legacy-lane gap: {case}')
            moved.append(index)
        self.assertEqual(len(moved), LEGACY_LANE_GAP,
                         f'the legacy-lane divergence moved to {len(moved)} samples '
                         f'(pinned at {LEGACY_LANE_GAP}); re-measure and update both '
                         f'the count and B.Parser/AUDIT.md')


if __name__ == '__main__': unittest.main()
