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
from itertools import product
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'B.Parser/main/Python/modules'))
import pdf_extract as pdf
from pdf_fonts import FontResourceLoader, Name
from legacy_order import reorder_legacy_slots

E, RA, YA = '\u1031', '\u103c', '\u103b'

# Separate source-context order slots, not a keyboard-byte map. Their glyph
# shapes are inserted by contextual GSUB, not direct one-to-one substitutions.
CONTEXT_ORDER_GLYPHS = {
    '5bc0cd2994aa0178e01efb00f9217e9adb975ba86e77a12e6e8f81268c450de9': {
        '00EF': {'slot': 'ြ', 'page': 3, 'raw': '00E4 00EF 0069 00DF 006D 00E9 00E8', 'reading': 'ကြောင်း'},
        '00F0': {'slot': 'ြ', 'page': 1, 'raw': '00F0 007E 00E0 0103 006D 00E9', 'reading': 'ပြိုင်'},
        '00F1': {'slot': 'ြ', 'page': 1, 'raw': '00F1 0069 00E1 00E8', 'reading': 'ကြီး'},
        '00F7': {'slot': 'ြွ', 'page': 11, 'raw': '00F7 0069 006D 00E9 00E8', 'reading': 'ကြွင်း'},
    },
}


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


def derived_candidates(program):
    """Keep finite, non-joiner GSUB single/ligature candidates and collisions.

    Contextual/multiple substitutions are not inverted here. Each round reads
    an immutable snapshot so an intermediate result never depends on lookup
    traversal order. These readings remain provisional, not a layout proof.
    """
    font = TTFont(io.BytesIO(program))
    names = font.getGlyphOrder()
    ids = {name: i for i, name in enumerate(names)}
    values, origins = defaultdict(set), defaultdict(set)
    for cp, name in (font.getBestCmap() or {}).items():
        if name != '.notdef':
            values[name].add(chr(cp))
            origins[name].add('cmap')
    singles, ligatures = [], []
    if 'GSUB' in font:
        for lookup in font['GSUB'].table.LookupList.Lookup:
            for table in lookup.SubTable:
                if lookup.LookupType == 1:
                    singles.extend((source, target) for source, target in table.mapping.items()
                                   if source != '.notdef' and target != '.notdef')
                elif lookup.LookupType == 4 and hasattr(table, 'ligatures'):
                    for first, entries in table.ligatures.items():
                        for entry in entries:
                            parts = [first, *entry.Component]
                            if (2 <= len(parts) <= 3 and '.notdef' not in parts
                                    and entry.LigGlyph != '.notdef' and entry.LigGlyph not in parts):
                                ligatures.append((parts, entry.LigGlyph))
    for _round in range(8):
        snapshot = {name: frozenset(v) for name, v in values.items()}
        additions, new_origins = defaultdict(set), defaultdict(set)
        for source, target in singles:
            if snapshot.get(source):
                additions[target].update(snapshot[source])
                new_origins[target].add('GSUB single substitution chain')
        for parts, target in ligatures:
            choices = [snapshot.get(part, ()) for part in parts]
            if not all(0 < len(choice) <= 3 for choice in choices):
                continue
            for sequence in product(*choices):
                text = ''.join(sequence)
                if len(text) <= 4 and not any(ch in text for ch in '\u200a\u200b\u200c\u200d'):
                    additions[target].add(text)
                    new_origins[target].add('GSUB ligature')
        changed = False
        for name, proposed in additions.items():
            before = len(values[name])
            values[name].update(proposed)
            origins[name].update(new_origins[name])
            changed |= len(values[name]) != before
        if not changed:
            break
    else:
        raise ValueError('GSUB candidate propagation did not converge')
    return {ids[name]: {'values': sorted(v), 'origins': sorted(origins[name])}
            for name, v in values.items() if name in ids and v}


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


