"""The committed parser evidence digest must match its source files."""
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
        cls.metrics = json.loads(run('--json'))

    def test_metrics_recompute_from_the_raw_files(self):
        """Compute key totals separately so a broken parser cannot return zeros."""
        orphan = sum(int(n) for path in AUDIT.glob('scans/part-*.scan.txt')
                     for n in SCAN_HEAD.findall(path.read_text(encoding='utf-8')))
        self.assertEqual(self.metrics['scan orphan'], orphan)

        # Page numbers restart at 1 in every part, so the union is per file and
        # the totals are summed across the nine.
        by_part = {}
        for name, match in log_events():
            if match.group(1) != 'decision':
                continue
            low, high = PAGES.search(match.group(2)).groups()
            by_part.setdefault(name, set()).update(range(int(low), int(high) + 1))
        self.assertEqual(self.metrics['pages covered by the logs'],
                         sum(len(pages) for pages in by_part.values()))
        self.assertEqual(self.metrics['log events (all parts)'], len(list(log_events())))

    def test_no_number_is_zero_because_a_pattern_stopped_matching(self):
        self.assertEqual(len(list(AUDIT.glob('parts/part-*.log'))), 9)
        self.assertEqual(len(list(AUDIT.glob('scans/part-*.scan.txt'))), 9)
        self.assertTrue(all(value > 0 for value in self.metrics.values()), self.metrics)

    def test_digest_stays_a_window(self):
        text = run()
        self.assertLessEqual(len(text.splitlines()), 60, 'the digest outgrew one screen')
        self.assertIn('| part | log lines | distinct | pages |', text)
        self.assertIn('What the logs are, and are not', text)
        for number in (self.metrics['scan orphan'], self.metrics['pages covered by the logs']):
            self.assertIn(f'{number:,}', text)

    def test_committed_overview_matches_evidence(self):
        out = run('--check')
        self.assertIn('OK: B.Parser/audit/OVERVIEW.md matches', out)

    def test_every_committed_log_holds_its_run_twice(self):
        by_part = {}
        for name, match in log_events():
            by_part.setdefault(name, []).append((match.group(1), match.group(2)))
        self.assertEqual(len(by_part), 9)
        for name, events in by_part.items():
            counts = collections.Counter(events)
            self.assertTrue(all(n % 2 == 0 for n in counts.values()),
                            f'{name}: an event lost its twin; re-derive the deduplicated counts')
            self.assertGreater(len(events) - len(counts), 0, f'{name} is not duplicated')


if __name__ == '__main__':
    unittest.main()
