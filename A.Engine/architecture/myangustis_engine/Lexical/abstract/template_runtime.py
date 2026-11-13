"""First, limited runtime for the owner's sentence templates.

The msp-03 and msp-04 probes nest a noun unit under a sentence-ending
verb root. Other structures, including one-sided fallbacks, remain pending.
"""
from copy import deepcopy
import unicodedata

from myangustis_engine.secure_data.secure import load_template_data, read_master_json


def _surface(token):
    return ''.join(token['syllables']).replace('<eos>', '')


def _key(surface):
    """Canonical Unicode matching while retaining original surfaces in evidence."""
    return unicodedata.normalize('NFC', surface)


def _tags(token):
    raw = set(token['rawPos'])
    if 'rbvn' in raw:
        raw.update(('n', 'v'))
    return raw


def _verb_markers(data):
    """Collect verb-family surfaces, including unresolved disambiguate entries."""
    result = {}
    for source in ('LSE_Map', 'LSN_Map'):
        for category, tag in (('pyitsi', 'p'), ('wibat', 'w')):
            families = data.get(source, {}).get(category, {}).get('verb', {})
            for family, entries in families.items():
                if not isinstance(entries, list):
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


def _family_entries(data, category, family, tag):
    """Preserve source/category provenance, including ambiguity declarations."""
    surfaces = {}
    for source in ('LSE_Map', 'LSN_Map'):
        entries = data.get(source, {}).get(category, {}).get(family, {})
        for kind, words in entries.items():
            if isinstance(words, list):
                for word in words:
                    if isinstance(word, str):
                        surfaces.setdefault(word, []).append({
                            'source': source, 'category': category, 'family': family,
                            'type': kind, 'tag': tag})
    return surfaces


def _noun_verb_candidate(tokens, data, ident):
    """Try the defined N/V slots using a final verb unit, retaining alternatives."""
    templates = data['Templates']
    template = templates[ident]
    parent = templates.get('msp-01', {})
    head = template.get('head') or {}
    root = head.get('root') or {}
    children = root.get('children') or []
    parent_root = (parent.get('head') or {}).get('root') or {}
    if not (template.get('seq') == ['n', 'v']
            and template.get('parser') == 'head-primary'
            and 'msp-01' in template.get('inherit', [])
            and parent_root.get('slot') == root.get('slot') == 'V'
            and parent_root.get('posFamily') == root.get('posFamily') == 'verb'
            and len(children) == 1 and children[0].get('slot') == 'N1'
            and children[0].get('posFamily') == 'noun'
            and (ident != 'msp-04' or (children[0].get('must') == 'has_locative_particle'
                                       and 'msp-03' in template.get('inherit', [])))):
        return {'id': ident, 'status': 'not_implemented', 'analyses': [],
                'note': 'The declaration does not match the supported N/V structure.'}
    verb_markers = _verb_markers(data)
    noun_wibat = _family_entries(data, 'wibat', 'noun', 'w')
    analyses = []
    # Verb roots are considered from the ending inward. A following token must
    # be accounted for as a listed verb-family modifier, not simply skipped.
    for root_index in range(len(tokens) - 1, 0, -1):
        if 'v' not in _tags(tokens[root_index]):
            continue
        modifiers = []
        for index in range(root_index + 1, len(tokens)):
            token = tokens[index]
            candidates = verb_markers.get(_surface(token), set()) & _tags(token)
            if not candidates:
                break
            modifiers.append({'token_index': index, 'surface': _surface(token),
                              'rawPos': list(token['rawPos']),
                              'selected_candidates': sorted(candidates)})
        else:
            prefix = tokens[:root_index]
            # A final noun wibat may follow the noun unit. Its type is evidence,
            # not a resolved category; an overlapping disambiguate entry stays.
            marker = None
            marker_entries = noun_wibat.get(_surface(prefix[-1]), [])
            if marker_entries and 'w' in _tags(prefix[-1]):
                marker = {'token_index': root_index - 1,
                          'surface': _surface(prefix[-1]),
                          'rawPos': list(prefix[-1]['rawPos']),
                          'candidates': deepcopy(marker_entries)}
                prefix = prefix[:-1]
            if not prefix or not all(_tags(token) & {'n', 'pn'} for token in prefix):
                continue
            if ident == 'msp-04' and not (marker and any(
                    item['type'] == 'နေရာပြဝိဘတ်' for item in marker['candidates'])):
                continue
            bound_head = deepcopy(head)
            bound_root = bound_head['root']
            bound_root['evidence'] = _token_evidence(tokens[root_index], root_index, 'v')
            noun = bound_root['children'][0]
            noun['evidence'] = [_token_evidence(t, i, 'n' if 'n' in _tags(t) else 'pn')
                                for i, t in enumerate(prefix)]
            if marker:
                noun['marker_evidence'] = marker
            analyses.append({'head': bound_head, 'tail': deepcopy(template.get('tail')),
                             'inherit': list(template['inherit']),
                             'verb_unit_modifiers': modifiers})
    if not analyses:
        return {'id': ident, 'status': 'unresolved', 'analyses': [],
                'note': 'No supported complete N/V binding; wider units, missing tags or markers may need further parsing.'}
    return {'id': ident, 'status': 'possible', 'analyses': analyses,
            'note': ('Structural candidates only; noun role, modifier order, overlapping '
                     'marker categories, and competing templates remain unresolved.')}


