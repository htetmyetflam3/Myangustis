"""Keep the file-by-file audit tied to the pinned reference and Python tree."""
import re
from pathlib import Path
import subprocess
import unittest

from test_gsub_js_parity import REFERENCE, ROOT

#: The audit moved out of ``JS-MIRROR-AUDIT.md`` when the JS mirror findings and
#: the legacy-bridge notes became one document. One name, in one place, so a
#: future move has to update the checker and the links in the same edit.
AUDIT_DOC = 'B.Parser/AUDIT.md'


class MirrorAuditInventoryTest(unittest.TestCase):
    def test_all_reference_js_and_python_files_are_accounted_for(self):
        result = subprocess.run(['git', 'ls-tree', '-r', '--name-only', REFERENCE,
                                 'B.Parser/architecture'], cwd=ROOT, text=True, capture_output=True)
        if result.returncode:
            self.skipTest('Pinned JS reference unavailable')
        reference = {name.removeprefix('B.Parser/architecture/') for name in result.stdout.splitlines()
                     if name.endswith('.js')}
        text = (ROOT / AUDIT_DOC).read_text()
        js_rows = set(re.findall(r'^\| `(@[^`]+\.js)`', text, re.MULTILINE))
        self.assertEqual(js_rows, reference)
        python_section = text.split('### Python file index', 1)[1]
        python_rows = set(re.findall(r'^\| `([^`]+\.py)`', python_section, re.MULTILINE))
        architecture = ROOT / 'B.Parser/architecture'
        python_files = {str(path.relative_to(architecture)) for path in architecture.rglob('*.py')}
        self.assertEqual(python_rows, python_files)
        # The prose count is the table's length, or the index reads as if a file
        # were missing from the mirror.
        stated = re.search(r'These are the (\d+) Python files under `architecture/`', text)
        self.assertIsNotNone(stated, 'the Python file index lost its count sentence')
        self.assertEqual(int(stated.group(1)), len(python_files))

    def test_the_audit_doc_is_the_only_one_its_links_promise(self):
        """A rename that leaves the test and the links behind fails here, not in review.

        ``AUDIT.md`` was ``JS-MIRROR-AUDIT.md``: the move updated neither this
        checker nor the README link, so the inventory died on a missing file and
        the reader was sent to a document that no longer existed.
        """
        link = re.compile(r'\[[^\]]*\]\(([^)#?\s]+)(?:#[^)]*)?\)')
        docs = [ROOT / AUDIT_DOC, ROOT / 'B.Parser/README.md', ROOT / 'do.MD']
        for doc in docs:
            for target in link.findall(doc.read_text(encoding='utf-8')):
                if target.startswith(('http', 'mailto:', '/')):
                    continue
                self.assertTrue((doc.parent / target).resolve().exists(),
                                f'{doc.relative_to(ROOT)} links to {target}, which is not there')


if __name__ == '__main__':
    unittest.main()
