"""Summarize the committed parser logs, scans, and per-book rollup.

    python B.Parser/tools/audit_overview.py              # print the digest
    python B.Parser/tools/audit_overview.py --write      # refresh audit/OVERVIEW.md
    python B.Parser/tools/audit_overview.py --check      # check the committed digest
    python B.Parser/tools/audit_overview.py --json       # print the totals as JSON

This tool reads only the checked-in evidence; it does not parse PDFs and uses
only the Python standard library.
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / 'B.Parser/audit'
PARTS = 9

#: One log line, as written by Logen: [time] [MODULE] level event {json}.
LOG_LINE = re.compile(r'^\[[\d:.]+\] \[(\w+)\] \w+ ([\w-]+) (\{.*\})$')
#: The summary table at the head of a scan report: "orphan  9528  2578  ...".
SCAN_ROW = re.compile(r'^(orphan|impossible|stray|repeat|digit|virama)\s+(\d+)\s+(\d+)',
                      re.MULTILINE)
SCAN_RULES = ('orphan', 'impossible', 'stray', 'repeat', 'digit', 'virama')


def _int(text: str) -> int:
    return int(str(text).replace(',', '').replace('\u00a0', '').strip())


def read_log(path: Path) -> dict:
    """One part's lane log: what it holds, and which pages it says it covers.

    Each committed part log holds the same run twice — Logen appends, and the
    collection ran every part twice into one path — so nothing here is counted
    by lines. A page keeps the first decision that names it, and when every
    event count is even the file is a doubled copy of itself: the tallies below
    are then divided back to one pass, so a doubled log reads like a single one.
    """
    rows = []
    for line in path.read_text(encoding='utf-8', errors='replace').splitlines():
        match = LOG_LINE.match(line.strip())
        if not match:
            continue
        module, event, payload = match.groups()
        rows.append((event, json.dumps(json.loads(payload), sort_keys=True)))
    counts = collections.Counter(payload for _, payload in rows)
    first = {payload: event for event, payload in reversed(rows)}
    doubled = bool(counts) and all(n % 2 == 0 for n in counts.values())
    factor = 2 if doubled else 1

    page_rule: dict = {}
    for event, payload in rows:
        if event != 'decision':
            continue
        record = json.loads(payload)
        low, _, high = str(record['pages']).partition('-')
        for page in range(int(low), int(high or low) + 1):
            page_rule.setdefault(page, record['rule'])

    switches, fields = collections.Counter(), collections.Counter()
    for payload, event in first.items():
        record, weight = json.loads(payload), counts[payload] // factor
        fields[f'{event}: {", ".join(sorted(record))}'] += weight
        if event == 'lane-switch':
            switches[f"{record['from']}>{record['to']}"] += weight
    return {
        'lines': len(rows),
        'distinct': len(counts),
        'doubled': doubled,
        'twinned': sum(n for n in counts.values() if n > 1),
        'pages': len(page_rule),
        'highest_page': max(page_rule) if page_rule else 0,
        'gaps': sorted(set(range(1, (max(page_rule) if page_rule else 0) + 1)) - set(page_rule)),
        'rules': collections.Counter(page_rule.values()),
        'switches': switches,
        'fields': fields,
        'events': collections.Counter(first.values()),
    }


def read_scan(path: Path) -> dict:
    """One part's damage scan: the summary table, and how much detail it lists."""
    text = path.read_text(encoding='utf-8', errors='replace')
    totals = {rule: 0 for rule in SCAN_RULES}
    distinct = {rule: 0 for rule in SCAN_RULES}
    for rule, hits, clusters in SCAN_ROW.findall(text):
        totals[rule] += int(hits)
        distinct[rule] += int(clusters)
    listed = len(re.findall(r'^\s+line \d+:', text, re.MULTILINE))
    chars = re.search(r'^([\d,]+) characters$', text, re.MULTILINE)
    return {'totals': totals, 'distinct': distinct, 'clusters_listed': listed,
            'chars': _int(chars.group(1)) if chars else 0}


