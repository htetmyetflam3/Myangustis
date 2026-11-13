"""Active POS resolution stage, mirroring main's bridge/Ginit.js.

The lexical stage is a pass-through for classifier rules. This active bridge
also preserves the JS owner rule: exactly the noun/verb candidates become rbvn.
"""
from myangustis_engine.Lexical.abstract.posoverride import (
    run_rule_engine as run_pos_override,
)


def run_rule_engine(tagged):
    for line in run_pos_override(tagged):
        for token in line['tokens']:
            raw = token['rawPos']
            if len(raw) == 2 and 'n' in raw and 'v' in raw:
                token['rawPos'] = ['rbvn']
                token['finalPos'] = 'rbvn'
        yield line