def _ending_evidence(tokens, template):
    """Recognise only the explicit msp-05 ending; don't claim a noun-group parse."""
    if (template.get('seq') != ['n', 'pt'] or template.get('parser') != 'tail-only'
            or ((template.get('tail') or {}).get('pe') or {}).get('must') != 'end_with_သာတည်း_တည်း'):
        return {'id': 'msp-05', 'status': 'not_implemented', 'analyses': [],
                'note': 'The declaration does not match the supported ending check.'}
    surfaces = [_surface(t) for t in tokens]
    ending = None
    if len(surfaces) >= 2 and surfaces[-2:] == ['သာ', 'တည်း']:
        ending = [len(tokens) - 2, len(tokens) - 1]
    elif surfaces and surfaces[-1] in ('သာတည်း', 'တည်း'):
        ending = [len(tokens) - 1]
    return {'id': 'msp-05', 'status': 'unresolved', 'analyses': [],
            'ending_evidence': [{'token_index': i, 'surface': surfaces[i],
                                 'rawPos': list(tokens[i]['rawPos'])} for i in (ending or [])],
            'note': 'Ending evidence only; the noun-group sequence and pt slot are not yet resolved.'}


def _resolution_index(resolution):
    """Index explicit single-form style assertions without collapsing roles."""
    index = {}
    for surface, entry in resolution.get('single', {}).items():
        default = entry.get('default', '')
        style = next((s for s in ('LSE', 'LSN') if default.startswith('!' + s + ':')
                      or default == '!' + s), None)
        if style:
            index.setdefault(_key(surface), []).append({'style': style, 'source': surface,
                                                  'path': 'default', 'rule': default})
        for variant_style, variants in entry.get('style', {}).items():
            if variant_style not in ('LSE', 'LSN') or not isinstance(variants, dict):
                continue
            for category, values in variants.items():
                for value in values if isinstance(values, list) else [values]:
                    if isinstance(value, str):
                        index.setdefault(_key(value), []).append({
                            'style': variant_style, 'source': surface,
                            'path': 'style.' + variant_style + '.' + category,
                            'rule': default})
    return index