def read_books(path: Path) -> dict:
    """The per-book rollup: one JSON object per book, four defect counters."""
    books = [json.loads(line) for line in path.read_text(encoding='utf-8').splitlines()
              if line.strip()]
    flagged = [b for b in books if sum(b.get(k, 0) for k in ('orphan', 'impossible', 'stray',
                                                              'repeat')) > 0]
    return {
        'books': len(books),
        'pages': sum(b.get('pages', 0) for b in books),
        'flagged': len(flagged),
        'flagged_pages': sum(b.get('pages', 0) for b in flagged),
        'worst': sorted(books, key=lambda b: -b.get('orphan', 0))[:3],
        'unattributed': [b for b in books if b.get('book') == 'unknown'],
        'sum': {k: sum(b.get(k, 0) for b in books)
                for k in ('orphan', 'impossible', 'stray', 'repeat')},
    }


def collect(audit: Path = AUDIT) -> dict:
    logs = {n: read_log(audit / 'parts' / f'part-{n}.log') for n in range(1, PARTS + 1)}
    scans = {n: read_scan(audit / 'scans' / f'part-{n}.scan.txt') for n in range(1, PARTS + 1)}
    scan_totals = collections.Counter()
    scan_distinct = collections.Counter()
    for part in scans.values():
        scan_totals.update(part['totals'])
        scan_distinct.update(part['distinct'])
    books = read_books(audit / 'broken-books.jsonl')
    per_part_orphan = {n: scans[n]['totals']['orphan'] for n in scans}
    rules, switches = collections.Counter(), collections.Counter()
    for part in logs.values():
        rules.update(part['rules'])
        switches.update(part['switches'])
    return {
        'logs': logs,
        'scans': scans,
        'scan_totals': scan_totals,
        'scan_distinct': scan_distinct,
        'books': books,
        'per_part_orphan': per_part_orphan,
        'pages_logged': sum(p['pages'] for p in logs.values()),
        'log_lines': sum(p['lines'] for p in logs.values()),
        'log_distinct': sum(p['distinct'] for p in logs.values()),
        'log_twinned': sum(p['twinned'] for p in logs.values()),
        'rules': rules,
        'switches': switches,
    }


def metrics(data: dict) -> 'dict[str, int]':
    """Totals derived from the committed evidence."""
    return {
        'pages covered by the logs': data['pages_logged'],
        'log events (all parts)': data['log_lines'],
        'distinct log events': data['log_distinct'],
        'scan orphan': data['scan_totals']['orphan'],
        'scan impossible': data['scan_totals']['impossible'],
        'scan stray': data['scan_totals']['stray'],
        'scan repeat': data['scan_totals']['repeat'],
        'scan digit': data['scan_totals']['digit'],
        'scan virama': data['scan_totals']['virama'],
        'books in the report': data['books']['books'],
        'report pages': data['books']['pages'],
        'books with a defect': data['books']['flagged'],
    }


