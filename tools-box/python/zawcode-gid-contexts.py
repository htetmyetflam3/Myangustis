#!/usr/bin/env python3
"""Collect pre-ToUnicode glyph contexts from the selected ZawCode draft fonts.

Only page content streams and exact embedded-font SHA-256 profiles are read;
Form XObjects and other fonts are outside this report. Context text is a
provisional aid, not evidence for the target glyph's Unicode value.
"""
import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'B.Parser/main/Python/modules'))
import pdf_extract as pdf
from legacy_order import reorder_zawcode_text
from pdf_fonts import FontResourceLoader, Name

PROFILE_PATH = ROOT / 'B.Parser/main/parser/jason-map/zawcode-draft-glyphs.json'


def profiled_font(loader, entry, profiles):
    font = loader.resolve(entry)
    if not isinstance(font, dict) or str(font.get('Subtype')) != 'Type0':
        return None
    if str(loader.resolve(font.get('Encoding'))) != 'Identity-H':
        return None
    descendants = loader.resolve(font.get('DescendantFonts'))
    descendant = loader.resolve(descendants[0]) if descendants else None
    if not isinstance(descendant, dict):
        return None
    if str(loader.resolve(descendant.get('CIDToGIDMap'))) != 'Identity':
        return None
    descriptor = loader.resolve(descendant.get('FontDescriptor'))
    if not isinstance(descriptor, dict):
        return None
    program = loader.stream_of(descriptor.get('FontFile2'))
    digest = hashlib.sha256(program).hexdigest() if program else None
    return digest if digest in profiles else None


def profile_values(data, digest):
    profile = data['profiles'][digest]
    template = data['templates'][profile['template']] if profile.get('template') else profile
    alternatives = {**template.get('alternatives', {}), **profile.get('alternatives', {})}
    glyphs = {**template.get('glyphs', {}), **profile.get('glyphs', {})}
    values = {gid: value for gid, value in glyphs.items() if gid not in alternatives}
    orders = {**template.get('orderGlyphs', {}), **profile.get('orderGlyphs', {})}
    for gid, entry in orders.items():
        if gid in alternatives:
            continue
        if gid in values and values[gid] != entry['slot']:
            del values[gid]
        else:
            values[gid] = entry['slot']
    return values


def content_refs(body):
    single = re.search(rb'/Contents\s+(\d+)\s+(\d+)\s+R', body)
    array = re.search(rb'/Contents\s*\[(.*?)\]', body, re.DOTALL)
    if single:
        return [(int(single.group(1)), int(single.group(2)))]
    if array:
        return [(int(num), int(gen)) for num, gen in
                re.findall(rb'(\d+)\s+(\d+)\s+R', array.group(1))]
    return []


def collect(path, gids, profile_data):
    objects = pdf.parse_pdf_objects(path.read_bytes())
    pages = pdf.collect_pages(objects, pdf.find_root_pages(objects))
    loader = FontResourceLoader(objects, pdf.get_stream, lambda *_: {}, lambda *_: {})
    profiles = profile_data['profiles']
    font_cache, value_cache = {}, {}
    watched = {int(gid, 16): gid for gid in gids}
    results = {gid: {'occurrences': 0, 'pages': set(), 'fontCounts': Counter(), 'examples': []}
               for gid in gids}
    used_pages = set()

    for page_no, (page, gen) in enumerate(pages, 1):
        selected = {}
        for resource, ref in loader.page_font_resources(page, gen).items():
            key = (ref.num, ref.gen) if hasattr(ref, 'num') else (page, gen, str(resource))
            if key not in font_cache:
                font_cache[key] = profiled_font(loader, ref, profiles)
            if font_cache[key]:
                selected[str(resource)] = font_cache[key]
        if not selected:
            continue
        active, current_font, buf = None, None, bytearray()

        def flush():
            if not buf:
                return
            if len(buf) % 2:
                raise ValueError(f'Incomplete Identity-H code on page {page_no}')
            used_pages.add(page_no)
            ids = [int.from_bytes(buf[i:i + 2], 'big') for i in range(0, len(buf), 2)]
            if current_font not in value_cache:
                value_cache[current_font] = profile_values(profile_data, current_font)
            values = value_cache[current_font]
            for i, code in enumerate(ids):
                gid = watched.get(code)
                if not gid:
                    continue
                record = results[gid]
                record['occurrences'] += 1
                record['pages'].add(page_no)
                record['fontCounts'][current_font] += 1
                start, stop = max(0, i - 30), min(len(ids), i + 40)
                window = ids[start:stop]
                slots = [f'[{gid}]' if x == code else values.get(f'{x:04X}', f'[{x:04X}]')
                         for x in window]
                record['examples'].append({
                    'page': page_no, 'fontSha256': current_font, 'fontResource': active,
                    'rawWindow': ' '.join(f'{x:04X}' for x in window),
                    'targetIndex': i - start,
                    'roughContext': reorder_zawcode_text(''.join(slots)),
                })
            buf.clear()

        for num, generation in content_refs(objects[(page, gen)]):
            stream = pdf.get_stream(objects, num, generation)
            if stream is None:
                raise ValueError(f'Missing page stream {num} {generation} on page {page_no}')
            for op, args in pdf.iter_content_operations(stream):
                if op in ('BT', 'ET', 'Tf', 'Tm', 'Td', 'TD', 'T*', "'", '"'):
                    flush()
                if op == 'Tf' and len(args) >= 2 and isinstance(args[-2], Name):
                    active = str(args[-2])
                    current_font = selected.get(active)
                if active in selected and op in ('Tj', 'TJ', "'", '"'):
                    for value in pdf._shown_strings(op, args):
                        buf.extend(value)
        flush()

    for record in results.values():
        record['pages'] = sorted(record['pages'])
        record['fontCounts'] = dict(record['fontCounts'])
    return {
        'scope': ('Raw page streams from exact profiled Identity-H / Identity CID-to-GID fonts; '
                  'Form XObjects and all other fonts excluded. No ToUnicode is used for raw IDs. '
                  'The target is masked in roughContext; other glyph readings and reordering are provisional.'),
        'source': path.name, 'totalPages': len(pages), 'profiledTextPages': len(used_pages),
        'profileCount': len(profiles), 'requestedGlyphs': gids, 'results': results,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--gids', nargs='+', required=True, metavar='HEX')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        values = [int(gid, 16) for gid in args.gids]
        if any(value < 0 or value > 0xffff for value in values):
            raise ValueError
    except ValueError:
        parser.error('--gids must contain 16-bit hexadecimal glyph IDs')
    gids = list(dict.fromkeys(f'{value:04X}' for value in values))
    profile_data = json.loads(PROFILE_PATH.read_text(encoding='utf-8'))
    result = collect(args.pdf, gids, profile_data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for gid in gids:
        item = result['results'][gid]
        print(f"{gid}: {item['occurrences']} occurrences on {len(item['pages'])} pages")


if __name__ == '__main__':
    main()
