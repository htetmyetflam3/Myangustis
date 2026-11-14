"""Placed-image geometry and page-record propagation, without Node or OCR."""
import unittest

from pdfbuild import build_pdf
from myangustis_parser.workflow.pipeline import process_pdf_bytes, build_final_pages


def make_pdf(content):
    return build_pdf({
        1: b'<< /Type /Catalog /Pages 2 0 R >>',
        2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 /MediaBox [10 20 110 220] /Resources << /XObject << /Im 5 0 R /Mask 6 0 R /Form 7 0 R /Loop 8 0 R >> >> >>',
        3: b'<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>',
        4: (b'<< >>', content),
        5: (b'<< /Subtype /Image /Width 1 /Height 1 >>', b'x'),
        6: (b'<< /Subtype /Image /ImageMask true /Width 1 /Height 1 >>', b'x'),
        7: (b'<< /Subtype /Form /BBox [0 0 1 1] /Resources << /XObject << /Local 5 0 R >> >> >>', b'/Local Do'),
        8: (b'<< /Subtype /Form /BBox [0 0 1 1] >>', b'/Loop Do /Im Do'),
    })


class ImageCoverageTests(unittest.TestCase):
    def records(self, content):
        result = process_pdf_bytes(make_pdf(content), None)
        self.assertEqual(result['pages'][0]['images'], build_final_pages(result)[0]['images'])
        return result['pages'][0]

    def test_inherited_resources_and_transformed_images(self):
        page = self.records(b'q 100 0 0 200 10 20 cm /Im Do Q '
                            b'q 0 200 -100 0 110 20 cm /Im Do Q')
        self.assertTrue(page['has_img'])
        self.assertEqual(page['images'], [
            {'name': 'Im', 'bbox': [10, 20, 110, 220], 'coverage': 1.0, 'pageSized': True},
            {'name': 'Im', 'bbox': [10, 20, 110, 220], 'coverage': 1.0, 'pageSized': True},
        ])

    def test_clips_masks_inline_and_unseen_images(self):
        page = self.records(b'q 10 20 50 200 re W n 100 0 0 200 10 20 cm /Im Do Q '
                            b'q 10 20 m 110 20 l W n 100 0 0 200 10 20 cm /Im Do Q '
                            b'q 100 0 0 200 10 20 cm /Mask Do Q '
                            b'q 100 0 0 200 10 20 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q '
                            b'q 100 0 0 200 500 500 cm /Im Do Q')
        images = page['images']
        self.assertEqual([image['name'] for image in images], ['Im', 'Im', 'Mask', 'inline'])
        self.assertEqual([image['coverage'] for image in images], [0.5, 1, 1, 1])
        self.assertEqual([image['pageSized'] for image in images], [False, False, False, True])

    def test_forms_have_local_resources_and_guard_recursion(self):
        page = self.records(b'q 100 0 0 200 10 20 cm /Form Do /Loop Do Q')
        self.assertEqual([image['name'] for image in page['images']], ['Local', 'Im'])
        self.assertTrue(all(image['pageSized'] for image in page['images']))

    def test_inline_without_resource_image_sets_has_img(self):
        pdf = build_pdf({
            1: b'<< /Type /Catalog /Pages 2 0 R >>',
            2: b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            3: b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] /Contents 4 0 R >>',
            4: (b'<< >>', b'q 10 0 0 10 0 0 cm BI /W 1 /H 1 /BPC 8 /CS /G ID x EI Q'),
        })
        page = process_pdf_bytes(pdf, None)['pages'][0]
        self.assertTrue(page['has_img'])
        self.assertEqual(page['images'][0]['name'], 'inline')


if __name__ == '__main__':
    unittest.main()
