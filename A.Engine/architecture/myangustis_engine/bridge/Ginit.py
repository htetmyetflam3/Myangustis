"""Active POS resolution stage, mirroring main's bridge/Ginit.js.

This is a pass-through for classifier rules, except that the exact two-tag
noun/verb candidate set is collapsed to rbvn. The separate experimental JS
Lexical_No_inspect/abstract/ modules are not wired into this Python stage.
"""
def run_rule_engine(tagged):
    for index, line in enumerate(tagged):
        tokens = []
        for position, token in enumerate(line['tokens']):
            raw = token['rawPos']
            dual = len(raw) == 2 and 'n' in raw and 'v' in raw
            tokens.append({'syllables': token['syllables'], 'ids': token['ids'],
                           'joinedIds': ''.join(token['ids']), 'rawPos': ['rbvn'] if dual else raw,
                           'finalPos': 'rbvn' if dual else (raw[0] if raw else None),
                           'isSingleSyllable': len(token['ids']) == 1, 'isAmbiguous': len(raw) > 1,
                           'position': position, 'matches': []})
        yield {'tokens': tokens, 'isEos': line.get('isEos', False), 'lineIndex': index}
