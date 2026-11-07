#!/usr/bin/env python3
"""Find dictionary-word candidates around one unresolved raw font byte.

Usage: python tools-box/python/raw-word-contexts.py MAP.json RAW_RUNS.json OUTPUT.json [--master MASTER.json]
RAW_RUNS.json is produced by wininnwa-raw-runs.py with the same map. The local
master word list supplies candidates; known raw slots anchor each match. Windows
can overlap or match substrings, and known slots can be provisional. A match is
contextual evidence, not independent glyph verification.
"""
import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MASTER = ROOT / 'tools-box/kit/master/master.json'
E, RA, YA = '\u1031', '\u103c', '\u103b'
MAX_SLOTS = 12


def visual_syllable(syllable, bases):
    if not syllable or syllable[0] not in bases:
        return syllable
    chars = list(syllable)
    if len(chars) >= 3 and chars[1] in (RA, YA) and chars[2] == E:
        return E + (RA if chars[1] == RA else '') + chars[0] + (YA if chars[1] == YA else '') + ''.join(chars[3:])
    if len(chars) >= 2 and chars[1] == E:
        return E + chars[0] + ''.join(chars[2:])
    if len(chars) >= 2 and chars[1] == RA:
        return RA + chars[0] + ''.join(chars[2:])
    return syllable


def make_index(master, possible_values):
    bases = set(master['mapData']['MMap']['Base'])
    words = set()
    for items in master['dictionary'].values():
        for entry in items:
            syllables = entry.split()
            if not syllables or any(not all('\u1000' <= c <= '\u109f' for c in syl) for syl in syllables):
                continue
            original = ''.join(syllables)
            visual = ''.join(visual_syllable(syl, bases) for syl in syllables)
            if 3 <= len(visual) <= 20:
                words.add((original, visual))
    index = defaultdict(lambda: defaultdict(set))
    for original, visual in words:
        for start in range(len(visual)):
            for size in range(1, min(3, len(visual) - start) + 1):
                value = visual[start:start + size]
                if value not in possible_values:
                    continue
                index[(visual[:start], visual[start + size:])][value].add(original)
    return index, len(words)


def analyze(mapping, runs, master):
    possible = {v for p in mapping['profiles'].values() for v in p['bytes'].values()}
    for p in mapping['profiles'].values():
        possible.update(p.get('resolvedForReview', {}).values())
        for section in ('unmapped', 'flaggedOrExcluded'):
            possible.update(rec['currentOutput'] for rec in p[section].values() if rec.get('currentOutput'))
    # Candidate base consonants, not just the previous decoder's guess.
    possible.update(master['mapData']['MMap']['Base'])
    index, word_count = make_index(master, possible)
    profiles = mapping['profiles']
    collected = {}
    for h, p in profiles.items():
        known = {**p['bytes'], **p.get('resolvedForReview', {})}
        pending = (set(p['unmapped']) | set(p['flaggedOrExcluded'])) - set(known)
        collected[h] = {'known': known, 'pending': pending, 'contexts': Counter(), 'pages': {}}
    for digest, page, text in runs:
        if digest not in collected:
            continue
        group = collected[digest]
        data = text if isinstance(text, bytes) else bytes.fromhex(text)
        raw = [f'{v:02X}' for v in data]
        known, pending = group['known'], group['pending']
        for pos, code in enumerate(raw):
            if code not in pending:
                continue
            left = []
            for j in range(pos - 1, max(-1, pos - MAX_SLOTS), -1):
                if raw[j] not in known:
                    break
                left.insert(0, raw[j])
            right = []
            for j in range(pos + 1, min(len(raw), pos + MAX_SLOTS)):
                if raw[j] not in known:
                    break
                right.append(raw[j])
            if len(left) + len(right) < 2:
                continue
            key = (code, tuple(left), tuple(right))
            group['contexts'][key] += 1
            group['pages'].setdefault(key, page)
    output = {}
    for digest, group in collected.items():
        known = group['known']
        results = defaultdict(dict)
        for (code, left, right), occurrences in group['contexts'].items():
            for lcount in range(len(left) + 1):
                before = left[len(left) - lcount:] if lcount else ()
                prefix = ''.join(known[x] for x in before)
                for rcount in range(len(right) + 1):
                    if lcount + rcount < 2 or lcount + rcount + 1 > MAX_SLOTS:
                        continue
                    after = right[:rcount]
                    suffix = ''.join(known[x] for x in after)
                    matches = index.get((prefix, suffix))
                    if not matches:
                        continue
                    raw_window = ' '.join((*before, code, *after))
                    for candidate, words in matches.items():
                        hit = results[code].setdefault(candidate, {'matches': 0, 'words': set(), 'examples': []})
                        hit['matches'] += occurrences
                        hit['words'].update(words)
                        evidence = {'page': group['pages'][(code, left, right)], 'raw': raw_window,
                                    'words': sorted(words)[:3]}
                        if len(hit['examples']) < 5 and evidence not in hit['examples']:
                            hit['examples'].append(evidence)
        for candidates in results.values():
            for hit in candidates.values():
                hit['words'] = sorted(hit['words'])
        output[digest] = results
    return {'dictionaryWords': word_count, 'scope': 'Provisional contextual matches; one unresolved byte per raw window. Match counts can overlap; known slots themselves can be provisional. Page streams only, no Form XObjects.', 'profiles': output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('map', help='font-hash-keyed raw byte map')
    parser.add_argument('raw_runs', help='JSON emitted by wininnwa-raw-runs.py')
    parser.add_argument('output', help='output evidence JSON')
    parser.add_argument('--master', type=Path, default=MASTER,
                        help='existing local master JSON; it will not be built')
    args = parser.parse_args()
    mapping = json.loads(Path(args.map).read_text(encoding='utf8'))
    runs = json.loads(Path(args.raw_runs).read_text(encoding='utf8'))
    master = json.loads(args.master.read_text(encoding='utf8'))
    result = analyze(mapping, runs, master)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f"Compared {result['dictionaryWords']} dictionary words across {len(result['profiles'])} font profiles")


if __name__ == '__main__':
    main()