def _sentence_style(tokens, resolution):
    """Scan pe-group candidates right-to-left; first style discriminator wins."""
    index = _resolution_index(resolution)
    scanned = []
    selected = None
    for i in range(len(tokens) - 1, -1, -1):
        token = tokens[i]
        # POS candidates, not unconditional substring matches. 'cn' is the
        # conjunction candidate used by the tagger; a style-bearing connector
        # can be listed in resolution.single too.
        if not _tags(token) & {'w', 'p', 'cn'}:
            continue
        evidence = index.get(_key(_surface(token)), [])
        styles = sorted({item['style'] for item in evidence})
        scanned.append({'token_index': i, 'surface': _surface(token),
                        'rawPos': list(token['rawPos']), 'styles': styles,
                        'sources': deepcopy(evidence)})
        if len(styles) == 1:
            selected = styles[0]
            break
    # Once a style is chosen, expose applicable resolution rules for all
    # pe-group candidates, not just the first one. Multiple grammatical paths
    # are retained rather than resolved from style alone.
    applications = []
    if selected:
        for i, token in enumerate(tokens):
            if not _tags(token) & {'w', 'p', 'cn'}:
                continue
            rules = [e for e in index.get(_key(_surface(token)), []) if e['style'] == selected]
            if rules:
                applications.append({'token_index': i, 'surface': _surface(token),
                                     'rawPos': list(token['rawPos']),
                                     'rules': deepcopy(rules)})
    return {'status': 'selected' if selected else 'unresolved', 'value': selected,
            'scan': scanned, 'applications': applications,
            'note': ('Selected from the first distinguishing pe-group POS candidate; '
                     'raw POS ambiguity and grammatical role remain visible.' if selected else
                     'No distinguishing known pe-group candidate; style is unresolved.')}



# MOR-02: owner-maintained list, to be extended; match the ending of the
# candidate noun unit immediately before က, independent of token boundaries.
_MOR_02_TIME_ENDINGS = (
    'နာရီ', 'အချိန်', 'တုန်း', 'ရက်', 'လ', 'နှစ်', 'ခုနှစ်', 'မိနစ်', 'စဉ်', 'ခိုက်',
)


def _mor_02_ka_role(noun, marker):
    """Distinguish time from place for a candidate noun unit followed by က.

    This does not decide whether the token is a marker or whether the noun
    boundary is correct. The owner-provided default is place even when the
    incomplete time list does not recognise a time expression.
    """
    if _key(marker) != _key('က'):
        return None
    surface = _key(''.join(t['surface'] for t in noun))
    matches = [word for word in _MOR_02_TIME_ENDINGS if surface.endswith(_key(word))]
    matched = max(matches, key=lambda word: len(_key(word))) if matches else None
    return {'rule_id': 'MOR-02', 'result': 'time' if matched else 'place',
            'matched_ending': matched, 'noun_surface': ''.join(t['surface'] for t in noun),
            'marker': marker, 'basis': 'listed-time-ending' if matched else 'default-place'}


def _pe_boundary_filter(analyses):
    """Reject a noun span crossing a pe bound in a fuller complete binding.

    Compare only candidates with the same verb unit and existing marker
    positions. Incomparable bindings remain alternatives; raw POS alone never
    proves a marker, and no token is retagged. Return discarded candidates and
    their boundary evidence for inspection.
    """
    def signature(analysis):
        markers, nouns = set(), set()
        node = analysis['head']['root']['children'][0]
        while node:
            if node.get('evidence'):
                markers.add(node['evidence']['token_index'])
                nouns.update(t['token_index'] for t in node['child']['evidence'])
            node = node.get('next')
        root = analysis['head']['root']['evidence']['token_index']
        prefix = tuple(t['token_index'] for t in analysis['verb_prefix_candidates'])
        suffix = tuple(t['token_index'] for t in analysis['verb_suffix_candidates'])
        return (root, prefix, suffix), markers, nouns

    signatures = [signature(a) for a in analyses]
    kept, rejected = [], []
    for i, analysis in enumerate(analyses):
        anchor, markers, noun_indices = signatures[i]
        blockers = []
        for other_anchor, other_markers, _ in signatures:
            if anchor == other_anchor and markers < other_markers:
                blockers.extend((other_markers - markers) & noun_indices)
        if blockers:
            rejected.append({'reason': 'crosses_selected_pe_in_complete_binding',
                             'boundary_token_indices': sorted(set(blockers)),
                             'analysis': analysis})
        else:
            kept.append(analysis)
    return kept, rejected


