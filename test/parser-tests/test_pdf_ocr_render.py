"""PDF OCR renders full pages and crops in PDF coordinates, before OCR."""
import base64
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from PIL import Image, ImageChops
import pypdfium2
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject, NumberObject

from myangustis_parser.workflow import ocr
from test_gsub_js_parity import REFERENCE, ROOT


def make_pdf(rotation=0, unit=1, *, image=False):
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=300)
    page[NameObject('/MediaBox')] = ArrayObject([FloatObject(x) for x in (10, 20, 210, 320)])
    page[NameObject('/CropBox')] = ArrayObject([FloatObject(x) for x in (20, 30, 190, 290)])
    page[NameObject('/Rotate')] = NumberObject(rotation)
    page[NameObject('/UserUnit')] = NumberObject(unit)
    stream = DecodedStreamObject()
    content = b'1 0 0 rg 25 40 35 50 re f'
    if image:
        img = DecodedStreamObject()
        img.set_data(b'\x00\x00\xff')
        img.update({NameObject('/Type'): NameObject('/XObject'), NameObject('/Subtype'): NameObject('/Image'),
                    NameObject('/Width'): NumberObject(1), NameObject('/Height'): NumberObject(1),
                    NameObject('/BitsPerComponent'): NumberObject(8), NameObject('/ColorSpace'): NameObject('/DeviceRGB')})
        resources = DictionaryObject({NameObject('/XObject'): DictionaryObject({NameObject('/Im'): writer._add_object(img)})})
        page[NameObject('/Resources')] = resources
        content += b' q 30 0 0 30 100 100 cm /Im Do Q'
    stream.set_data(content)
    page[NameObject('/Contents')] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def picture(data):
    return Image.open(io.BytesIO(data)).convert('RGB')


class PdfOcrRenderTests(unittest.TestCase):
    def test_page_ocr_receives_composited_page_not_embedded_image(self):
        pdf = make_pdf(image=True)
        with patch.object(ocr, 'ocr_image', return_value='recognized') as recognize, \
             patch.object(ocr.pdf_extract, 'page_image_bytes', side_effect=AssertionError('must not extract image')):
            self.assertEqual(ocr.ocr_pdf_page(pdf, 1), 'recognized')
        self.assertEqual(recognize.call_args.kwargs['suffix'], '.png')
        image = picture(recognize.call_args.args[0])
        self.assertEqual(image.size, (510, 780))
        # PDF origin is bottom-left: red vector content and a blue image are
        # both present, with white page background around them.
        self.assertEqual(image.getpixel((30, 705)), (255, 0, 0))
        self.assertEqual(image.getpixel((285, 525)), (0, 0, 255))
        self.assertEqual(image.getpixel((0, 0)), (255, 255, 255))

    def test_cropbox_rotation_userunit_and_fractional_region(self):
        expected = {(0, 1): ((510, 780), (169, 197)), (90, 1): ((780, 510), (197, 169)),
                    (180, 1): ((510, 780), (169, 197)), (270, 1): ((780, 510), (197, 169)),
                    (0, 2): ((1020, 1560), (336, 393)), (90, 2): ((1560, 1020), (393, 336)),
                    (180, 2): ((1020, 1560), (336, 393)), (270, 2): ((1560, 1020), (393, 336))}
        for (rotation, unit), (size, crop) in expected.items():
            with self.subTest(rotation=rotation, unit=unit):
                pdf = make_pdf(rotation, unit)
                _, actual_size = ocr._render_pdf_png(pdf, 1)
                raw, actual_crop = ocr._render_pdf_png(pdf, 1, bbox=[24.2, 40.4, 80.1, 105.8])
                self.assertEqual((actual_size, actual_crop), (size, crop))
                # Crop contains both the drawn rectangle and the background.
                colors = {color for _, color in picture(raw).getcolors(maxcolors=256)}
                self.assertIn((255, 0, 0), colors)
                self.assertIn((255, 255, 255), colors)

    def test_cap_is_checked_before_render_even_for_small_region(self):
        with patch.object(ocr, 'max_pixels', return_value=100), \
             patch.object(pypdfium2.PdfPage, 'render', side_effect=AssertionError('allocated bitmap')):
            with self.assertRaisesRegex(ocr.OcrError, 'pixel cap'):
                ocr._render_pdf_png(make_pdf(), 1, bbox=[25, 40, 26, 41])

    def test_invalid_page_scale_and_regions(self):
        pdf = make_pdf()
        for scale in (0, -1, 4.1, float('nan'), True):
            with self.subTest(scale=scale), self.assertRaisesRegex(ocr.OcrError, 'scale'):
                ocr._render_pdf_png(pdf, 1, scale=scale)
        with self.assertRaisesRegex(ocr.OcrError, 'past the last page'):
            ocr._render_pdf_png(pdf, 2)
        for box in ([0, 0, float('nan'), 2], [1, 2, 3]):
            with self.subTest(box=box), self.assertRaisesRegex(ocr.OcrError, 'four-number'):
                ocr._render_pdf_png(pdf, 1, bbox=box)
        with self.assertRaisesRegex(ocr.OcrError, 'outside'):
            ocr._render_pdf_png(pdf, 1, bbox=[500, 500, 550, 550])
        # Reversed coordinates still select the rectangle, matching JS.
        _, size = ocr._render_pdf_png(pdf, 1, bbox=[80.1, 105.8, 24.2, 40.4])
        self.assertEqual(size, (169, 197))

    def test_region_ocr_uses_pdf_coordinates_and_dpi_compatibility(self):
        with patch.object(ocr, 'ocr_image', return_value='region') as recognize:
            self.assertEqual(ocr.ocr_pdf_region(make_pdf(), 1, [25, 40, 60, 90], dpi=144), 'region')
        self.assertEqual(picture(recognize.call_args.args[0]).size, (70, 100))


