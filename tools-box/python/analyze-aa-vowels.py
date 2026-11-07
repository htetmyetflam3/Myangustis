#!/usr/bin/env python3
"""Separate exact dictionary syllables containing ာ and ါ.

Reads an existing master JSON without changing or rebuilding it. The dictionary's
whitespace-separated syllables are preserved exactly; counts are dictionary-token
occurrences, not PDF frequencies. No spelling or Unicode normalization is applied.
"""
import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--master', type=Path, default=ROOT / 'tools-box/kit/master/master.json')
    parser.add_argument('--json', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    raw = args.master.read_bytes()
    master = json.loads(raw)
    counts = Counter(token for entries in master['dictionary'].values()
                     for entry in entries for token in entry.split())
    categories = {}
    for vowel in ('ာ', 'ါ'):
        syllables = sorted(s for s in counts if vowel in s)
        groups = defaultdict(list)
        with_ya_ra = []
        for syllable in syllables:
            groups[syllable[0]].append(syllable)
            prefix = syllable[:syllable.index(vowel)]
            if 'ျ' in prefix or 'ြ' in prefix:
                with_ya_ra.append(syllable)
        categories[vowel] = {
            'distinctSyllables': len(syllables),
            'dictionaryTokenOccurrences': sum(counts[s] for s in syllables),
            'withYaOrRaBeforeVowel': with_ya_ra,
            'byInitialCharacter': dict(sorted(groups.items())),
        }
    both = sorted(s for s in counts if 'ာ' in s and 'ါ' in s)
    result = {
        'source': 'Existing local master dictionary; dictionary entries split on whitespace.',
        'sourceSha256': hashlib.sha256(raw).hexdigest(),
        'scope': 'Exact distinct tokens as stored, with no spelling normalization. Token occurrences are not PDF or independent word frequencies. Initial-character groups are not proof of the vowel binding in stacked clusters.',
        'vowels': categories,
        'syllablesContainingBothVowels': both,
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    lines = [
        'Dictionary syllables separated by ာ and ါ',
        '',
        'Source: existing local master.json dictionary, whitespace-separated tokens.',
        f'Source SHA-256: {result["sourceSha256"]}',
        'Exact spelling is preserved; no normalization or master rebuild. Counts are dictionary token',
        'occurrences across entries and parts of speech, not PDF frequency or unique word count.',
        'Grouping uses the first character, not necessarily the consonant that binds a vowel in a stack.',
        f'ော includes ာ; ေါ includes ါ. Tokens containing both: {len(both)}.',
        '',
        'CONTEXT OBSERVATIONS',
        '- ါ occurs with these initial characters: ' + ' '.join(categories['ါ']['byInitialCharacter']),
        f"- Tokens with ျ or ြ before ာ: {len(categories['ာ']['withYaOrRaBeforeVowel'])}; before ါ: {len(categories['ါ']['withYaOrRaBeforeVowel'])}.",
        '- Examples: ဂါ / ဂျာ, ခါ / ချာ / ခြာ, ပါ / ပျာ / ပြာ.',
        '- No ဂျါ or other ျ/ြ + ါ token occurs in this dictionary. Absence alone is not universal proof.',
        '- Other medials and stacks are separate cases: ငှာ and ငှါ, ပ္ပာ and ပ္ပါး all appear as stored.',
        '- ာ (U+102C) and ါ (U+102B) are distinct Unicode characters; this is separate from glyph variants of ု (U+102F).',
    ]
    if both:
        lines.append('- Tokens containing both vowels: ' + ', '.join(both))
    for vowel in ('ာ', 'ါ'):
        data = categories[vowel]
        lines.extend(['', '=' * 72,
                      f"{vowel} U+{ord(vowel):04X}: {data['distinctSyllables']} distinct syllables; {data['dictionaryTokenOccurrences']} dictionary token occurrences"])
        for initial, syllables in data['byInitialCharacter'].items():
            lines.append(f"\n{initial} ({len(syllables)}):")
            for index in range(0, len(syllables), 10):
                lines.append('  ' + '  '.join(syllables[index:index + 10]))
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f"ာ: {categories['ာ']['distinctSyllables']}; ါ: {categories['ါ']['distinctSyllables']}")


if __name__ == '__main__':
    main()
