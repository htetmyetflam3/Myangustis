"""The source tree is flat while the installed import name stays stable."""
import unittest
from pathlib import Path

import myangustis_parser
from myangustis_parser.resources import maps, paths
from myangustis_parser.workflow import ocr


ROOT = Path(__file__).resolve().parents[2]
PARSER = ROOT / 'B.Parser'
ARCHITECTURE = PARSER / 'architecture'


class PackageLayoutTests(unittest.TestCase):
    def test_source_modules_are_directly_in_architecture(self):
        self.assertFalse((ARCHITECTURE / 'myangustis_parser').exists())
        for name in ('entry', 'extract', 'normalize', 'output', 'resources', 'workflow'):
            self.assertTrue((ARCHITECTURE / name / '__init__.py').is_file(), name)

    def test_editable_package_roots_and_maps(self):
        # Editable installs resolve to the source tree; wheel installs still
        # resolve the same package name and bundled maps under site-packages.
        if Path(myangustis_parser.__file__).resolve() == ARCHITECTURE / '__init__.py':
            self.assertEqual(paths.PARSER_ROOT, PARSER)
            self.assertEqual(paths.REPO_ROOT, ROOT)
            self.assertEqual(ocr.PARSER_ROOT, PARSER)
        for name in ('burmese-inventory.json', 'cipher-map.json', 'legacy-font-names.json',
                     'mm-score.json', 'scan.json', 'zawcode-draft-glyphs.json'):
            self.assertTrue(maps.map_path(name).is_file(), name)


if __name__ == '__main__':
    unittest.main()