def digest(data: dict) -> str:
    """The manageable window: nine parts, three evidence kinds, one screen."""
    out = ['# Audit evidence overview', '',
           'Generated by `python B.Parser/tools/audit_overview.py --write` from '
           f'`B.Parser/audit/`: {data["log_lines"]:,} log lines, 9 scans, '
           f'{data["books"]["books"]} books. Read this instead of the raw files.', '']
    out += ['| part | log lines | distinct | pages | run | scan orphan | impossible | stray | '
            'repeat |', '|---|---|---|---|---|---|---|---|---|']
    for n in range(1, PARTS + 1):
        log, scan = data['logs'][n], data['scans'][n]
        out.append(f'| {n} | {log["lines"]:,} | {log["distinct"]:,} | {log["pages"]:,} | '
                   f'{"twice" if log["doubled"] else "once"} | {scan["totals"]["orphan"]:,} | '
                   f'{scan["totals"]["impossible"]:,} | {scan["totals"]["stray"]:,} | '
                   f'{scan["totals"]["repeat"]:,} |')
    totals, books = data['scan_totals'], data['books']
    gaps = {n: len(log['gaps']) for n, log in data['logs'].items() if log['gaps']}
    out += ['',
            f'The logs cover **{data["pages_logged"]:,} distinct pages** '
            f'(page numbering is contiguous{"; holes only in part(s) " + ", ".join(f"{n}: {c}" for n, c in sorted(gaps.items())) if gaps else ""}). '
            f'The scans report **{totals["orphan"]:,} orphan · {totals["stray"]:,} stray · '
            f'{totals["repeat"]:,} repeat · {totals["impossible"]:,} impossible · '
            f'{totals["digit"]:,} digit · {totals["virama"]:,} virama**.', '',
            '## What the logs are, and are not', '',
            f'- **The same run appears twice in every part** '
            f'({data["log_twinned"]:,} of {data["log_lines"]:,} events have an identical twin). '
            'Line counts from these files are double unless deduplicated; pages above are a union.',
            '- They carry only the compressed lane events — '
            + ', '.join(f'`{name}`' for name in sorted(data['logs'][1]['fields']))
            + ' — not the per-page record. `lane_reason`, `category`, `residue`, '
            '`detached_marks`, `duplicate_lines`, `warnings` and `status` come from '
            '`workflow/diagnostics.py` and need `PARSER_DIAGNOSTICS=1` next to '
            '`PARSER_LOG_ENABLED=1`.',
            '- Decisions per page, one pass: '
            + ', '.join(f'{rule} {pages:,}' for rule, pages in data['rules'].most_common()) + '.',
            '- Stem switches: '
            + ', '.join(f'{lane} {n}' for lane, n in data['switches'].most_common())
            + ' — a page that flips and flips back logs both ways.',
            '', '## Per-book rollup (`audit/broken-books.jsonl`)', '',
            f'{books["books"]} books, {books["pages"]:,} pages, {books["flagged"]} with a defect '
            f'({books["flagged_pages"]:,} pages). It sums to {books["sum"]["orphan"]:,} orphan '
            f'against the {totals["orphan"]:,} the scans report, so it is a rollup of the flagged '
            'books, not the per-page report — the per-page numbers cannot be recomputed from '
            'anything in this repository.', '',
            '| book | pages | orphan | impossible | stray | repeat |',
            '|---|---|---|---|---|---|']
    for book in books['worst']:
        out.append(f'| `{book["book"]}` | {book["pages"]} | {book["orphan"]:,} | '
                   f'{book["impossible"]} | {book["stray"]} | {book["repeat"]} |')
    unattributed = books['unattributed']
    if unattributed:
        lost = sum(b['orphan'] for b in unattributed)
        out += ['', f'{len(unattributed)} row carries no book name — {lost:,} orphan hits '
                    f'({lost * 100 // max(totals["orphan"], 1)}% of the scan total) that no '
                    'per-book fix can be aimed at from this file.']
    return '\n'.join(out).rstrip() + '\n'


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--audit-dir', default=str(AUDIT), help='evidence directory to read')
    ap.add_argument('--write', action='store_true',
                    help='write the digest to <audit-dir>/OVERVIEW.md')
    ap.add_argument('--check', action='store_true',
                    help='check that the committed overview matches the evidence')
    ap.add_argument('--json', action='store_true', help='print the computed totals as JSON')
    args = ap.parse_args(argv)
    audit = Path(args.audit_dir)
    data = collect(audit)
    if args.json:
        print(json.dumps(metrics(data), indent=2))
        return 0
    text = digest(data)
    if args.check:
        overview = audit / 'OVERVIEW.md'
        if not overview.is_file():
            print(f'MISSING: {overview}', file=sys.stderr)
            return 1
        if overview.read_text(encoding='utf-8') != text:
            print(f'STALE: run {Path(__file__).relative_to(ROOT)} --write', file=sys.stderr)
            return 1
        print(f'OK: {overview.relative_to(ROOT)} matches the committed evidence')
        return 0
    if args.write:
        out = audit / 'OVERVIEW.md'
        out.write_text(text, encoding='utf-8')
        print(f'[+] {out.relative_to(ROOT)} ({len(text.splitlines())} lines)')
        return 0
    print(text, end='')
    return 0


if __name__ == '__main__':
    sys.exit(main())
