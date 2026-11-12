"""Scan finished output using the Engine's POS stream, without repairing it.

Unlike the structural character scan in ``scan.py``, this stage examines
Engine verdicts and retains only unknown-token contexts with page/line origin.
It never uses a separate dictionary and never performs vector repair.
"""
from __future__ import annotations

import asyncio
import re
import unicodedata
from myangustis_engine.api import collect

_NON_WORD_TAGS = frozenset(('pan', 'eos', 'en', 'count', 'phone', 'addr',
                            'year', 'exactdate', 'page number', 'page marker'))
_TOKEN = re.compile(r'^(.*?)\{([^{}]+)\}$')
_PAGE_NUMBER = re.compile(r'^[0-9၀-၉]{1,4}$')
_PAGE_MARKER = re.compile(r'^\s*(?:-{2,}\s*)?page\s*[-:]?\s*[0-9၀-၉]+\s*(?:-{2,})?\s*$', re.I)
_NUMERIC = re.compile(r'^[\s0-9.,/+\-]+$')


def parse_tagged_line(raw):
    tokens = []
    for part in raw.split('  '):
        formatted = part.strip()
        if not formatted:
            continue
        match = _TOKEN.match(formatted)
        if match is None:
            tokens.append({'formatted': formatted, 'word': formatted, 'tags': [], 'kind': 'other'})
            continue
        tags = [tag.strip() for tag in match.group(2).split(',') if tag.strip()]
        kind = ('unknown' if tags == ['F'] else
                'known' if any(tag != 'F' and tag not in _NON_WORD_TAGS for tag in tags)
                else 'other')
        tokens.append({'formatted': formatted, 'word': match.group(1), 'tags': tags, 'kind': kind})
    return tokens


def _pos_source(source):
    is_myanmar = any(0x1000 <= ord(c) <= 0x109f or 0xaa60 <= ord(c) <= 0xaa7f
                     or 0xa9e0 <= ord(c) <= 0xa9ff for c in source)
    if not is_myanmar and not _NUMERIC.fullmatch(source):
        return ''
    # JS replaces runs of Script=Latin by a space, preserving original source.
    out, was_latin = [], False
    for char in source:
        latin = 'LATIN' in unicodedata.name(char, '') and unicodedata.category(char).startswith('L')
        if latin:
            if not was_latin:
                out.append(' ')
        else:
            out.append(char)
        was_latin = latin
    return ''.join(out)


def _unknown_contexts(tokens):
    out = []
    i = 0
    while i < len(tokens):
        if tokens[i]['kind'] != 'unknown':
            i += 1
            continue
        end = i + 1
        while end < len(tokens) and tokens[end]['kind'] == 'unknown':
            end += 1
        before = [t for t in tokens[:i] if t['kind'] == 'known'][-2:]
        after = [t for t in tokens[end:] if t['kind'] == 'known'][:2 if end-i > 1 else 1]
        out.append({'count': end - i,
                    'context': '  '.join(t['formatted'] for t in before + tokens[i:end] + after)})
        i = end
    return out


async def scan_pages(pages):
    memory = []
    total = 0
    for page_number, page in enumerate(pages, 1):
        text = page.get('text', '') if isinstance(page, dict) else str(page)
        for line_number, source in enumerate(text.split('\n'), 1):
            stripped = source.strip()
            if _PAGE_NUMBER.fullmatch(stripped) or _PAGE_MARKER.fullmatch(source):
                continue
            input_text = _pos_source(source)
            if not input_text.strip():
                continue
            units = await collect(input_text, 'pos')
            raw_pos = '  '.join(unit['rawPos'] for unit in units if unit['rawPos'])
            for hit in _unknown_contexts(parse_tagged_line(raw_pos)):
                total += hit['count']
                memory.append({'page': page_number, 'line': line_number,
                               'source': source, **hit})
    return {'memory': memory, 'unknownCount': total, 'contextCount': len(memory)}


def scan_pages_sync(pages):
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(scan_pages(pages))
    raise RuntimeError('A running event loop cannot call the synchronous Parser; await scan_pages instead')
