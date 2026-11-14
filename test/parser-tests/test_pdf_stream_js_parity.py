"""End-to-end PDF text comparisons to the pinned instruction-led JS parser."""
import base64
import contextlib
import io
import json
import os
from pathlib import Path
import random
import shutil
import subprocess
import tarfile
import tempfile
import unittest

from myangustis_parser.resources.engine import read_master_json
from myangustis_parser.workflow.pipeline import process_pdf_bytes
from myangustis_parser.extract.pdf_extract import parse_pdf_objects, extract_page_lines
from myangustis_parser.extract.pdf_fonts import DocumentDecoding, FontDecoder, WININNWA_LEGACY_CODE_PAGE
from pdfbuild import simple_page_pdf, build_pdf
from test_gsub_js_parity import REFERENCE, ROOT
from test_pdf_page_routing import cid_font, tounicode
from test_visual_unicode import FONT, fixture, tharlon_mapping, pdf_for, raw


class PdfStreamJsParityTests(unittest.TestCase):
    def test_synthetic_pdf_pipeline_matches_js(self):
        if not shutil.which('node') or not shutil.which('git'):
            self.skipTest('Node and git required')
        if int(subprocess.check_output(['node', '-p', 'process.versions.node.split(".")[0]'])) < 22:
            self.skipTest('JS reference requires Node 22+')
        archive = subprocess.run(['git', 'archive', REFERENCE, 'B.Parser/architecture'],
                                 cwd=ROOT, capture_output=True)
        if archive.returncode:
            self.skipTest('Pinned JS reference commit unavailable')
        rng = random.Random(2)
        cases = []
        for i in range(100):
            face = rng.choice(['WinInnwa', 'Ayar', 'SomeFont', 'Zawgyi-One'])
            fonts = {10: f'<< /Type /Font /Subtype /TrueType /BaseFont /{face} >>'.encode()}
            content = b' '.join(b'BT /F 12 Tf 1 0 0 1 %d %d Tm <%s> Tj ET' %
                (rng.randrange(10, 200), rng.choice([700, 700, 700, 680]),
                 bytes(rng.choices(b'aukrAu ', k=rng.randrange(1, 8))).hex().encode())
                for _ in range(rng.randrange(1, 5)))
            pdf = simple_page_pdf({'F': 10}, content, fonts=fonts, compress=False)
            cases.append((pdf, rng.choice(['unicode', 'auto', 'zawgyi-one'])))
        simple = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'}
        for content in (
            b'BT /F 12 Tf 1 0 0 1 10 700 Tm (first) Tj 1 0 0 1 10 680 Tm (second) Tj ET',
            b'BT /F 12 Tf 1 0 0 1 10 700 Tm 14 TL (first) Tj T* (second) Tj ET',
            b'BT /F 12 Tf 1 0 0 1 10 700 Tm 14 TL (first) Tj (second) \' ET',
            b'q 1 0 0 1 100 0 cm BT /F 12 Tf 1 0 0 1 10 700 Tm (shifted) Tj ET Q BT /F 12 Tf 1 0 0 1 30 700 Tm (normal) Tj ET',
            b'BT /F 14 Tf 1 0 0 1 10 700 Tm (first) Tj ET BT (second) Tj ET',
            b'BT /F 12 Tf 1 0 0 1 10 700 Tm (first) Tj 1 0 0 1 10 698 Tm (mark) Tj ET',
        ):
            cases.append((simple_page_pdf({'F':10}, content, fonts=simple, compress=False), 'auto'))
        # Landscape two-page spreads are column-major only with strong
        # overlapping text evidence; painted table rules suppress the split.
        for is_grid in (False, True):
            blocks = []
            for row in range(6):
                for side, x in (('Left', 120), ('Right', 720)):
                    blocks.append(f'BT /F 12 Tf 1 0 0 1 {x} {500-row*30} Tm ({side} page line number {row:02} content) Tj ET'.encode())
            if is_grid:
                blocks.insert(0, b'120 100 m 120 550 l 400 100 m 400 550 l 700 100 m 700 550 l 1000 100 m 1000 550 l S')
            cases.append((simple_page_pdf({'F':10}, b' '.join(blocks), fonts=simple,
                          mediabox=b'[100 0 1300 600]', compress=False), 'auto'))
        # Nested /Contents arrays and even mid-token stream boundaries are
        # one logical page stream, not independently parsed text blocks.
        for contents in (b'[4 0 R 5 0 R]', b'6 0 R'):
            objects = {1: b'<< /Type /Catalog /Pages 2 0 R >>',
                       2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                       3: b'<< /Type /Page /Parent 2 0 R /Resources << /Font << /F 10 0 R >> >> /Contents ' + contents + b' >>',
                       4: (b'<< >>', b'BT /F 12 Tf 1 0 0 1 10 700 Tm (hel'),
                       5: (b'<< >>', b'lo) Tj ET'), 6: b'[4 0 R [5 0 R]]', **simple}
            cases.append((build_pdf(objects), 'auto'))
        base = simple_page_pdf({'F':10}, b'BT /F 12 Tf 1 0 0 1 10 700 Tm (generations) Tj ET', fonts=simple)
        nonzero = (base.replace(b'/Pages 2 0 R', b'/Pages 2 1 R')
                   .replace(b'2 0 obj', b'2 1 obj').replace(b'3 0 R', b'3 2 R')
                   .replace(b'3 0 obj', b'3 2 obj').replace(b'4 0 R', b'4 3 R')
                   .replace(b'4 0 obj', b'4 3 obj'))
        cases.append((nonzero, 'auto'))
        repeated = base.replace(b'/Kids [3 0 R] /Count 1', b'/Kids [3 0 R 3 0 R] /Count 2')
        cases.append((repeated, 'auto'))
        mixed_fonts = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa >>',
                       20: b'<< /Type /Font /Subtype /TrueType /BaseFont /UnknownFont >>'}
        cases.append((simple_page_pdf({'A':10, 'B':20},
            b'BT /A 12 Tf 1 0 0 1 10 700 Tm (u) Tj ET BT /B 12 Tf 1 0 0 1 10 680 Tm (u) Tj ET', fonts=mixed_fonts), 'auto'))
        unresolved = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WWinPonnya >>'}
        cases.append((simple_page_pdf({'F':10}, b'BT /F 12 Tf 1 0 0 1 10 700 Tm (abc) Tj ET', fonts=unresolved), 'unicode'))
        fonts = cid_font(10, {0x1000: 5})
        fonts.update(cid_font(20, {0x1015: 5}))
        fonts.update(cid_font(30, {0x1019: 6}))
        content = (b'BT /A 12 Tf 1 0 0 1 10 700 Tm <0005> Tj ET\n'
                   b'BT /B 12 Tf 1 0 0 1 10 680 Tm <0005> Tj ET\n'
                   b'BT /C 12 Tf 1 0 0 1 10 660 Tm <0005> Tj ET')
        cases.append((simple_page_pdf({'A':10, 'B':20, 'C':30}, content, fonts=fonts, compress=False), 'auto'))
        fonts = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa /ToUnicode 11 0 R >>',
                 11: (b'<< >>', tounicode([(b'01', b'0075')])),
                 20: b'<< /Type /Font /Subtype /TrueType /BaseFont /Padauk /ToUnicode 21 0 R >>',
                 21: (b'<< >>', tounicode([(b'01', b'1001102C'), (b'02', b'1002102C'), (b'03', b'1003102C'), (b'04', b'1004102C')]))}
        content = (b'BT /A 12 Tf 1 0 0 1 10 700 Tm <01> Tj ET\n'
                   b'BT /B 12 Tf 1 0 0 1 10 680 Tm <01> Tj ET')
        cases.append((simple_page_pdf({'A':10, 'B':20}, content, fonts=fonts, compress=False), 'auto'))
        if FONT.exists():
            program, gid, _ = fixture()
            cases.append((pdf_for(program, tharlon_mapping(gid), [raw(499), raw(gid('ပ')),
                         raw(gid('အ'), gid('ဂ'), 377, 498)], compress=False), 'auto'))
        # Placed images: inherited page resources/MediaBox, masks, rotations,
        # clipping, inline images, nested and self-referential forms.
        image_ops = (
            b'q 100 0 0 200 10 20 cm /Im Do Q',
            b'q 94 0 0 200 10 20 cm /Im Do Q',
            b'q 0 200 -100 0 110 20 cm /Im Do Q',
            b'q 100 30 0 200 10 20 cm /Im Do Q',
            b'q 10 20 50 200 re W n 100 0 0 200 10 20 cm /Im Do Q',
            b'q 10 20 m 110 20 l W n 100 0 0 200 10 20 cm /Im Do Q',
            b'q 100 0 0 200 10 20 cm /Mask Do Q',
            b'q 100 0 0 200 10 20 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q',
            b'q 100 0 0 200 10 20 cm /Form Do Q',
            b'q 100 0 0 200 10 20 cm /Loop Do Q',
            b'q 100 0 0 200 500 500 cm /Im Do Q',
            b'q 50 0 0 100 10 20 cm /Im Do Q q 100 0 0 200 10 20 cm /Im Do Q',
        )
        image_start = len(cases)
        for content in image_ops:
            objects = {
                1: b'<< /Type /Catalog /Pages 2 0 R >>',
                2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [10 20 110 220] /Resources << /XObject << /Im 5 0 R /Mask 6 0 R /Form 7 0 R /Loop 8 0 R >> >> >>',
                3: b'<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
                4: (b'<< >>', content),
                5: (b'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>', b'x'),
                6: (b'<< /Type /XObject /Subtype /Image /ImageMask true /Width 1 /Height 1 >>', b'x'),
                7: (b'<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] /Matrix [1 0 0 1 0 0] >>', b'/Im Do'),
                8: (b'<< /Type /XObject /Subtype /Form /BBox [0 0 1 1] >>', b'/Loop Do /Im Do'),
            }
            cases.append((build_pdf(objects), 'auto'))
        # Inline images must enable OCR even when the page has no image resource.
        objects = {
            1: b'<< /Type /Catalog /Pages 2 0 R >>',
            2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            3: b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>',
            4: (b'<< >>', b'q 10 0 0 10 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q'),
        }
        cases.append((build_pdf(objects), 'auto'))
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
            for name, content in [('A.Engine/architecture/init/bridge.js', 'export function BindEngine() { throw Error("POS not used"); }'),
                                  ('A.Engine/public/advisory.js', 'export function agentAdvisory() {}'),
                                  ('node_modules/fflate/package.json', '{"type":"module","exports":"./index.js"}'),
                                  ('node_modules/fflate/index.js', 'export class Unzlib { constructor() { throw Error("compressed input not covered by this fixture"); } }')]:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            check = root / 'check.mjs'
            check.write_text('''
import fs from 'node:fs';
import {streamPdfPages} from './B.Parser/architecture/@core/runtime/source.js';
import {convertFinalizedPageText} from './B.Parser/architecture/@core/runtime/finalized-cmap.js';
const cases=JSON.parse(fs.readFileSync(0,'utf8'));
const outputs=cases.map(c => {
 const [,,pages]=streamPdfPages(Buffer.from(c.pdf,'base64'),()=>{},{sourceEncoding:c.encoding});
 return [...pages].map(page => ({decision:page.decision, category:page.category,
  base:convertFinalizedPageText(page.text,page,false), clean:convertFinalizedPageText(page.text,page,true),
  warnings:page.warnings || [], images:page.images || [], hasImg:page.hasImg, lines:page.lines.map(([x,y,size,text]) => [x,y,size,convertFinalizedPageText(text,page,false)])}));
});
console.log(JSON.stringify(outputs));
''')
            payload = [{'pdf': base64.b64encode(pdf).decode(), 'encoding': enc} for pdf, enc in cases]
            result = subprocess.run(['node', str(check)], input=json.dumps(payload).encode(),
                capture_output=True, check=True, timeout=60,
                env=dict(os.environ, PARITY_MASTER=str(master)))
            expected = json.loads(result.stdout)
            image_expected = [pages[0]['images'] for pages in expected[image_start:]]
            self.assertEqual([len(images) for images in image_expected],
                             [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 2, 1])
            self.assertEqual([images[0]['pageSized'] for images in image_expected[:10]],
                             [True, False, True, False, False, False, False, True, True, True])
            self.assertEqual(image_expected[0][0]['bbox'], [10, 20, 110, 220])
            self.assertEqual(image_expected[4][0]['coverage'], 0.5)
            self.assertTrue(expected[-1][0]['hasImg'])
            # The current JS legacy page store emits the unconfirmed reading
            # even though the decoder exposes confirmed alternatives. Test
            # that actual runtime behavior, including split shown strings.
            confirmed = root / 'confirmed.mjs'
            confirmed.write_text('''
import fs from 'node:fs';
import {openPdfScannedObjects} from './B.Parser/architecture/@core/runtime/objects.js';
import {extractPageLines} from './B.Parser/architecture/@core/pdf/method/pdfencoding/decoding.js';
import {DocumentDecoding, FontDecoder} from './B.Parser/architecture/@core/pdf/method/decoder.js';
import {WININNWA_LEGACY_CODE_PAGE} from './B.Parser/architecture/@core/pdf/method/legacy/codepage-registry.js';
const pdfs=JSON.parse(fs.readFileSync(0,'utf8'));
console.log(JSON.stringify(pdfs.map(pdf=>{
 const store=openPdfScannedObjects(Buffer.from(pdf,'base64'));
 try {
  const doc=new DocumentDecoding('legacy',new Map(),WININNWA_LEGACY_CODE_PAGE);
  const font=new FontDecoder('F',{doc,baseFont:'WinInnwa',fontLegacyCodePage:WININNWA_LEGACY_CODE_PAGE,
   confirmedRawRuns:{bytes:new Map([[35,'က']]),runs:[{bytes:[35,47],text:'က္က'}],unresolved:new Set()}});
  doc._decoders.set('10,0',font);
  const [lines]=extractPageLines(store.objects,3,0,doc);
  return {direct:font.decode('#/'), lines:lines.map(line=>line.slice(0,4))};
 } finally {store.close();}
})));''')
            raw_fonts = {10: b'<< /Type /Font /Subtype /TrueType /BaseFont /WinInnwa >>'}
            raw_pdfs = [simple_page_pdf({'F': 10}, content, fonts=raw_fonts) for content in (
                b'BT /F 12 Tf 1 0 0 1 10 700 Tm (#/) Tj ET',
                b'BT /F 12 Tf 1 0 0 1 10 700 Tm (#) Tj (/) Tj ET')]
            result = subprocess.run(['node', str(confirmed)],
                input=json.dumps([base64.b64encode(pdf).decode() for pdf in raw_pdfs]).encode(),
                capture_output=True, check=True, timeout=30,
                env=dict(os.environ, PARITY_MASTER=str(master)))
            raw_expected = json.loads(result.stdout)
        for pdf, js in zip(raw_pdfs, raw_expected):
            doc = DocumentDecoding('legacy', legacy_code_page=WININNWA_LEGACY_CODE_PAGE)
            doc.legacy_text_fix = False
            profile = {'bytes': {35:'က'}, 'runs':[{'bytes': b'#/','text':'က္က'}], 'unresolved':set()}
            decoder = FontDecoder('F', doc=doc, base_font='WinInnwa',
                                  font_legacy_code_page=WININNWA_LEGACY_CODE_PAGE,
                                  confirmed_raw_runs=profile, selected_legacy=True)
            doc._decoders[(10,0)] = decoder
            lines, _, _ = extract_page_lines(parse_pdf_objects(pdf), 3, 0, doc)
            self.assertEqual(decoder.decode(b'#/'), js['direct'])
            self.assertEqual([list(line[:4]) for line in lines], js['lines'])
        for index, ((pdf, encoding), js_pages) in enumerate(zip(cases, expected)):
            with contextlib.redirect_stderr(io.StringIO()):
                result = process_pdf_bytes(pdf, None, source_encoding=encoding)
            py_pages = result['reports']
            self.assertEqual(len(py_pages), len(js_pages), index)
            for py, layout, js in zip(py_pages, result['pages'], js_pages):
                self.assertEqual({key: py[key] for key in ('decision', 'category', 'base', 'clean')},
                                 {key: js[key] for key in ('decision', 'category', 'base', 'clean')}, (index, encoding))
                self.assertEqual([list(line[:4]) for line in layout['lines']], js['lines'], (index, encoding))
                self.assertEqual(py.get('warnings', []), js['warnings'], (index, encoding))
                self.assertEqual(layout.get('images', []), js['images'], (index, encoding))
                self.assertEqual(layout['has_img'], js['hasImg'], (index, encoding))


if __name__ == '__main__': unittest.main()
