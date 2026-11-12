from myangustis_engine.MonoSyllabism.utilities.js_string import utf16_units, from_utf16_units



def walk_reverse(tree, syllable, root):
    body = from_utf16_units(utf16_units(syllable)[1:])
    if not body:
        return {'action': 'continue', 'id': None}
    reverse = body[::-1]
    entry = tree.get(f'St-{len(utf16_units(reverse))}', {}).get(reverse, {})
    for suffix, roots in entry.items():
        if root in roots:
            return {'action': 'continue', 'id': root + suffix}
    return {'action': 'continue', 'id': None}
