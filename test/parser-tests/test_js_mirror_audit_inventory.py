"""Keep the file-by-file audit tied to the pinned reference and Python tree."""
import re
from pathlib import Path
import subprocess
import unittest

from test_gsub_js_parity import REFERENCE, ROOT


class MirrorAuditInventoryTest(unittest.TestCase):
    def test_all_reference_js_and_python_files_are_accounted_for(self):
        result = subprocess.run(['git', 'ls-tree', '-r', '--name-only', REFERENCE,
                                 'B.Parser/architecture'], cwd=ROOT, text=True, capture_output=True)
        if result.returncode:
            self.skipTest('Pinned JS reference unavailable')
        reference = {name.removeprefix('B.Parser/architecture/') for name in result.stdout.splitlines()
                     if name.endswith('.js')}
        text = (ROOT / 'B.Parser/JS-MIRROR-AUDIT.md').read_text()
        js_rows = set(re.findall(r'^\| `(@[^`]+\.js)`', text, re.MULTILINE))
        self.assertEqual(js_rows, reference)
        python_section = text.split('### Python file index', 1)[1]
        python_rows = set(re.findall(r'^\| `([^`]+\.py)`', python_section, re.MULTILINE))
        architecture = ROOT / 'B.Parser/architecture'
        python_files = {str(path.relative_to(architecture)) for path in architecture.rglob('*.py')}
        self.assertEqual(python_rows, python_files)


if __name__ == '__main__':
    unittest.main()
