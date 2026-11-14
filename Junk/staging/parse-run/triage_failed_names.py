"""Classify the books the JS parser failed, from the Python output alone.

Inputs, both from the ``python`` branch (nothing is extracted from the
parquet):

``Junk/failed/js-failed-names.txt``   133 names the JS parser failed on
``Junk/parsed-books.txt``             Python's txt output, ``===== name =====``

The point is the log format: the same ``diagnostics.syndrome`` that rates a
page in a live run can rate a text file after the fact, so a failed book is
identified *by symptom* without copying its PDF and re-running it.

Usage::

    python Junk/staging/parse-run/triage_failed_names.py
"""
from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'B.Parser' / 'architecture'))

from myangustis_parser.normalize import legacy_ascii          # noqa: E402
from myangustis_parser.workflow import diagnostics            # noqa: E402


def sections(text):
    """``===== name =====`` -> ``{name: body}``."""
    out, name, body = {}, None, []
    for line in text.splitlines():
        if line.startswith('===== ') and line.rstrip().endswith(' ====='):
            if name is not None:
                out[name] = '\n'.join(body)
            name, body = line.strip('= ').strip(), []
        elif name is not None:
            body.append(line)
    if name is not None:
        out[name] = '\n'.join(body)
    return out


def record(page, name, body):
    """One page record, exactly as the live diagnostics would build it."""
    found = diagnostics.text_metrics(body)
    residue = legacy_ascii.scan(body)
    proven = {slot: n for slot, n in residue.items() if slot in legacy_ascii.RESIDUE_SLOTS}
    unproven = {slot: n for slot, n in residue.items() if slot not in legacy_ascii.RESIDUE_SLOTS}
    return {
        'book': name, 'page': page, 'chars': found['chars'], 'myanmar': found['myanmar_chars'],
        'nonempty_lines': found['nonempty_lines'], 'single_char_lines': found['single_char_lines'],
        'residue': diagnostics._slot_counts(proven), 'residue_unproven': diagnostics._slot_counts(unproven),
        'residue_total': sum(residue.values()), 'unmapped_codes': 0, 'fallback_bytes': 0,
        'replacement_chars': found['replacement_chars'], 'duplicate_lines': found['adjacent_duplicate_lines'],
        'image_present': False,
        'status': ('empty' if not found['chars'] else 'degraded' if (unproven or found['replacement_chars'])
                   else 'repaired' if proven else 'ok'),
    }


class Tracker:
    """The little bit of LaneLog a BookReport needs."""
    def __init__(self, book):
        self.book, self.file = book, None

    def file_event(self, event, data):
        pass


def main():
    root = ROOT
    failed = [line.strip() for line in (root / 'Junk/failed/js-failed-names.txt').read_text().splitlines()
              if line.strip()]
    books = sections((root / 'Junk/parsed-books.txt').read_text(encoding='utf-8'))
    stems = {name.removesuffix('.pdf'): name for name in failed}

    verdicts, unmatched = [], []
    for name, body in books.items():
        stem = name.split('/')[-1].removesuffix('.pdf')
        report = diagnostics.BookReport(Tracker(name))
        for page, chunk in enumerate(body.split('\n\x0c'), 1):
            report.page(record(page, name, chunk))
        verdict = report.verdict()
        verdict['js_failed'] = stem in stems
        verdicts.append(verdict)
        if stems and stem not in stems:
            unmatched.append(name)

    counts = Counter(verdict['symptom'] for verdict in verdicts)
    lines = ['# Triaging the JS-failed books from the Python output', '',
             f'{len(verdicts)} books have Python output in `Junk/parsed-books.txt`; '
             f'{len(failed)} names are on the JS-failure list. Nothing was extracted from the parquet.', '',
             '## Symptom counts', '', '| syndrome | books | what it means |', '| --- | --- | --- |']
    meaning = {item: hint for item, hint in (
        ('legacy-ascii-residue', 'Latin letters standing in for အ/ဥ/ဩ/ဧ — repaired by normalize/legacy_ascii.py'),
        ('fragmented-lines', 'layout ran the text one glyph per line — the "unreadable column" output'),
        ('unmapped-glyphs', 'codes with no mapping; characters lost'),
        ('duplicated-text', 'adjacent duplicate lines'),
        ('no-myanmar-text', 'no Myanmar characters at all'),
        ('no-text-layer', 'images with no text layer'),
        ('ok', 'text looks readable'))}
    for symptom, count in counts.most_common():
        lines.append(f'| {symptom} | {count} | {meaning.get(symptom, "")} |')
    lines += ['', '## Per book', '',
              '| book | JS failed | pages | ok/repaired/degraded/empty | symptom | evidence |', '| --- | --- | --- | --- | --- | --- |']
    for verdict in sorted(verdicts, key=lambda item: (item['symptom'] == 'ok', item['book'])):
        pages = f"{verdict['ok']}/{verdict['repaired']}/{verdict['degraded']}/{verdict['empty']}"
        lines.append(f"| `{verdict['book']}` | {'yes' if verdict['js_failed'] else 'no'} | {verdict['pages']} | "
                     f"{pages} | **{verdict['symptom']}** | {verdict['evidence']} |")
    out = root / 'Junk/staging/parse-run/failed-names-triage.md'
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{out.relative_to(root)}: {len(verdicts)} books')
    for symptom, count in counts.most_common():
        print(f'  {symptom:<24} {count}')
    if unmatched:
        print('no JS-failure entry for:', ', '.join(unmatched[:5]), '...' if len(unmatched) > 5 else '')


if __name__ == '__main__':
    main()
