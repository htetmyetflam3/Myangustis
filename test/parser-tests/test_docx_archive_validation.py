"""DOCX package safety checks apply to every member, not just text parts."""
import io
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile, ZIP_DEFLATED, ZIP_STORED, ZIP_BZIP2

from myangustis_parser.extract.docx_extract import extract_docx_paragraphs


class DocxArchiveValidationTest(unittest.TestCase):
    def check_archive(self, entries, compression=ZIP_STORED):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'book.docx'
            with ZipFile(path, 'w', compression=compression) as z:
                for name, data in entries:
                    z.writestr(name, data)
            return extract_docx_paragraphs(path)

    def test_required_members(self):
        with self.assertRaisesRegex(ValueError, 'not a valid DOCX'):
            self.check_archive([('word/document.xml', '<document/>')])

    def test_unused_unsafe_member_is_rejected(self):
        safe = [('[Content_Types].xml', '<Types/>'), ('word/document.xml', '<document/>')]
        for name in ('../outside', '/absolute', 'word/../outside', 'word\\bad'):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'unsafe member'):
                self.check_archive(safe + [(name, b'x')])

    def test_unused_compression_bomb_is_rejected(self):
        safe = [('[Content_Types].xml', '<Types/>'), ('word/document.xml', '<document/>')]
        with self.assertRaisesRegex(ValueError, 'compression-ratio'):
            self.check_archive(safe + [('unused.bin', b'0' * 1_000_000)], ZIP_DEFLATED)

    def test_percent_encoded_image_and_strict_relationship_namespace(self):
        document = ('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
                    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
                    'xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships">'
                    '<w:body><w:p><w:r><a:blip r:embed="r1"/></w:r></w:p></w:body></w:document>')
        rels = ('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="r1" Type="http://x/image" Target="media/a%20b.png"/>'
                '</Relationships>')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'book.docx'
            with ZipFile(path, 'w') as z:
                z.writestr('[Content_Types].xml', '<Types/>')
                z.writestr('word/document.xml', document)
                z.writestr('word/_rels/document.xml.rels', rels)
                z.writestr('word/media/a b.png', b'image bytes')
            files = []
            paragraphs = extract_docx_paragraphs(path, image_dir=directory, image_files=files)
            self.assertEqual(len(files), 1)
            self.assertEqual(Path(files[0]['path']).read_bytes(), b'image bytes')
            self.assertEqual(paragraphs, [files[0]['marker']])

    def test_unsupported_compression_is_rejected_even_if_not_read(self):
        safe = [('[Content_Types].xml', '<Types/>'), ('word/document.xml', '<document/>')]
        with self.assertRaisesRegex(ValueError, 'unsupported compression'):
            self.check_archive(safe + [('unused.bin', b'ignored')], ZIP_BZIP2)


if __name__ == '__main__':
    unittest.main()
