#!/usr/bin/env python3
"""Inspect pre-ToUnicode ZawCode PDF glyph order for a chosen font subset.

Requires fontTools. Page-stream text is sampled; Form XObjects are not read.
Unicode labels derived from the font cmap/GSUB are provisional, not proof of a
keyboard layout, and no character cleanup or legacy code page is applied.
"""
import argparse
import hashlib
import io
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'B.Parser/main/Python/modules'))
import pdf_extract as pdf
from pdf_fonts import FontResourceLoader, Name
from legacy_order import reorder_legacy_slots

E, RA, YA = '\u1031', '\u103c', '\u103b'


def candidates(program):
    font = TTFont(io.BytesIO(program))
    names = font.getGlyphOrder()
    ids = {name: i for i, name in enumerate(names)}
    by_name = defaultdict(set)
    origins = defaultdict(set)
    for cp, name in (font.getBestCmap() or {}).items():
        by_name[name].add(chr(cp))
        origins[name].add('cmap')
    cmap_values = {name: frozenset(values) for name, values in by_name.items()}
    if 'GSUB' in font:
        for lookup in font['GSUB'].table.LookupList.Lookup:
            if lookup.LookupType != 1:
                continue
            for table in lookup.SubTable:
                for source, target in table.mapping.items():
                    # Only a direct Unicode-cmap input, never transitive or a
                    # ligature guess. Preserve collisions as alternatives.
                    if source in cmap_values:
                        by_name[target].update(cmap_values[source])
                        origins[target].add('GSUB single substitution')
    return {ids[name]: {'values': sorted(values), 'origins': sorted(origins[name])}
            for name, values in by_name.items() if name in ids}


def font_for(loader, entry):
    font = loader.resolve(entry)
    if not isinstance(font, dict) or str(font.get('Subtype')) != 'Type0':
        return None
    if str(loader.resolve(font.get('Encoding'))) != 'Identity-H':
        return None
    descendants = loader.resolve(font.get('DescendantFonts'))
    descendant = loader.resolve(descendants[0]) if descendants else None
    if not isinstance(descendant, dict) or str(loader.resolve(descendant.get('CIDToGIDMap'))) != 'Identity':
        return None
    descriptor = loader.resolve(descendant.get('FontDescriptor'))
    if not isinstance(descriptor, dict):
        return None
    program = loader.stream_of(descriptor.get('FontFile2'))
    return program if program else None


def analyze(path, digest, limit):
    objects = pdf.parse_pdf_objects(path.read_bytes())
    pages = pdf.collect_pages(objects, pdf.find_root_pages(objects))
    loader = FontResourceLoader(objects, pdf.get_stream, lambda *_: {}, lambda *_: {})
    results = None
    counts = Counter()
    patterns = {key: {'count': 0, 'examples': []} for key in
                ('e_ra_base', 'ra_base', 'e_base_ya', 'e_base_delayed_ya', 'e_base')}
    font_cache = {}
    for page_no, (page, gen) in enumerate(pages[:limit], 1):
        selected = set()
        for resource, ref in loader.page_font_resources(page, gen).items():
            key = (ref.num, ref.gen) if hasattr(ref, 'num') else None
            if key not in font_cache:
                program = font_for(loader, ref)
                font_cache[key] = program if program and hashlib.sha256(program).hexdigest() == digest else None
            program = font_cache[key]
            if program:
                selected.add(resource)
                if results is None:
                    results = candidates(program)
        if not selected:
            continue
        body = objects[(page, gen)]
        single = re.search(rb'/Contents\s+(\d+)\s+\d+\s+R', body)
        array = re.search(rb'/Contents\s*\[(.*?)\]', body, re.DOTALL)
        streams = [int(single.group(1))] if single else (
            [int(x) for x in re.findall(rb'(\d+)\s+\d+\s+R', array.group(1))] if array else [])
        active = None
        buf = bytearray()

        def flush():
            if len(buf) % 2:
                raise ValueError(f'Incomplete Identity-H code on page {page_no}')
            ids = [int.from_bytes(buf[i:i + 2], 'big') for i in range(0, len(buf), 2)]
            counts.update(ids)
            slots = [results[g]['values'][0] if g in results and len(results[g]['values']) == 1 else None for g in ids]
            def is_base(s):
                return s is not None and (('\u1000' <= s <= '\u1021') or ('\u1023' <= s <= '\u102a'))
            for i, ch in enumerate(slots):
                name = None
                end = i + 1
                if ch == E and i + 2 < len(slots) and slots[i + 1] == RA and is_base(slots[i + 2]):
                    name, end = 'e_ra_base', i + 3
                elif ch == RA and i + 1 < len(slots) and is_base(slots[i + 1]):
                    name, end = 'ra_base', i + 2
                elif ch == E and i + 1 < len(slots) and is_base(slots[i + 1]):
                    name, end = 'e_base', i + 2
                    for j in range(i + 2, min(i + 8, len(slots))):
                        s = slots[j]
                        if s == YA:
                            name = 'e_base_ya' if j == i + 2 else 'e_base_delayed_ya'
                            end = j + 1
                            break
                        if s is None or not '\u102b' <= s <= '\u103e' or s == '\u1039':
                            break
                if not name:
                    continue
                record = patterns[name]
                record['count'] += 1
                if len(record['examples']) < 8:
                    start, stop = max(0, i - 3), min(len(ids), end + 6)
                    record['examples'].append({
                        'page': page_no, 'rawWindow': ' '.join(f'{x:04X}' for x in ids[start:stop]),
                        'windowSlots': [s if s is not None else None for s in slots[start:stop]],
                        'inputSlots': slots[i:end],
                        'orderedSlots': reorder_legacy_slots(slots[i:end], layout='zawcode'),
                    })
            buf.clear()

        for stream_id in streams:
            stream = pdf.get_stream(objects, stream_id)
            if stream is None:
                raise ValueError(f'Missing page stream on page {page_no}')
            for op, args in pdf.iter_content_operations(stream):
                if op in ('BT', 'ET', 'Tf', 'Tm', 'Td', 'TD', 'T*', "'", '"') and buf:
                    flush()
                if op == 'Tf' and len(args) >= 2 and isinstance(args[-2], Name):
                    active = str(args[-2])
                if active in selected and op in ('Tj', 'TJ', "'", '"'):
                    for value in pdf._shown_strings(op, args):
                        buf.extend(value)
        if buf:
            flush()
    if results is None:
        raise ValueError('No selected Identity-H font with that SHA-256 was found')
    return {
        'scope': 'Page content streams only; two-byte Identity-H / CIDToGIDMap Identity. No ToUnicode, cleanup, OCR, or keyboard byte table. Cmap and direct GSUB single-substitution readings are provisional and ambiguous candidates are excluded from pattern matching.',
        'fontSha256': digest, 'source': path.name, 'totalPages': len(pages), 'pagesExamined': min(limit, len(pages)),
        'rawGlyphOccurrences': sum(counts.values()),
        'glyphCandidates': {f'{gid:04X}': {**results.get(gid, {'values': [], 'origins': []}), 'occurrences': count}
                            for gid, count in sorted(counts.items())},
        'patterns': patterns,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--font-sha256', required=True)
    parser.add_argument('--pages', type=int, default=200)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.pages < 1:
        parser.error('--pages must be positive')
    result = analyze(args.pdf, args.font_sha256.lower(), args.pages)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Recorded', sum(p['count'] for p in result['patterns'].values()), 'overlapping order-pattern occurrences in', args.output)


if __name__ == '__main__':
    main()