def _msp06_candidate(tokens, data, master, style):
    """Probe the declared subject and optional noun-wibat role chain."""
    template = data['Templates']['msp-06']
    head = template.get('head') or {}
    root = head.get('root') or {}
    children = root.get('children') or []
    subject = children[0] if len(children) == 1 else {}
    source = subject.get('next') or {}
    if not (template.get('seq') == ['n', 'v'] and template.get('parser') == 'head-primary'
            and root.get('slot') == 'V' and root.get('posFamily') == 'verb'
            and subject.get('class') == 'subject-marker' and source.get('class') == 'source'):
        return {'id': 'msp-06', 'status': 'not_implemented', 'analyses': [],
                'note': 'The declaration does not match the supported subject/source structure.'}
    selected = style.get('value')
    if not selected:
        return {'id': 'msp-06', 'status': 'unresolved', 'analyses': [],
                'note': 'A selected sentence style is required for the subject/source probe.'}
    top = master.get('top', {}).get('wibat', {})
    noun_types = top.get('n', {})
    verb_wibat = {w for words in top.get('v', {}).values() if isinstance(words, list) for w in words}
    resolution = _resolution_index(master.get('resolution', {}))
    verb_markers = _verb_markers(data)

    # Map the template's role names to the owner's existing master categories.
    # These remain alternatives, not decisions about a particular occurrence.
    role_types = {'subject-marker': ('ကတ္တား',),
                  'source': ('ထွက်ခွာရာပြ',),
                  'goal': ('ရှေးရှုရာပြ', 'ဆိုက်ရောက်ရာပြ'),
                  'instrument': ('အသုံးခံပြ',),
                  'comitative|temporal': ('ယှဉ်တွဲပြ', 'အချိန်ပြ', 'အချိန်ဆက်တိုက်ပြ')}
    nodes = []
    node = subject
    while node:
        if node.get('class') not in role_types or not isinstance(node.get('child'), dict):
            return {'id': 'msp-06', 'status': 'not_implemented', 'analyses': [],
                    'note': 'The role chain differs from the supported template declaration.'}
        nodes.append(node)
        node = node.get('next')

    def marker_options(token, role):
        if 'w' not in _tags(token):
            return []
        results = []
        for rule in resolution.get(_key(_surface(token)), []):
            if rule['style'] != selected:
                continue
            default_category = rule['rule'].partition(':')[2]
            path_category = (default_category if rule['path'] == 'default' else
                             rule['path'].split('.', 2)[2])
            if path_category == '!default':
                path_category = default_category
            for kind in role_types[role]:
                allowed = {_key(w) for w in noun_types.get(kind, [])}
                # Exact category path, or a top-level category associated with
                # the same source surface. Top membership is kept as evidence
                # because a single surface may have several roles.
                if (_key(rule['source']) in allowed and
                        (path_category == kind + '.w' or rule['path'] == 'default')):
                    results.append({**deepcopy(rule), 'noun_type': kind,
                                    'category_evidence': ('resolution' if path_category == kind + '.w'
                                                          else 'top')})
        return results

    def noun_span(start, stop):
        span = tokens[start:stop]
        if not span:
            return None
        # A missing dictionary entry can fragment a name into misleading POS
        # candidates as well as {?}. Retain the entire marker-bounded span as
        # a conditional noun-unit candidate; never relabel its individual tags.
        contains_unknown = any('?' in _tags(t) for t in span)
        if contains_unknown:
            if any(not (_tags(t) & {'n', 'pn', 'r', '?', 'w', 'p', 'cn'}) for t in span):
                return None
        elif (not any(_tags(t) & {'n', 'pn'} for t in span) or
              any(not (_tags(t) & {'n', 'pn', 'r'}) for t in span)):
            return None
        return [{'token_index': i, 'surface': _surface(tokens[i]),
                 'rawPos': list(tokens[i]['rawPos']),
                 'status': ('unresolved' if contains_unknown or not (_tags(tokens[i]) & {'n', 'pn'})
                            else 'candidate')}
                for i in range(start, stop)]

    if len(tokens) > 128:
        return {'id': 'msp-06', 'status': 'unresolved', 'analyses': [],
                'note': 'Sentence exceeds the current experimental search limit.'}
    results = []
    attempts = 0
    truncated = False
    for vi in range(len(tokens) - 1, 0, -1):
        if 'v' not in _tags(tokens[vi]):
            continue
        suffix = []
        for j in range(vi + 1, len(tokens)):
            token = tokens[j]
            tags = verb_markers.get(_surface(token), set()) & _tags(token)
            style_wibat = any(rule['style'] == selected and
                               rule['path'].split('.')[-2:] in (
                                   ['ပစ္စုပ္ပန်ကာလပြ', 'w'], ['အတိတ်ကာလပြ', 'w'])
                               for rule in resolution.get(_key(_surface(token)), []))
            if 'w' in _tags(token) and (_surface(token) in verb_wibat or style_wibat):
                tags.add('w')
            if not tags:
                break
            suffix.append({'token_index': j, 'surface': _surface(token),
                           'rawPos': list(token['rawPos']), 'candidates': sorted(tags)})
        else:
            # The chosen noun wibat(s) end before any verb-unit prefix.
            for cut in range(vi, 0, -1):
                prefix = []
                for j in range(cut, vi):
                    token = tokens[j]
                    tags = verb_markers.get(_surface(token), set()) & _tags(token)
                    if not tags:
                        break
                    prefix.append({'token_index': j, 'surface': _surface(token),
                                   'rawPos': list(token['rawPos']), 'candidates': sorted(tags)})
                else:
                    # Match the required subject and any later roles in the
                    # declared chain, allowing optional roles to be skipped.
                    # Every token before the verb unit must be accounted for.
                    def bind_roles(start, first_role, bindings):
                        nonlocal attempts, truncated
                        attempts += 1
                        if attempts > 5000 or len(results) >= 100:
                            truncated = True
                            return
                        if start == cut:
                            if bindings:
                                yield bindings
                            return
                        for role_index in range(first_role, len(nodes)):
                            if not bindings and role_index != 0:
                                break
                            role_node = nodes[role_index]
                            for marker_index in range(start + 1, cut):
                                rules = marker_options(tokens[marker_index], role_node['class'])
                                noun = noun_span(start, marker_index)
                                if not rules or noun is None:
                                    continue
                                # Apply only to the time/place alternatives, not
                                # subject က or unrelated comitative candidates.
                                decision = _mor_02_ka_role(noun, _surface(tokens[marker_index]))
                                role = role_node['class']
                                if decision and role == 'source' and decision['result'] == 'time':
                                    continue
                                if decision and role == 'comitative|temporal' and decision['result'] == 'place':
                                    rules = [r for r in rules if r['noun_type'] not in
                                             ('အချိန်ပြ', 'အချိန်ဆက်တိုက်ပြ')]
                                if rules:
                                    if decision and role in ('source', 'comitative|temporal'):
                                        rules = [{**r, 'context_rule': deepcopy(decision)}
                                                 if (role == 'source' or r['noun_type'] in
                                                     ('အချိန်ပြ', 'အချိန်ဆက်တိုက်ပြ')) else r
                                                 for r in rules]
                                    yield from bind_roles(marker_index + 1, role_index + 1,
                                                          bindings + [(role_index, marker_index, noun, rules)])
                    for bindings in bind_roles(0, 0, []):
                        bound = deepcopy(head)
                        boundroot = bound['root']
                        boundroot['evidence'] = _token_evidence(tokens[vi], vi, 'v')
                        current = boundroot['children'][0]
                        bound_nodes = []
                        while current:
                            bound_nodes.append(current)
                            current = current.get('next')
                        all_nouns = []
                        for role_index, marker_index, noun, rules in bindings:
                            item = bound_nodes[role_index]
                            item['evidence'] = {'token_index': marker_index,
                                                'surface': _surface(tokens[marker_index]),
                                                'rawPos': list(tokens[marker_index]['rawPos']),
                                                'rules': rules}
                            item['child']['evidence'] = noun
                            item['child']['unit_candidate'] = {
                                'surface': ''.join(t['surface'] for t in noun),
                                'status': ('conditional' if any(t['status'] == 'unresolved' for t in noun)
                                           else 'candidate'),
                                'note': 'A noun-unit candidate, not a confirmed proper name or POS override.'}
                            all_nouns.extend(noun)
                        results.append({'head': bound, 'tail': deepcopy(template.get('tail')),
                                        'verb_prefix_candidates': prefix,
                                        'verb_suffix_candidates': suffix,
                                        'bound_slots': [nodes[i]['slot'] for i, _, _, _ in bindings],
                                        'unresolved_noun_tokens': [t for t in all_nouns
                                                                   if t['status'] == 'unresolved']})
    results, rejected = _pe_boundary_filter(results)
    return {'id': 'msp-06', 'status': 'possible' if results else 'unresolved',
            'analyses': results, 'rejected_analyses': rejected, 'search_truncated': truncated,
            'note': ('Noun-wibat role-chain candidate only; unknown and ambiguous noun pieces, '
                     'other roles, verb-unit order and competing structures require resolution.'
                     if results else 'No supported role-chain binding; missing tags and unsupported units remain unresolved.')}



