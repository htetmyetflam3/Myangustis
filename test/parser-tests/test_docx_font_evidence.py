"""DOCX uses only direct Myanmar-run font declarations as encoding evidence."""
from io import BytesIO
import unittest
from unittest.mock import patch
from zipfile import ZipFile

from myangustis_parser.extract.docx_extract import _paragraphs_from_xml
from myangustis_parser.normalize.detector import ZawgyiDetector
from myangustis_parser.workflow import pipeline


def document(run_properties):
    xml = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
           '<w:body><w:p><w:r><w:rPr>' + run_properties + '</w:rPr>'
           '<w:t>ေကာင္းကင္</w:t></w:r></w:p></w:body></w:document>')
    buf = BytesIO()
    with ZipFile(buf, 'w') as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('word/document.xml', xml)
    return buf.getvalue()


class DocxFontEvidenceTests(unittest.TestCase):
    def test_zawgyi_face_routes_to_rabbit_before_clean(self):
        def finish(text, **options):
            self.assertEqual(options['source_encoding'], 'zawgyi-one')
            return {'base': 'converted', 'clean': 'converted', 'decision': 'rabbit', 'scan': {}}
        data = document('<w:rFonts w:ascii="Zawgyi-One" w:hAnsi="Zawgyi-One"/>')
        with patch.object(pipeline.finish, 'finish_text', side_effect=finish):
            job = pipeline.process_docx_bytes(data, ZawgyiDetector())
        self.assertEqual(job['counts']['ZAWGYI'], 1)
        self.assertEqual(job['pages'][0]['text'], 'converted')

    def test_unknown_or_theme_font_does_not_claim_zawgyi(self):
        for props in ('', '<w:rFonts w:ascii="Zawgyi-One" w:asciiTheme="majorAscii"/>',
                      '<w:rFonts w:ascii="Zawgyi-One" w:hAnsi="Other"/>'):
            with self.subTest(props=props):
                with patch.object(pipeline.finish, 'finish_text', return_value={
                    'base': 'raw', 'clean': 'raw', 'decision': 'aligned', 'scan': {}}) as finish:
                    job = pipeline.process_docx_bytes(document(props), ZawgyiDetector())
                self.assertEqual(job['counts']['UNKNOWN'], 1)
                finish.assert_not_called()
                self.assertEqual(job['reports'][0]['base'], 'ေကာင္းကင္')
                self.assertIsNone(job['reports'][0]['clean'])

    def test_ascii_only_run_does_not_supply_myanmar_font_evidence(self):
        xml = ('<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
               '<w:r><w:rPr><w:rFonts w:ascii="Other"/></w:rPr><w:t>abc</w:t></w:r>'
               '<w:r><w:rPr><w:rFonts w:ascii="Zawgyi-One"/></w:rPr><w:t>က</w:t></w:r></w:p>')
        fonts = []
        _paragraphs_from_xml(xml, font_names_by_paragraph=fonts)
        self.assertEqual(fonts, [{'Zawgyi-One'}])


if __name__ == '__main__':
    unittest.main()