def analyze(path, digest, limit, watched=(), start_page=1):
    objects = pdf.parse_pdf_objects(path.read_bytes())
    pages = pdf.collect_pages(objects, pdf.find_root_pages(objects))
    loader = FontResourceLoader(objects, pdf.get_stream, lambda *_: {}, lambda *_: {})
    results = None
    selected_program = None
    counts = Counter()
    patterns = {key: {'count': 0, 'examples': [], 'pages': set()} for key in
                ('e_ra_base', 'ra_base', 'e_base_ya', 'e_base_delayed_ya', 'e_base')}
    glyph_contexts = {gid: [] for gid in watched}
    font_cache = {}
    for page_no, (page, gen) in enumerate(pages[start_page - 1:start_page - 1 + limit], start_page):
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
                    selected_program = program
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
            for i, gid in enumerate(ids):
                if gid in glyph_contexts and len(glyph_contexts[gid]) < 8:
                    # Leave enough following slots to show complete source words
                    # such as ခြွင်းချက် rather than cutting off the final mark.
                    start, stop = max(0, i - 6), min(len(ids), i + 12)
                    glyph_contexts[gid].append({
                        'page': page_no, 'rawWindow': ' '.join(f'{x:04X}' for x in ids[start:stop]),
                        'windowSlots': slots[start:stop], 'targetIndex': i - start,
                    })
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
                record['pages'].add(page_no)
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
    for pattern in patterns.values():
        pattern['pages'] = sorted(pattern['pages'])
    report = {
        'scope': 'Page content streams only; two-byte Identity-H / CIDToGIDMap Identity. No ToUnicode, cleanup, OCR, or keyboard byte table. Cmap and direct GSUB single-substitution readings are provisional and ambiguous candidates are excluded from pattern matching.',
        'fontSha256': digest, 'source': path.name, 'totalPages': len(pages),
        'startPage': start_page, 'pagesExamined': min(limit, max(0, len(pages) - start_page + 1)),
        'rawGlyphOccurrences': sum(counts.values()),
        'glyphCandidates': {f'{gid:04X}': {**results.get(gid, {'values': [], 'origins': []}), 'occurrences': count}
                            for gid, count in sorted(counts.items())},
        'patterns': patterns,
        **({'glyphContexts': {f'{gid:04X}': examples for gid, examples in glyph_contexts.items()}}
           if glyph_contexts else {}),
    }
    return report, selected_program


def compatibility_signature(program, order_gids):
    """Compare actual GSUB bytes and the contextual slots' glyph outlines."""
    font = TTFont(io.BytesIO(program))
    if not all(tag in font for tag in ('GSUB', 'glyf', 'loca')):
        return None
    table = font.reader.tables['GSUB']
    gsub = hashlib.sha256(program[table.offset:table.offset + table.length]).hexdigest()
    table = font.reader.tables['glyf']
    glyf = program[table.offset:table.offset + table.length]
    locations = font['loca'].locations
    outlines = {}
    for gid in order_gids:
        if gid + 1 >= len(locations) or locations[gid] == locations[gid + 1]:
            return None
        outlines[f'{gid:04X}'] = hashlib.sha256(glyf[locations[gid]:locations[gid + 1]]).hexdigest()
    return {'gsubSha256': gsub, 'orderGlyphOutlines': outlines}