class PdfRenderJsParityTests(unittest.TestCase):
    def test_pdfjs_canvas_geometry_and_solid_fill(self):
        """Optional oracle: set JS_RENDER_NODE_MODULES to the pinned JS dependencies.

        Install pdfjs-dist@6.4.299 and @napi-rs/canvas@1.0.10 in an external
        directory; runtime PDF OCR never invokes Node.
        """
        modules = os.environ.get('JS_RENDER_NODE_MODULES')
        if not modules or not Path(modules).is_dir() or not shutil.which('node'):
            self.skipTest('JS_RENDER_NODE_MODULES and Node required for PDF.js render oracle')
        source = subprocess.run(['git', 'show', f'{REFERENCE}:B.Parser/architecture/@core/runtime/render.js'],
                                cwd=ROOT, capture_output=True)
        if source.returncode:
            self.skipTest('Pinned JS reference unavailable')
        cases = [(make_pdf(rot, unit), [24.2, 40.4, 80.1, 105.8])
                 for rot in (0, 90, 180, 270) for unit in (1, 2)]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)
            (path / 'package.json').write_text('{"type":"module"}')
            (path / 'node_modules').symlink_to(Path(modules).resolve(), target_is_directory=True)
            (path / 'render.js').write_bytes(source.stdout)
            (path / 'check.mjs').write_text('''
import fs from 'node:fs';
import {renderPdfPagePng,renderPdfRegionPng} from './render.js';
const inputs=JSON.parse(fs.readFileSync(0,'utf8'));
const out=[];
for(const c of inputs) {
 const pdf=Buffer.from(c.pdf,'base64');
 const page=await renderPdfPagePng(pdf,1,{scale:3,maxPixels:25000000});
 const crop=await renderPdfRegionPng(pdf,1,c.bbox,{scale:3,maxPixels:25000000});
 out.push({size:[page.width,page.height], crop:[crop.width,crop.height], png:crop.png.toString('base64')});
}
console.log(JSON.stringify(out));
''')
            payload = [{'pdf': base64.b64encode(pdf).decode(), 'bbox': box} for pdf, box in cases]
            raw = subprocess.run(['node', str(path / 'check.mjs')], input=json.dumps(payload).encode(),
                                 capture_output=True, check=True, timeout=60).stdout
        for (pdf, box), expected in zip(cases, json.loads(raw)):
            _, size = ocr._render_pdf_png(pdf, 1)
            crop, crop_size = ocr._render_pdf_png(pdf, 1, bbox=box)
            self.assertEqual(list(size), expected['size'])
            self.assertEqual(list(crop_size), expected['crop'])
            self.assertIsNone(ImageChops.difference(picture(crop), picture(base64.b64decode(expected['png']))).getbbox())


if __name__ == '__main__':
    unittest.main()
