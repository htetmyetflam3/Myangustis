"""First, limited runtime for the owner's sentence templates.

Only msp-01 (head-only verb unit) and msp-02 (tail-only noun sequence) are
implemented. This is an opt-in structural probe, not a general grammar parser.
"""
from copy import deepcopy

from myangustis_engine.secure_data.secure import load_template_data


def _surface(token):
    return ''.join(token['syllables']).replace('<eos>', '')


def _tags(token):
    raw = set(token['rawPos'])
    if 'rbvn' in raw:
        raw.update(('n', 'v'))
    return raw


def _verb_markers(data):
    """Collect explicitly listed verb-family surfaces; no type is resolved."""
    result = {}
    for source in ('LSE_Map', 'LSN_Map'):
        for category, tag in (('pyitsi', 'p'), ('wibat', 'w')):
            families = data.get(source, {}).get(category, {}).get('verb', {})
            for family, entries in families.items():
                if family == 'disambiguate' or not isinstance(entries, list):
                    continue
                for surface in entries:
                    if isinstance(surface, str):
                        result.setdefault(surface, set()).add(tag)
    return result


def _token_evidence(token, index, selected):
    return {'token_index': index, 'surface': _surface(token),
            'rawPos': list(token['rawPos']), 'selected': selected}


def _head_only(tokens, data, template):
    """Bind one verb root and explicitly listed verb-family modifiers."""
    markers = _verb_markers(data)
    analyses = []
    for root_index, root in enumerate(tokens):
        if 'v' not in _tags(root):
            continue
        modifiers = []
        for index, token in enumerate(tokens):
            if index == root_index:
                continue
            candidates = markers.get(_surface(token), set()) & _tags(token)
            if not candidates:
                break
            modifiers.append({'token_index': index, 'surface': _surface(token),
                              'rawPos': list(token['rawPos']),
                              'selected_candidates': sorted(candidates)})
        else:
            head = deepcopy(template['head'])
            head['root']['evidence'] = _token_evidence(root, root_index, 'v')
            analyses.append({'head': head, 'verb_unit_modifiers': modifiers,
                             'tail': deepcopy(template['tail'])})

    if analyses:
        return {'id': 'msp-01', 'status': 'matched', 'analyses': analyses,
                'note': ('Structural candidate only: modifier category is not resolved, '
                         'and lexical/semantic validity and order rules are not yet evaluated.')}
    return {'id': 'msp-01', 'status': 'unresolved', 'analyses': [],
            'note': ('No complete binding from the current POS candidates and explicitly '
                     'listed verb-family markers; tokenization or tags may be incomplete.')}


def _tail_only(tokens, template):
    """Bind a noun-only word sequence immediately before the full stop."""
    if tokens and all('n' in _tags(token) for token in tokens):
        tail = deepcopy(template['tail'])
        tail['words'] = [_token_evidence(t, i, 'n') for i, t in enumerate(tokens)]
        return {'id': 'msp-02', 'status': 'matched',
                'analyses': [{'head': None, 'tail': tail, 'st': template.get('st')}],
                'note': 'Structural candidate only; noun candidates may be ambiguous.'}
    return {'id': 'msp-02', 'status': 'unresolved', 'analyses': [],
            'note': 'No complete noun sequence with the current POS candidates; more tail forms are not implemented.'}


def analyse_sentence(tokens, *, complete, data=None):
    """Evaluate the two supported templates without changing tagger candidates."""
    if data is None:
        data = load_template_data()
    templates = data['Templates']
    reports = []
    for ident, template in templates.items():
        if not complete:
            result = {'id': ident, 'status': 'unresolved', 'analyses': [],
                      'note': 'A Burmese full stop is required for this initial probe.'}
        elif (ident == 'msp-01' and template.get('parser') == 'head-only'
              and template.get('seq') == ['v']
              and template.get('head', {}).get('root', {}).get('posFamily') == 'verb'
              and template.get('tail', {}).get('status') == 'reject'):
            result = _head_only(tokens, data, template)
        elif (ident == 'msp-02' and template.get('parser') == 'tail-only'
              and template.get('seq') == ['n'] and template.get('head') is None
              and template.get('tail', {}).get('posFamily') == 'noun'
              and template.get('tail', {}).get('must') == 'end_with_punctuation'):
            result = _tail_only(tokens, template)
        else:
            result = {'id': ident, 'status': 'not_implemented', 'analyses': [],
                      'note': 'This template is not implemented in the initial probe.'}
        reports.append(result)
    return {'complete': complete, 'tokens': tokens, 'templates': reports}


def analyse_lines(lines, data=None):
    """Split POS batches at Burmese full stops, without joining sentences."""
    if data is None:
        data = load_template_data()
    pending = []
    for line in lines:
        for token in line['tokens']:
            if any(s.endswith('<eos>') for s in token['syllables']):
                if pending:
                    yield analyse_sentence(pending, complete=True, data=data)
                    pending = []
            else:
                pending.append(token)
    if pending:
        yield analyse_sentence(pending, complete=False, data=data)