def compatible_profiles(path, reference_digest, reference_program):
    """Find exact font fingerprints supported by independent source evidence."""
    aliases = CONTEXT_ORDER_GLYPHS.get(reference_digest)
    if not aliases:
        raise ValueError('No source-reviewed contextual order slots for this reference font')
    order_gids = [int(gid, 16) for gid in aliases]
    signature = compatibility_signature(reference_program, order_gids)
    if not signature:
        raise ValueError('Reference font has no comparable GSUB/glyph outlines')
    reference_candidates = derived_candidates(reference_program)
    reference_values = {gid: data['values'] for gid, data in reference_candidates.items()}
    objects = pdf.parse_pdf_objects(path.read_bytes())
    pages = pdf.collect_pages(objects, pdf.find_root_pages(objects))
    loader = FontResourceLoader(objects, pdf.get_stream, lambda *_: {}, lambda *_: {})
    refs, programs = {}, {}
    for page_no, (page, gen) in enumerate(pages, 1):
        for resource, ref in loader.page_font_resources(page, gen).items():
            key = (ref.num, ref.gen) if hasattr(ref, 'num') else (page, gen, resource)
            if key not in refs:
                program = font_for(loader, ref)
                refs[key] = hashlib.sha256(program).hexdigest() if program else None
                if program:
                    programs.setdefault(refs[key], {'program': program, 'pages': set()})
            if refs[key]:
                programs[refs[key]]['pages'].add(page_no)
    accepted = {}
    for digest, entry in sorted(programs.items(), key=lambda item: min(item[1]['pages'])):
        program = entry['program']
        if compatibility_signature(program, order_gids) != signature:
            continue
        found = derived_candidates(program)
        if {gid: data['values'] for gid, data in found.items()} != reference_values:
            continue
        first = min(entry['pages'])
        evidence, _ = analyze(path, digest, 20, start_page=first)
        strong = evidence['patterns']['e_ra_base']
        if strong['count'] < 2 or len(strong['pages']) < 2:
            continue
        accepted[digest] = {
            'program': program, 'candidates': found,
            'evidence': {
                'firstResourcePage': first, 'lastResourcePage': max(entry['pages']),
                'resourcePages': len(entry['pages']), 'samplePages': evidence['pagesExamined'],
                'sampleRawGlyphs': evidence['rawGlyphOccurrences'],
                'eRaBaseCount': strong['count'], 'eRaBasePages': strong['pages'],
                'examples': strong['examples'][:2],
                'sameDerivedValuesAndContextSlotOutlinesAs': reference_digest,
                **signature,
            },
        }
    return accepted