def _fronted_evidence(tokens, template, master, style):
    """Collect fronted-topic marker evidence without approving msp-07."""
    if (template.get('frontedRule') != 'outermost_N_is_TOPIC'
            or 'msp-06' not in template.get('inherit', [])
            or template.get('seq') != ['n', 'n', 'v']):
        return {'id': 'msp-07', 'status': 'not_implemented', 'analyses': [],
                'note': 'The declaration does not match the supported fronted-topic probe.'}
    selected = style.get('value')
    index = _resolution_index(master.get('resolution', {}))
    evidence = []
    if selected:
        for i, token in enumerate(tokens):
            if 'w' not in _tags(token):
                continue
            rules = [r for r in index.get(_key(_surface(token)), []) if r['style'] == selected]
            if rules:
                evidence.append({'token_index': i, 'surface': _surface(token),
                                 'rawPos': list(token['rawPos']), 'rules': deepcopy(rules)})
    return {'id': 'msp-07', 'status': 'unresolved', 'analyses': [],
            'frontedRule': template['frontedRule'], 'inherit': list(template['inherit']),
            'marker_evidence': evidence,
            'note': 'Marker evidence only; fronted topic and omitted markers are not parsed yet.'}


def analyse_sentence(tokens, *, complete, data=None, resolution=None, master=None):
    """Probe a narrow nested N/V structure; do not prematurely approve fallbacks."""
    if data is None:
        data = load_template_data()
    templates = data['Templates']
    if master is None:
        master = read_master_json()
    if resolution is None:
        resolution = master.get('resolution', {})
    style = (_sentence_style(tokens, resolution) if complete else
             {'status': 'unresolved', 'value': None, 'scan': [], 'applications': [],
              'note': 'A Burmese full stop is required.'})
    # One-sided fallbacks stay pending while broader templates are incomplete.
    reports = []
    for ident in templates:
        if complete and ident in ('msp-03', 'msp-04'):
            reports.append(_noun_verb_candidate(tokens, data, ident))
            continue
        if complete and ident == 'msp-06':
            reports.append(_msp06_candidate(tokens, data, master, style))
            continue
        if complete and ident == 'msp-07':
            reports.append(_fronted_evidence(tokens, templates[ident], master, style))
            continue
        if complete and ident == 'msp-05':
            reports.append(_ending_evidence(tokens, templates[ident]))
            continue
        if not complete:
            status = 'unresolved'
            note = 'A Burmese full stop is required for this initial probe.'
        elif ident in ('msp-01', 'msp-02'):
            status = 'pending_fallback'
            note = 'One-sided fallback is not evaluated before the two-piece stage.'
        else:
            status = 'not_implemented'
            note = 'This template is not implemented yet.'
        reports.append({'id': ident, 'status': status, 'analyses': [], 'note': note})
    return {'complete': complete, 'tokens': tokens, 'style': style, 'templates': reports}


def analyse_lines(lines, data=None, resolution=None):
    """Split POS batches at Burmese full stops, without joining sentences."""
    if data is None:
        data = load_template_data()
    master = read_master_json()
    if resolution is None:
        resolution = master.get('resolution', {})
    pending = []
    for line in lines:
        for token in line['tokens']:
            if any(s.endswith('<eos>') for s in token['syllables']):
                if pending:
                    yield analyse_sentence(pending, complete=True, data=data, resolution=resolution, master=master)
                    pending = []
            else:
                pending.append(token)
    if pending:
        yield analyse_sentence(pending, complete=False, data=data, resolution=resolution, master=master)
