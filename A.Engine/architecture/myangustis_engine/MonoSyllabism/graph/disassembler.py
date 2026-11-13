"""Syllable and POS tree construction. Imported only by the explicit builder."""
from .shape import get_step, ensure_node, ensure_step, add_pos
from myangustis_engine.MonoSyllabism.utilities.js_string import from_utf16_units, js_trim, utf16_units

STANDALONES = [('၍', 'π000'), ('၌', 'π001'), ('၏', 'π002'), ('ဤ', 'π003'), ('ဪ', 'π004')]
POS_MAP = {'ADJECTIVE': 'aj', 'ADVERB': 'av', 'CONJUNCTION': 'cn', 'INTERJECTION': 'in',
           'NOUN': 'n', 'PRONOUN': 'pn', 'VERB': 'v', 'PARTICLE': 'p', 'WIBAT': 'w', 'RBNV': 'rbvn'}


def finalize_root_steps(root):
    steps = [key for key in root if key.startswith('St-') and key != 'St-F']
    if steps:
        last = max(steps, key=lambda key: int(key[3:]))
        root['St-F'] = root.pop(last)
    return dict(sorted(root.items(), key=lambda item: (item[0] == 'St-F', int(item[0][3:]) if item[0] != 'St-F' else 0)))


def _js_entries(mapping):
    # JavaScript enumerates canonical integer-index object keys first.
    def integer_key(key):
        return key.isascii() and key.isdigit() and str(int(key)) == key and int(key) < 4294967295
    numeric = sorted((key for key in mapping if integer_key(key)), key=int)
    return [(key, mapping[key]) for key in numeric] + [(key, value) for key, value in mapping.items() if not integer_key(key)]


def Bb(lookup_data):
    roots, changes = {}, []
    for root_index, (root, sequences) in enumerate(_js_entries(lookup_data)):
        node = roots.setdefault(root, {})
        for seq_index, (ident, sequence) in enumerate(_js_entries(sequences)):
            tokens = utf16_units(sequence)
            for i, token in enumerate(tokens):
                entries = get_step(node, i + 1)
                entry = next((entry for entry in entries if token in entry), None)
                if entry is None:
                    entry = {token: []}; entries.append(entry)
                if i == len(tokens) - 1:
                    entry[token].append(ident)
                    changes.append({'token': token, 'path': root, 'step': i + 1,
                                    'ids': list(entry[token]), 'note': f'root[{root_index}] seq[{seq_index}]'})
        roots[root] = finalize_root_steps(node)
    return {'data': {'Root': roots}, 'changes': changes}


def build_syllable_lookup(syllables, mapper_normalize):
    entries, suffixes = [], {}
    for syllable in syllables:
        mapped = mapper_normalize(syllable) or ''
        units = utf16_units(mapped)
        base = units[0] if units else 'A'
        body = from_utf16_units(units[1:])
        if body not in suffixes: suffixes[body] = str(len(suffixes) + 1).zfill(3)
        entries.append({'original': syllable, 'mapped': mapped, 'base': base, 'body': body, 'id': suffixes[body]})
    by_base = {}
    for entry in entries: by_base.setdefault(entry['base'], []).append(entry)
    for base, group in by_base.items():
        if not any(e['body'] == '' for e in group):
            entries.insert(0, {'original': utf16_units(group[0]['original'])[0], 'mapped': base, 'base': base, 'body': '', 'id': '000', 'injected': True})
    for original, ident in STANDALONES:
        if not any(e['original'] == original for e in entries):
            mapped = mapper_normalize(original) or original
            entries.append({'original': original, 'mapped': mapped, 'base': mapped, 'body': '', 'id': ident, 'standalone': True})
    def full_id(entry): return entry['id'] if entry.get('standalone') else entry['base'] + entry['id']
    mapped_lines = [f'"{e["original"]}" : "{e["mapped"]}" : "{full_id(e)}"' for e in entries]
    ref = [{'original': e['original'], 'mapped': e['mapped'], 'id': full_id(e)} for e in entries]
    grouped = {}
    for entry in entries: grouped.setdefault(entry['base'], {})[entry['id']] = '' if entry['id'] == '000' else entry['body']
    def suffix_sort(value):
        if value == '000': return (-1, 0)
        try: return (0, int(value))
        except ValueError: return (0, 0)
    grouped = {base: dict(sorted(values.items(), key=lambda x: suffix_sort(x[0]))) for base, values in sorted(grouped.items(), key=lambda item: utf16_units(item[0]))}
    rtl = {}
    for root, items in grouped.items():
        for ident, body in items.items():
            reverse = body[::-1]
            rtl.setdefault(f'St-{len(utf16_units(reverse))}', {}).setdefault(reverse, {}).setdefault(ident, []).append(root)
    rtl = dict(sorted(rtl.items(), key=lambda x: int(x[0][3:])))
    return {'lookupData': grouped, 'mappedLines': mapped_lines, 'refArray': ref, 'rtlGrouped': rtl, 'entries': entries}


def extract_pos_data(master):
    source = master['dictionary'] if 'dictionary' in master and master['dictionary'] is not None and master['dictionary'] is not False else master
    return source, {key: value for key, value in source.items() if key not in ('syllables', 'SPLIT') and isinstance(value, list)}


def build_pos_tree(syllable_to_id, pos_data):
    tree, failures = {}, []
    for key, lines in pos_data.items():
        if key in ('syllables', 'SPLIT'): continue
        tag = POS_MAP.get(key, key)
        for line in lines:
            if not isinstance(line, str) or not line: continue
            syllables = [js_trim(s) for s in line.split('  ') if js_trim(s)]
            if not syllables: continue
            missing = [s for s in syllables if s not in syllable_to_id]
            if missing:
                failures.append({'jsonKey': key, 'pos': tag, 'line': line, 'missing': missing}); continue
            ids = [syllable_to_id[s] for s in syllables]
            node = ensure_node(tree, ids[0])
            for index, ident in enumerate(ids[1:], 1): node = ensure_step(node, index).setdefault(ident, {})
            add_pos(node.setdefault('x', []), tag)
    return {'tree': tree, 'failedEntries': failures}