def draft_coverage(path):
    """Collect real draft output counts and unresolved contexts, not accuracy claims."""
    from pipeline import stream_pdf_pages

    _, total, pages = stream_pdf_pages(path, detector=None, text_layout='zawcode')
    counts, codepoints, unresolved = Counter(), Counter(), {}
    for page in pages:
        kind = page.get('text_path') or 'other'
        counts[kind] += 1
        codepoints[kind] += len(page['text'])
        if kind != 'zawcode':
            continue
        for hit in re.finditer(r'\[([0-9A-F]{4})\]', page['text']):
            gid = hit.group(1)
            entry = unresolved.setdefault(gid, {'occurrences': 0, 'pages': set(), 'examples': []})
            entry['occurrences'] += 1
            entry['pages'].add(page['idx'] + 1)
            if len(entry['examples']) < 8:
                entry['examples'].append({
                    'page': page['idx'] + 1,
                    'decodedContext': page['text'][max(0, hit.start() - 20):hit.end() + 20],
                })
    profile_path = ROOT / 'B.Parser/main/parser/jason-map/zawcode-draft-glyphs.json'
    profile_bytes = profile_path.read_bytes()
    profile_hashes = set(json.loads(profile_bytes)['profiles'])
    objects = pdf.parse_pdf_objects(path.read_bytes())
    source_pages = pdf.collect_pages(objects, pdf.find_root_pages(objects))
    loader = FontResourceLoader(objects, pdf.get_stream, lambda *_: {}, lambda *_: {})
    for gid, entry in unresolved.items():
        entry['pages'] = sorted(entry['pages'])
        page_no = entry['examples'][0]['page']
        for ref in loader.page_font_resources(*source_pages[page_no - 1]).values():
            program = font_for(loader, ref)
            digest = hashlib.sha256(program).hexdigest() if program else None
            if digest not in profile_hashes:
                continue
            sample, _ = analyze(path, digest, 1, watched=[int(gid, 16)], start_page=page_no)
            raw_windows = sample.get('glyphContexts', {}).get(gid, [])
            if raw_windows:
                entry['rawFontSha256'] = digest
                entry['rawWindows'] = raw_windows
                break
    return {
        'scope': 'Runtime page-stream draft only, after line assembly; excluded Form XObjects and unprofiled pages. Counts are not an accuracy measure.',
        'source': path.name, 'totalPages': total,
        'runtimeProfileSha256': hashlib.sha256(profile_bytes).hexdigest(),
        'pageCounts': dict(counts), 'codePointCounts': dict(codepoints),
        'unresolvedGlyphs': unresolved,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('pdf', type=Path)
    parser.add_argument('--font-sha256', required=True)
    parser.add_argument('--pages', type=int, default=200)
    parser.add_argument('--start-page', type=int, default=1)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--profile-output', type=Path,
                        help='also export bounded font candidates for the draft decoder')
    parser.add_argument('--profile-inventory-output', type=Path,
                        help='add source-evidenced compatible font fingerprints and write their inventory')
    parser.add_argument('--coverage-output', type=Path,
                        help='record unresolved contexts from the installed runtime draft profile')
    parser.add_argument('--context-gids', nargs='*', default=[], metavar='HEX',
                        help='retain raw windows for these glyph IDs')
    args = parser.parse_args()
    if args.pages < 1 or args.start_page < 1:
        parser.error('--pages and --start-page must be positive')
    if args.profile_inventory_output and not args.profile_output:
        parser.error('--profile-inventory-output requires --profile-output')
    runtime_profile = ROOT / 'B.Parser/main/parser/jason-map/zawcode-draft-glyphs.json'
    if args.coverage_output and args.profile_output and args.profile_output.resolve() != runtime_profile.resolve():
        parser.error('--coverage-output uses the installed runtime profile; set --profile-output to its path')
    digest = args.font_sha256.lower()
    try:
        watched = [int(gid, 16) for gid in args.context_gids]
    except ValueError:
        parser.error('--context-gids must be hexadecimal glyph IDs')
    result, program = analyze(args.pdf, digest, args.pages, watched, args.start_page)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.profile_output:
        if args.profile_inventory_output:
            selected = compatible_profiles(args.pdf, digest, program)
            if digest not in selected:
                raise ValueError('Reference profile did not meet the source-order evidence threshold')
        else:
            selected = {digest: {'program': program, 'candidates': derived_candidates(program)}}
        profiles, templates = {}, {}
        for font_hash, entry in selected.items():
            candidates_by_gid = entry['candidates']
            template = {
                'encoding': 'Identity-H', 'cidToGid': 'Identity',
                'glyphs': {f'{gid:04X}': item['values'][0]
                           for gid, item in sorted(candidates_by_gid.items()) if len(item['values']) == 1},
                'origins': {f'{gid:04X}': item['origins']
                            for gid, item in sorted(candidates_by_gid.items())},
                'alternatives': {f'{gid:04X}': item['values']
                                 for gid, item in sorted(candidates_by_gid.items()) if len(item['values']) > 1},
                'orderGlyphs': CONTEXT_ORDER_GLYPHS.get(digest, {}),
            }
            template_id = next((key for key, value in templates.items() if value == template), None)
            if template_id is None:
                template_id = font_hash
                templates[template_id] = template
            profiles[font_hash] = {'template': template_id}
        profile = {
            'status': 'draft; provisional cmap and bounded GSUB readings, not keyboard bytes',
            'source': 'tools-box/python/zawcode-order-evidence.py',
            'referenceFontSha256': digest, 'templates': templates, 'profiles': profiles,
        }
        args.profile_output.parent.mkdir(parents=True, exist_ok=True)
        args.profile_output.write_text(json.dumps(profile, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        if args.profile_inventory_output:
            inventory = {'source': args.pdf.name, 'referenceFontSha256': digest,
                         'profiles': {font_hash: item['evidence'] for font_hash, item in selected.items()}}
            args.profile_inventory_output.parent.mkdir(parents=True, exist_ok=True)
            args.profile_inventory_output.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.coverage_output:
        coverage = draft_coverage(args.pdf)
        args.coverage_output.parent.mkdir(parents=True, exist_ok=True)
        args.coverage_output.write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('Recorded', sum(p['count'] for p in result['patterns'].values()), 'overlapping order-pattern occurrences in', args.output)


if __name__ == '__main__':
    main()
