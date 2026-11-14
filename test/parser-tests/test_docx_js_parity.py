"""DOCX extraction and finishing against the pinned JS runtime."""
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
from zipfile import ZipFile

from myangustis_parser.normalize.detector import ZawgyiDetector
from myangustis_parser.resources.engine import read_master_json
from myangustis_parser.workflow import pipeline, ocr
from myangustis_parser.entry import manager
from unittest.mock import patch
from test_gsub_js_parity import REFERENCE, ROOT


def docx(paragraphs):
    xml = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body>' + ''.join(paragraphs) + '</w:body></w:document>')
    buf = io.BytesIO()
    with ZipFile(buf, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', xml)
    return buf.getvalue()


def docx_image():
    xml = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
           'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
           'xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships">'
           '<w:body><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Before</w:t></w:r></w:p>'
           '<w:p><w:r><a:blip r:embed="r1"/></w:r></w:p></w:body></w:document>')
    rels = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="r1" Type="http://x/image" Target="media/a%20b.png"/>'
            '</Relationships>')
    buf = io.BytesIO()
    with ZipFile(buf, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', xml)
        archive.writestr('word/_rels/document.xml.rels', rels)
        archive.writestr('word/media/a b.png', b'image')
    return buf.getvalue()


def paragraph(text, props=''):
    return f'<w:p><w:r><w:rPr>{props}</w:rPr><w:t>{text}</w:t></w:r></w:p>'


class DocxJsParityTest(unittest.TestCase):
    def test_markup_reaches_docx_writer_and_plain_text_is_unmarked(self):
        data = docx([paragraph('a &amp; b', '<w:b/><w:i/>')])
        job = pipeline.process_docx_bytes(data, ZawgyiDetector())
        pages = pipeline.build_final_pages(job)
        self.assertEqual(pages[0]['marked'], '<b><i>a &amp; b</i></b>')
        self.assertEqual(pipeline.build_content(job), 'a & b')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'out.docx'
            pipeline.render_texts(path, pages, job['counts'], 'test.docx')
            with ZipFile(path) as result:
                xml = result.read('word/document.xml').decode()
            self.assertIn('<w:b', xml)
            self.assertIn('<w:i', xml)
            self.assertIn('a &amp; b', xml)

    def test_docx_runtime_fixtures(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git required')
        if int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'])) < 22:
            self.skipTest('JS reference requires Node 22+')
        archive = subprocess.run(['git', 'archive', REFERENCE, 'B.Parser/architecture'], cwd=ROOT, capture_output=True)
        if archive.returncode:
            self.skipTest('Pinned JS reference unavailable')
        cases = [
            (docx([paragraph('ေက')]), 'auto'),
            (docx([paragraph('ေက', '<w:rFonts w:ascii="Padauk"/>')]), 'auto'),
            (docx([paragraph('ေကာင္းကင္', '<w:rFonts w:ascii="Zawgyi-One"/>')]), 'auto'),
            (docx([paragraph('ေက')]), 'unicode'),
            (docx([paragraph('ေကာင္းကင္')]), 'zawgyi-one'),
            (docx([paragraph('a &amp; b', '<w:b/><w:i/>')]), 'auto'),
            (docx([paragraph('one'), paragraph('two', '<w:b w:val="0"/>')]), 'auto'),
            (docx([paragraph('row%03d' % i) for i in range(81)]), 'auto'),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with tarfile.open(fileobj=io.BytesIO(archive.stdout)) as tar:
                for member in tar.getmembers():
                    if member.isfile():
                        target = root / member.name
                        target.parent.mkdir(parents=True, exist_ok=True)
                        target.write_bytes(tar.extractfile(member).read())
            files = {
                'package.json': '{"type":"module"}',
                'B.Parser/_path.js': '''import fs from 'node:fs';
export const MAP_DIR = new URL('./architecture/@jason-map/', import.meta.url).pathname;
export async function getEngineData() { return {readMasterJson: () => JSON.parse(fs.readFileSync(process.env.PARITY_MASTER, 'utf8'))}; }
''',
                'B.Parser/architecture/@core/ocr/ocr.js': "export async function ocrImage() { return ' ေက  OCR & < > \\n'; }",
                'A.Engine/architecture/init/bridge.js': 'export function BindEngine() { throw Error("POS not used"); }',
                'A.Engine/public/advisory.js': 'export function agentAdvisory() {}',
                'node_modules/fflate/package.json': '{"type":"module","exports":"./index.js"}',
                'node_modules/fflate/index.js': 'export class Unzlib { constructor() { throw Error("unused"); } }',
            }
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            master = root / 'master.json'
            master.write_text(json.dumps(read_master_json(), ensure_ascii=False))
            (root / 'check.mjs').write_text('''
import fs from 'node:fs';
import {processDocxBytes} from './B.Parser/architecture/@core/docx/source.js';
import {buildFinalPages} from './B.Parser/architecture/@core/runtime/finish.js';
import {parseDecoding} from './B.Parser/architecture/@core/run.js';
const inputs=JSON.parse(fs.readFileSync(0,'utf8'));
const out=[];
for (const c of inputs) {
 try {
  if (c.full) { out.push(await parseDecoding({kind:'docx',source:Buffer.from(c.pdf,'base64'),filename:'test.docx',log:()=>{}})); continue; }
  const job=await processDocxBytes(Buffer.from(c.pdf,'base64'),'test.docx',()=>{},{sourceEncoding:c.encoding});
  out.push({reports:job.reports,pages:buildFinalPages(job,true),counts:job.counts});
 } catch (error) { out.push({error: error.message}); }
}
console.log(JSON.stringify(out));
''')
            result = subprocess.run(['node', str(root / 'check.mjs')],
                input=json.dumps([{'pdf': base64.b64encode(data).decode(), 'encoding': enc} for data, enc in cases] +
                                 [{'pdf': base64.b64encode(docx_image()).decode(), 'full': True}]).encode(),
                capture_output=True, timeout=60, env=dict(os.environ, PARITY_MASTER=str(master)))
            if result.returncode:
                self.fail(result.stderr.decode(errors='replace'))
            js = json.loads(result.stdout)
        for index, ((data, encoding), expected) in enumerate(zip(cases, js)):
            with self.subTest(case=index, encoding=encoding):
                job = pipeline.process_docx_bytes(data, ZawgyiDetector(), source_encoding=encoding)
                if index in (2, 3, 4):
                    # Observed JS runtime failure: these functions are referenced
                    # but not bound in source.js. Python keeps these conversions
                    # operational; do not claim them as parity.
                    self.assertEqual(expected['error'], 'orderUnicode is not defined' if index == 3
                                     else 'orderZawgyi is not defined')
                    self.assertTrue(job['reports'][0]['base'])
                    continue
                self.assertNotIn('error', expected)
                self.assertEqual(job['counts'], expected['counts'])
                self.assertEqual([{key: rep[key] for key in ('category', 'prob', 'base', 'clean')} for rep in job['reports']],
                                 [{key: rep[key] for key in ('category', 'prob', 'base', 'clean')} for rep in expected['reports']])
                self.assertEqual([page['marked'] for page in pipeline.build_final_pages(job)], expected['pages'])
        with patch.object(ocr, 'available', return_value=True), \
             patch.object(ocr, 'ocr_image', return_value=' ေက  OCR & < > \n'):
            job = manager.prepare_job(docx_image(), 'test.docx', kind='docx')
        self.assertEqual([page['marked'] for page in pipeline.build_final_pages(job)], js[-1]['pages'])
        self.assertEqual(job['reports'][0]['base'], js[-1]['reports'][0]['base'])
        self.assertEqual(job['reports'][0]['clean'], js[-1]['reports'][0]['clean'])


if __name__ == '__main__':
    unittest.main()
