#!/usr/bin/env python3
"""Emit raw text-show runs for font hashes in a raw-byte map.

Usage: python tools-box/python/wininnwa-raw-runs.py [--map MAP.json] book.pdf [book2.pdf ...]
The output is JSON on stdout. Page content streams are supported; Form XObject
text is not traversed. No /ToUnicode, glyph outline, or text cleanup is used.
"""
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'B.Parser/main/Python/modules'))
import pdf_extract as pdf
from pdf_fonts import FontResourceLoader, Name


def runs(path, known_hashes):
    objects = pdf.parse_pdf_objects(path.read_bytes())
    pages = pdf.collect_pages(objects, pdf.find_root_pages(objects))
    loader = FontResourceLoader(objects, pdf.get_stream, lambda *_: None, lambda *_: None)
    for page_no, (page, generation) in enumerate(pages, 1):
        fonts = {}
        for name, entry in loader.page_font_resources(page, generation).items():
            font = loader.resolve(entry)
            if not isinstance(font, dict):
                continue
            descriptor = loader.resolve(font.get('FontDescriptor'))
            if not isinstance(descriptor, dict):
                continue
            program = next((loader.stream_of(descriptor.get(key))
                            for key in ('FontFile2', 'FontFile3', 'FontFile')
                            if descriptor.get(key)), None)
            if program:
                digest = hashlib.sha256(program).hexdigest()
                if digest in known_hashes:
                    fonts[name] = digest
        raw_page = objects.get((page, generation), b'').decode('latin1')
        single = re.search(r'/Contents\s+(\d+)\s+\d+\s+R', raw_page)
        array = re.search(r'/Contents\s*\[(.*?)\]', raw_page, re.DOTALL)
        streams = [int(single.group(1))] if single else (
            [int(n) for n in re.findall(r'(\d+)\s+\d+\s+R', array.group(1))] if array else [])
        active = None
        buf = bytearray()
        for number in streams:
            stream = pdf.get_stream(objects, number)
            if stream is None:
                raise ValueError(f'{path}: missing content stream on page {page_no}')
            for op, args in pdf.iter_content_operations(stream):
                if op in ('BT', 'ET', 'Tf', 'Tm', 'Td', 'TD', 'T*', "'", '"') and buf:
                    yield [active, page_no, buf.hex().upper()]
                    buf.clear()
                if op == 'Tf' and len(args) >= 2 and isinstance(args[-2], Name):
                    active = fonts.get(str(args[-2]))
                elif active and op in ('Tj', 'TJ', "'", '"'):
                    for value in pdf._shown_strings(op, args):
                        buf.extend(value)
        if buf:
            yield [active, page_no, buf.hex().upper()]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--map', default=str(ROOT / 'B.Parser/main/parser/jason-map/raw-byte-map.json'),
                        help='font-hash-keyed raw byte map')
    parser.add_argument('pdf', nargs='+')
    args = parser.parse_args()
    mapping = json.loads(Path(args.map).read_text(encoding='utf-8'))
    hashes = set(mapping['profiles'])
    data = []
    for arg in args.pdf:
        selected = list(runs(Path(arg), hashes))
        if not selected:
            raise ValueError(f'{arg}: no page-stream text found for a known font hash')
        data.extend(selected)
    print(json.dumps(data))


if __name__ == '__main__':
    main()
