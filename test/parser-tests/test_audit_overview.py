"""The audit digest and the document have to say the same thing about the evidence.

`B.Parser/audit/` carries the logs and scans a run left behind, and the prose that
summarised them had already drifted: the totals were stale, the log was described
as holding fields it does not hold, every part's run had been appended twice, and
the per-page report the collection cited was never committed. The overview tool
exists so that drift is a checkable thing instead of a memory -- and these tests
keep the checker honest, because a regex that quietly stops matching would let it
report zero of everything and still pass.
"""
import collections
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOL = ROOT / 'B.Parser/tools/audit_overview.py'
AUDIT = ROOT / 'B.Parser/audit'

LOG_LINE = re.compile(r'^\[[\d:.]+\] \[\w+\] \w+ ([\w-]+) (\{.*\})$')
SCAN_HEAD = re.compile(r'^orphan\s+(\d+)\s+\d+', re.MULTILINE)
PAGES = re.compile(r'"pages":\s*"(\d+)-(\d+)"')


def run(*args):
    result = subprocess.run([sys.executable, str(TOOL), *args], cwd=ROOT,
                            text=True, capture_output=True)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def log_events():
    for path in sorted(AUDIT.glob('parts/part-*.log')):
        for line in path.read_text(encoding='utf-8').splitlines():
            match = LOG_LINE.match(line.strip())
            if match:
                yield path.name, match


class AuditOverviewTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.claims = json.loads(run('--json'))

    def test_claims_recompute_from_the_raw_files(self):
        """Derived here without the tool, so the tool cannot pass by reading nothing."""
        orphan = sum(int(n) for path in AUDIT.glob('scans/part-*.scan.txt')
                     for n in SCAN_HEAD.findall(path.read_text(encoding='utf-8')))
        self.assertEqual(self.claims['scan orphan'], orphan)

        # Page numbers restart at 1 in every part, so the union is per file and
        # the totals are summed across the nine.
        by_part = {}
        for name, match in log_events():
            if match.group(1) != 'decision':
                continue
            low, high = PAGES.search(match.group(2)).groups()
            by_part.setdefault(name, set()).update(range(int(low), int(high) + 1))
        self.assertEqual(self.claims['pages covered by the logs'],
                         sum(len(pages) for pages in by_part.values()))
        self.assertEqual(self.claims['log events (all parts)'], len(list(log_events())))

    def test_no_number_is_zero_because_a_pattern_stopped_matching(self):
        self.assertEqual(len(list(AUDIT.glob('parts/part-*.log'))), 9)
        self.assertEqual(len(list(AUDIT.glob('scans/part-*.scan.txt'))), 9)
        self.assertTrue(all(value > 0 for value in self.claims.values()), self.claims)

    def test_the_document_and_the_evidence_are_in_step(self):
        out = run('--check')
        self.assertIn('OK: 0 of', out, out)

    def test_the_digest_stays_a_window(self):
        """The whole point: a reviewer reads this instead of half a megabyte of logs."""
        text = run()
        self.assertLessEqual(len(text.splitlines()), 60, 'the digest outgrew one screen')
        self.assertIn('| part | log lines | distinct | pages |', text)
        self.assertIn('Claims vs evidence', text)
        self.assertIn('Every row of the claim table in `AUDIT.md` matches', text)
        for number in (self.claims['scan orphan'], self.claims['pages covered by the logs']):
            self.assertIn(f'{number:,}', text)

    def test_every_committed_log_holds_its_run_twice(self):
        """AUDIT.md says the logs double-count; that has to stay true of the files."""
        by_part = {}
        for name, match in log_events():
            by_part.setdefault(name, []).append((match.group(1), match.group(2)))
        self.assertEqual(len(by_part), 9)
        for name, events in by_part.items():
            counts = collections.Counter(events)
            self.assertTrue(all(n % 2 == 0 for n in counts.values()),
                            f'{name}: an event lost its twin, so the deduplicated '
                            f'figures in AUDIT.md need re-deriving')
            self.assertGreater(len(events) - len(counts), 0, f'{name} is not duplicated')


if __name__ == '__main__':
    unittest.main()
