#!/usr/bin/env python3
"""Export Unicode grammar sections from an existing SQLite scripts database.

The source database is opened read-only. HTML markup becomes text boundaries;
Myanmar characters are not normalized or transliterated. The output includes
section identifiers because the database does not contain PDF page numbers.
"""
import argparse
import sqlite3
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


class PlainText(HTMLParser):
    BLOCKS = frozenset(('p', 'pre', 'div', 'h1', 'h2', 'h3', 'h4', 'h5',
                        'h6', 'li', 'tr', 'table', 'ul', 'ol', 'blockquote'))

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.suppressed = 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.suppressed += 1
        elif not self.suppressed:
            if tag in self.BLOCKS or tag == 'br':
                self.parts.append('\n')
            elif tag in ('td', 'th'):
                self.parts.append('\t')

    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.suppressed:
            self.suppressed -= 1
        elif not self.suppressed and tag in self.BLOCKS:
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.suppressed:
            self.parts.append(data)


def html_text(html):
    parser = PlainText()
    parser.feed(html or '')
    parser.close()
    return ''.join(parser.parts)


def read_sections(db_path):
    # pathlib URI escapes spaces and other special characters correctly.
    with sqlite3.connect(db_path.resolve().as_uri() + '?mode=ro', uri=True) as db:
        return [(rowid, title or '', chapter or '', html_text(body))
                for rowid, title, chapter, body in db.execute(
                    'SELECT id, title, chapter, body FROM mmgrammar ORDER BY id')]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', type=Path, default=ROOT / 'tools-box/js/scripts.db')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    sections = read_sections(args.database)
    if not sections:
        raise SystemExit('The mmgrammar table contains no sections')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', encoding='utf-8', newline='\n') as output:
        for rowid, title, chapter, text in sections:
            output.write(f'\n=== section {rowid} | chapter {chapter} | {title} ===\n')
            output.write(text.strip() + '\n')
    print(f'Exported {len(sections)} Unicode grammar sections to {args.output}')


if __name__ == '__main__':
    main()
