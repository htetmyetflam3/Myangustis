"""OCR routing/finishing in the pinned JS parseDecoding, with a stub engine."""
import base64
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

from pdfbuild import build_pdf
from myangustis_parser.resources.engine import read_master_json
from myangustis_parser.entry import manager
from myangustis_parser.workflow import ocr, pipeline
from test_gsub_js_parity import REFERENCE, ROOT


def pdf_with_text(text):
    content = b'q 100 0 0 200 0 0 cm /Im Do Q'
    if text:
        content += b' BT /F 12 Tf 10 100 Td (' + text.encode('ascii') + b') Tj ET'
    return build_pdf({
        1: b'<< /Type /Catalog /Pages 2 0 R >>',
        2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        3: b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 200] /Resources << /XObject << /Im 5 0 R >> /Font << /F 6 0 R >> >> /Contents 4 0 R >>',
        4: (b'<< >>', content),
        5: (b'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>', b'x'),
        6: b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    })


class PdfOcrJsParityTest(unittest.TestCase):
    def test_target_length_uses_js_utf16_and_trim_whitespace(self):
        values = ['😀😀😀😀', '😀😀😀', '\ufeff1234567\ufeff', '\x851234567']
        job = {'pages': [{'has_img': True, 'text': value} for value in values]}
        with patch.object(ocr, 'available', return_value=True), \
             patch.object(ocr, 'ocr_pdf_page', return_value='OCR') as recognize:
            done = manager._ocr_pdf_image_pages(job, pdf_with_text(''), lambda _: None)
        self.assertEqual(done, [2, 3])
        self.assertEqual([call.args[1] for call in recognize.call_args_list], [2, 3])

    def test_blank_and_failed_ocr_leave_page_untouched(self):
        pdf = pdf_with_text('x')
        for result in ('\ufeff \n', RuntimeError('recognition failed')):
            job = pipeline.process_pdf_bytes(pdf, None)
            original = dict(job['pages'][0])
            with patch.object(ocr, 'available', return_value=True), \
                 patch.object(ocr, 'ocr_pdf_page', side_effect=result if isinstance(result, Exception) else None,
                              return_value=result):
                self.assertEqual(manager._ocr_pdf_image_pages(job, pdf, lambda _: None), [])
            self.assertEqual(job['pages'][0], original)

    def test_js_ocr_runtime_effect_on_output_and_report(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git required')
        if int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'])) < 22:
            self.skipTest('JS reference requires Node 22+')
        archive = subprocess.run(['git', 'archive', REFERENCE, 'B.Parser/architecture'], cwd=ROOT, capture_output=True)
        if archive.returncode:
            self.skipTest('Pinned JS reference unavailable')
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
                for member in tar.getmembers():
                    if member.isfile():
                        target = root / member.name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(tar.extractfile(member).read())
            (root / 'package.json').write_text('{"type":"module"}')
            master = root / 'master.json'
            master.write_text(json.dumps(read_master_json(), ensure_ascii=False))
            files = {
                'B.Parser/_path.js': '''import fs from 'node:fs';
export const MAP_DIR = new URL('./architecture/@jason-map/', import.meta.url).pathname;
export async function getEngineData() { return {readMasterJson: () => JSON.parse(fs.readFileSync(process.env.PARITY_MASTER, 'utf8'))}; }
''',
                'A.Engine/architecture/init/bridge.js': 'export function BindEngine() { throw Error("POS not used"); }',
                'A.Engine/public/advisory.js': 'export function agentAdvisory() {}',
                'node_modules/fflate/package.json': '{"type":"module","exports":"./index.js"}',
                'node_modules/fflate/index.js': 'export class Unzlib { constructor() { throw Error("compressed input not covered"); } }',
                # Isolate routing/finishing from OCR accuracy and dependencies.
                'B.Parser/architecture/@core/ocr/ocr.js': '''export async function ocrPdfPage() { return ' ေက  Myanmar & < > \\n'; }
export async function ocrImage() { return ''; }''',
            }
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            (root / 'check.mjs').write_text('''
import fs from 'node:fs';
import {parseDecoding} from './B.Parser/architecture/@core/run.js';
const pdfs=JSON.parse(fs.readFileSync(0,'utf8'));
const out=[];
for (const input of pdfs) out.push(await parseDecoding({kind:'pdf',source:Buffer.from(input,'base64'),log:()=>{}}));
console.log(JSON.stringify(out));
''')
            result = subprocess.run(['node', str(root / 'check.mjs')],
                                    input=json.dumps([base64.b64encode(pdf_with_text(t)).decode()
                                                      for t in ('', 'x', '12345678')]).encode(),
                                    capture_output=True, timeout=60,
                                    env=dict(os.environ, PARITY_MASTER=str(master)), check=True)
        pages = json.loads(result.stdout)
        self.assertEqual([p['pages'] for p in pages], [['ေက  Myanmar &amp; &lt; &gt;\n'], ['x'], ['12345678']])
        self.assertEqual([p['reports'][0]['base'] for p in pages], ['', 'x', '12345678'])
        self.assertEqual([p['reports'][0]['clean'] for p in pages], [None, None, None])
        for text, expected in zip(('', 'x', '12345678'), pages):
            pdf = pdf_with_text(text)
            job = pipeline.process_pdf_bytes(pdf, None)
            before = [report.copy() for report in job['reports']]
            with patch.object(ocr, 'available', return_value=True), \
                 patch.object(ocr, 'ocr_pdf_page', return_value=' ေက  Myanmar & < > \n') as recognize:
                done = manager._ocr_pdf_image_pages(job, pdf, lambda _: None)
            self.assertEqual(done, [] if len(text) >= 8 else [1])
            self.assertEqual(recognize.call_count, len(done))
            self.assertEqual(job['reports'], before)  # OCR does not rewrite the JS PDF report.
            self.assertEqual([page['marked'] for page in pipeline.build_final_pages(job)], expected['pages'])
            self.assertEqual(job['reports'][0]['base'], expected['reports'][0]['base'])
            self.assertEqual(pipeline.build_content(job), pipeline.build_final_pages(job)[0]['text'])


if __name__ == '__main__':
    unittest.main()
