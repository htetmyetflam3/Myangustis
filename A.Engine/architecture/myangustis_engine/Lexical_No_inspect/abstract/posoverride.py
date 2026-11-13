"""Pass-through POS override stage, mirroring main's abstract/posoverride.js.

No classifiers or override rules run here yet. A future rule implementation can
be added here; the active bridge applies its existing noun/verb rule afterwards.
"""


def run_rule_engine(tagged_lines, hash=None):
    """Yield resolved line objects without changing tagger POS candidates.

    ``hash`` is accepted for API parity with JS; the pass-through does not use it.
    JS's undefined finalPos for an empty rawPos is represented as None in Python.
    """
    for line_index, line in enumerate(tagged_lines):
        resolved = []
        for position, token in enumerate(line['tokens']):
            raw = token['rawPos']
            ids = token['ids']
            resolved.append({
                'syllables': token['syllables'],
                'ids': ids,
                'joinedIds': ''.join(ids),
                'rawPos': raw,
                'finalPos': raw[0] if raw else None,
                'isSingleSyllable': len(ids) == 1,
                'isAmbiguous': len(raw) > 1,
                'position': position,
                'matches': [],
            })
        is_eos = line.get('isEos')
        yield {'tokens': resolved, 'isEos': False if is_eos is None else is_eos,
               'lineIndex': line_index}
