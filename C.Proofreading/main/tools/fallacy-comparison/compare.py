# /// script
# requires-python = ">=3.10"
# dependencies = ["json5>=0.12,<1"]
# ///
"""Read-only rule-aware MT candidate evidence and reference data audit; no API/AI calls.

Tagging is the engine's job, never this process's. Candidate Burmese text is
handed to mt/quality/tag.py (a black box around BindEngine('proofreading'));
we wait for it to finish, then open the raw_pos file it produced and walk it
like any other tagged output. Nothing inside the running tagger is touched.
"""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import os
from difflib import SequenceMatcher

import json5

ROOT = Path(__file__).resolve().parent.parent          # Proofreading/main
REPO = ROOT.parents[1]                                 # repository root
QUALITY_DIR = Path(__file__).resolve().parent / "quality"
sys.path.insert(0, str(QUALITY_DIR))
from tag import tag_text  # noqa: E402  (black box: spawns tag-both.mjs -> BindEngine)

VERSION = 3
REFERENCE = ROOT/'content/kmt-pos/ယဲ့နင်.raw_pos.txt'
WORK = ROOT/'content/mtranslate/comparison'
PROFILE = ROOT/'content/analysis/reference-data-audit.json'

# Current in-repo data sources (data, not engine code): the single sealed
# master lives at the repo root and is read through the root secure.js node
# door — secure.js owns the .env key and the sealed cache, so this audit gets
# the full master (including mapData) without ever holding the key or writing
# a readable JSON copy. The engine's rule notes and the runtime box are
# fingerprinted directly. Normalization is NOT reimplemented here — bindings
# keep their literal surface, so Evidence walks the exact strings the tagger
# emitted.
MASTER_ENC = REPO/'master.json.enc'
SECURE_JS = REPO/'secure.js'
RULES = REPO/'Engine/architecture/knowledge/isTreasure/mainrules.js'
BOX_WASM = REPO/'Engine/architecture/MonoSyllabism/map/box.wasm'

# Family -> tagger code, owner-confirmed vocabulary (rbvn is a kernel override).
POS_CODES = {
    'ADJECTIVE': 'aj', 'ADVERB': 'av', 'CONJUNCTION': 'cn', 'INTERJECTION': 'in',
    'NOUN': 'n', 'PRONOUN': 'pn', 'VERB': 'v', 'PARTICLE': 'p',
    'WIBAT': 'w', 'RBNV': 'rbvn',
}
FAMILIES = {'wibat': 'WIBAT', 'conjunction': 'CONJUNCTION', 'particle': 'PARTICLE',
            'thanbanda': 'CONJUNCTION', 'paccaya': 'PARTICLE'}

POLICY = {
    'phase': 'MT comparison only', 'pos_overrides': False, 'automatic_replacements': False,
    'style_policy': {'default': 'LSE', 'LSE': 'literature style in essay', 'LSN': 'narration style',
                     'quoted_character_speech': 'LSN', 'prose_outside_speech': 'LSE'},
    'composition': 'dictionary components → compound candidates → sentence/clause roles; preserve children and spans',
    'resolution_scope': 'sentence style plus grammatical role; not global particle replacement',
    'contextual_resolution_status': 'pending compound-first sentence/style implementation',
    'default_markers': 'opaque source strings, not interpreted as prohibitions',
    'patterns': 'unresolved patterns retained, not matched as literal words',
    'word_order_constraints': 'review data; not called violations without governing-role analysis',
}


class ComparisonError(Exception):
    pass


def identity(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def atomic_json(path, value):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.comparison-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2); stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)


# ── rule notes (mainrules.js: JSON head + a JSON5 data array) ──────────────

def _rules_document(path=RULES):
    """Whole rules document: JSON head as object, without evaluating JavaScript."""
    text = Path(path).read_text(encoding='utf-8')
    marker = re.search(r'\bconst\s+MYANMAR_GRAMMAR_SEQUENCES\s*=\s*\[', text)
    head = text[:marker.start()] if marker else text
    return json5.loads(head)


def sequence_catalog(path=RULES):
    """Extract the legacy MYANMAR_GRAMMAR_SEQUENCES data array if present.

    The current engine mainrules.js is a pure JSON rule document without that
    JS block; its grammar sections are walked by knowledge() instead. So an
    absent marker is an empty catalog, not an error.
    """
    text = Path(path).read_text(encoding='utf-8')
    marker = re.search(r'\bconst\s+MYANMAR_GRAMMAR_SEQUENCES\s*=\s*\[', text)
    if not marker:
        return []
    start = marker.end()-1; depth = 0; quote = None; comment = None; i = start; end = None
    while i < len(text):
        c = text[i]; n = text[i:i+2]
        if comment == 'line':
            if c == '\n': comment = None
        elif comment == 'block':
            if n == '*/': comment = None; i += 1
        elif quote:
            if c == '\\': i += 1
            elif c == quote: quote = None
        elif n == '//': comment = 'line'; i += 1
        elif n == '/*': comment = 'block'; i += 1
        elif c in "\"'": quote = c
        elif c == '[': depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0: end = i+1; break
        i += 1
    if end is None: raise ComparisonError('Unclosed rule sequence data array')
    try: rules = json5.loads(text[start:end])
    except ValueError: raise ComparisonError('Rule sequence array must be data-only JSON5, not executable JS') from None
    if not isinstance(rules, list): raise ComparisonError('Rule sequences must be an array')
    for item in rules:
        if (not isinstance(item, dict) or not isinstance(item.get('id'), str)
                or not isinstance(item.get('seq'), list) or not item['seq']
                or any(not isinstance(v, str) for v in item['seq'])):
            raise ComparisonError('Invalid rule sequence record')
        if 'particle' in item and not isinstance(item['particle'], str):
            raise ComparisonError('Unsupported particle-guard schema')
    return rules


# ── knowledge catalog (pure data walk over master + rules) ─────────────────

def _classify_form(form):
    if form == 'rule':
        return 'unresolved_reference'
    if re.search(r'…|\.\.\.|-', form):
        return 'pattern_requires_handler'
    return 'literal'


def load_master() -> dict:
    """Read the sealed repo-root master through secure.js (node door).

    secure.js owns the .env key and the sealed cache; Python never holds the
    key and never writes a plaintext copy. Returns the full master including
    mapData, so the annotation hash below covers the same data as the engine.
    """
    if not SECURE_JS.is_file() or not MASTER_ENC.is_file():
        raise ComparisonError(f'sealed master door is missing: {SECURE_JS}')
    script = ("import {readMasterJson} from %s;"
              "process.stdout.write(JSON.stringify(readMasterJson()));"
              % json.dumps(str(SECURE_JS)))
    proc = subprocess.run(['node', '--input-type=module', '-e', script],
                          capture_output=True, text=True)
    if proc.returncode:
        raise ComparisonError(f'secure.js master load failed: {proc.stderr.strip()}')
    master = json.loads(proc.stdout)
    for section in ('top', 'resolution', 'dictionary'):
        if section not in master:
            raise ComparisonError(f'sealed master is missing {section}')
    return master


def knowledge(work=WORK):
    master = load_master()
    if not master.get('top') or not master.get('resolution'):
        raise ComparisonError('Master top/resolution sections are required for comparison')
    rules = _rules_document()
    sequence_rules = sequence_catalog()

    bindings, unresolved, normalizations = [], [], {}

    def normalized(form):
        # No normalizer reimplementation: the audited surface is the literal
        # form, which is exactly what Evidence matches against tagger output.
        normalizations.setdefault(form, form)
        return form

    def add(form, details):
        if not isinstance(form, str) or not form:
            raise ComparisonError(f"Non-string comparison form at {details['data_path']}")
        kind = _classify_form(form)
        if kind != 'literal':
            unresolved.append({**details, 'form': form, 'kind': kind})
            return
        bindings.append({**details, 'form': form, 'normalized': normalized(form)})

    def walk_arrays(value, parts, source, family):
        if isinstance(value, list):
            seen = set()
            for form in value:                       # duplicate evidence counted once
                if form in seen: continue
                seen.add(form)
                add(form, {'source': source, 'data_path': '.'.join(parts), 'role_path': parts,
                           'family': family, 'pos_code': POS_CODES[FAMILIES[family]],
                           'requires_disambiguation': 'disambiguate' in parts})
        elif isinstance(value, dict):
            for key, child in value.items():
                walk_arrays(child, [*parts, key], source, family)
        else:
            raise ComparisonError(f"Unexpected role-data shape at {'.'.join(parts)}")

    for family, value in master['top'].items():
        if family not in FAMILIES: raise ComparisonError(f'Unmapped top family: {family}')
        walk_arrays(value, ['top', family], 'top', family)
    for family in ('wibat', 'thanbanda', 'paccaya'):
        if family in rules:
            walk_arrays(rules[family], ['rules', family], 'rules', family)

    for base, entry in master['resolution']['single'].items():
        if not isinstance(entry, dict): raise ComparisonError('Invalid resolution.single entry')
        add(base, {'source': 'resolution', 'data_path': f'resolution.single.{base}', 'base': base,
                   'relation': 'declared_form', 'declared_default': entry.get('default')})
        for style, contexts in (entry.get('style') or {}).items():
            for context, alternatives in contexts.items():
                for form in (alternatives if isinstance(alternatives, list) else [alternatives]):
                    add(form, {'source': 'resolution',
                               'data_path': f'resolution.single.{base}.style.{style}.{context}',
                               'base': base, 'relation': 'conditional_alternative',
                               'style': style, 'context': context,
                               'declared_default': entry.get('default')})
    # Owner's literal "tonkens" key is preserved, not silently renamed.
    for variant, forms in (master['resolution'].get('group', {}).get('tonkens', {}) or {}).items():
        for form in forms:
            add(form, {'source': 'resolution_group',
                       'data_path': f'resolution.group.tonkens.{variant}', 'variant': variant})

    grammar_rules = []

    def walk_grammar(value, parts):
        if isinstance(value, list):
            for index, child in enumerate(value):
                walk_grammar(child, [*parts, str(index)])
        elif isinstance(value, dict):
            if isinstance(value.get('pattern'), str) or isinstance(value.get('constraint'), str):
                grammar_rules.append({'source_path': '.'.join(parts), **value})
                cues = [*(value.get('particles') or []),
                        *([value['connector']] if isinstance(value.get('connector'), str) else [])]
                for cue in set(cues):
                    add(cue, {'source': 'grammar_cue', 'data_path': '.'.join(parts),
                              'rule_id': value.get('id'),
                              'scope': 'lexical_cue_only_not_a_clause_parse'})
            for key, child in value.items():
                walk_grammar(child, [*parts, key])

    for key, value in rules.items():
        if key not in ('wibat', 'thanbanda', 'paccaya'):
            walk_grammar(value, [key])

    comparison_data = {'top': master['top'], 'resolution': master['resolution'], 'rules': rules}
    annotation_data = {'dictionary': master['dictionary'], 'mapData': master['mapData']}
    obj = {
        'schema_version': 1,
        'sources': {'master': str(MASTER_ENC.relative_to(REPO)), 'master_sha256': file_hash(MASTER_ENC),
                    'rules': str(RULES.relative_to(REPO)), 'rules_sha256': file_hash(RULES),
                    'box_wasm_sha256': file_hash(BOX_WASM)},
        'comparison_data_sha256': identity(comparison_data),
        'tag_data_sha256': identity(annotation_data),
        'wasm_sha256': file_hash(BOX_WASM),
        'pos_codes': POS_CODES, 'bindings': bindings, 'unresolved': unresolved,
        'normalizations': normalizations, 'grammar_rules': grammar_rules,
        'grammar_section_sizes': {key: len(value) for key, value in rules.items()},
        'resolution': master['resolution'], 'policy': POLICY,
        'sequence_rules': sequence_rules,
    }
    obj['knowledge_fingerprint'] = identity({
        'version': VERSION, 'data': obj['comparison_data_sha256'], 'sequences': sequence_rules,
        'wasm': obj['wasm_sha256'], 'policy': obj['policy'], 'pos_codes': obj['pos_codes'],
        'evaluator': file_hash(Path(__file__))})
    return obj


# ── tagged-output walking (files only; the tagger itself is a black box) ───

def read_tagged(text):
    """Decode the owner's two-space raw-POS FORMAT contract, not tokenize Burmese."""
    for line_number, line in enumerate(text.splitlines(), 1):
        tokens = []
        for part in line.split('  '):
            if not part: continue
            match = re.fullmatch(r'(.*)\{([^{}]+)\}', part)
            if match:
                tags = match[2].split(',')
                if not match[1] or any(not value for value in tags):
                    raise ComparisonError(f'Invalid raw-POS token on line {line_number}')
                tokens.append({'surface': match[1], 'raw_pos': tags, 'boundary': False})
            elif part.endswith('<eos>'):
                tokens.append({'surface': part.removesuffix('<eos>'), 'raw_pos': [], 'boundary': True})
            else:
                raise ComparisonError(f'Unrecognized owner raw-POS format on output line {line_number}')
        yield tokens


class Evidence:
    def __init__(self, data):
        self.data = data; self.trie = {}; self.bindings = data['bindings']
        for index, binding in enumerate(self.bindings):
            text = binding['normalized']
            if not text: continue
            node = self.trie
            for ch in text: node = node.setdefault(ch, {})
            node.setdefault(None, []).append(index)
        # Composition/grammar descriptors, not flat aliases to raw POS.
        word_results = {'compound_noun', 'compound_verb', 'compound_adj', 'compound_adv'}
        self.compound_rules = [r for r in data['sequence_rules'] if r.get('result') in word_results]
        self.clause_compound_rules = [r for r in data['sequence_rules']
                                      if str(r.get('result', '')).startswith('compound_')
                                      and r.get('result') not in word_results]

    def unit(self, tokens, unit_index=0):
        lexical = []
        for start, token in enumerate(tokens):
            if token['boundary']: continue
            node = self.trie; surface = ''
            for end in range(start, len(tokens)):
                if tokens[end]['boundary']: break
                value = tokens[end]['surface']; valid = True
                for ch in value:
                    if ch not in node: valid = False; break
                    node = node[ch]
                if not valid: break
                surface += value
                for index in node.get(None, []):
                    binding = self.bindings[index]
                    code = binding.get('pos_code')
                    lexical.append({'unit_index': unit_index, 'token_start': start, 'token_end': end+1,
                                    'surface': surface, 'binding': binding,
                                    'raw_pos_support': None if code is None else code in tokens[end]['raw_pos']})
        return lexical

    def analyze(self, raw, *, samples=2, retain=0):
        totals = Counter(); binding_counts = Counter(); examples = defaultdict(list)
        retained = []
        for unit_index, tokens in enumerate(read_tagged(raw)):
            totals['tagger_units'] += 1
            for token in tokens:
                if token['boundary']: totals['sentence_boundaries'] += 1; continue
                totals['tokens'] += 1
                if token['raw_pos'] == ['?']: totals['unknown_tokens'] += 1
                if len(token['raw_pos']) > 1: totals['ambiguous_tokens'] += 1
            hits = self.unit(tokens, unit_index)
            for hit in hits:
                b = hit['binding']; key = (b['source'], b['data_path'], b['normalized'])
                binding_counts[key] += 1
                if len(examples[key]) < samples:
                    examples[key].append({'unit_index': unit_index, 'token_start': hit['token_start'],
                                          'token_end': hit['token_end'], 'surface': hit['surface'],
                                          'raw_pos_support': hit['raw_pos_support']})
                if len(retained) < retain: retained.append(hit)
            totals['lexical_binding_hits'] += len(hits)
        entries = [{'source': source, 'data_path': data_path, 'normalized_form': form,
                    'occurrences': count, 'examples': examples[(source, data_path, form)]}
                   for (source, data_path, form), count in binding_counts.most_common()]
        return {'totals': dict(totals), 'binding_occurrences': entries,
                'compound_sentence_style_resolution': 'pending; lexical observations only',
                'lexical_evidence': retained,
                'evidence_truncated': totals['lexical_binding_hits'] > len(retained) if retain else False}


# ── candidate tagging: black-box tag.py, then read its output file ─────────

def tag_burmese(text, work=WORK):
    # The cache key is the input text only: the engine is a black box, so no
    # internal engine file is fingerprinted from this side.
    key = identity({'text': text, 'version': VERSION})
    cache = Path(work)/'annotations'/f'{key}.json'
    if cache.exists():
        saved = json.loads(cache.read_text())
        if saved.get('key') != key or not isinstance(saved.get('raw_pos'), str):
            raise ComparisonError('Invalid annotation cache')
        return saved, True

    folder = Path(work)/'.work'/key
    folder.mkdir(parents=True, exist_ok=True)
    # 1) hand the text to tag.py and wait for the engine run to finish;
    tag_text(text, work=folder)
    # 2) open the output file it produced and walk it like any tagged file.
    stats = json.loads((folder/'result.json').read_text(encoding='utf-8'))
    raw = Path(stats['raw_pos_path']).read_text(encoding='utf-8')
    # Contract check on the actual file before trusting the cache.
    for tokens in read_tagged(raw):
        if not tokens: raise ComparisonError('Empty raw-POS unit from engine output')
    value = {'key': key, 'raw_pos': raw, 'raw_pos_path': stats['raw_pos_path']}
    atomic_json(cache, value)
    return value, False


def surface_diff(left, right):
    changes = []
    for op, a, b, c, d in SequenceMatcher(None, left, right, autojunk=False).get_opcodes():
        if op != 'equal':
            changes.append({'operation': op, 'direct_span': [a, b], 'pivot_span': [c, d],
                            'direct_text': left[a:b], 'pivot_text': right[c:d]})
    return {'kind': 'literal Burmese surface diff, not a semantic verdict',
            'changed': bool(changes), 'changes': changes}


def build_profile(data, reference=REFERENCE, destination=PROFILE):
    engine = Evidence(data)
    analysis = engine.analyze(Path(reference).read_text(encoding='utf-8'))
    report_path = Path(reference).with_name(Path(reference).name.removesuffix('.raw_pos.txt') + '.report.json')
    provenance = {'status': 'no matching tagger report'}
    if report_path.is_file() and report_path.resolve() != Path(reference).resolve():
        ref_report = json.loads(report_path.read_text())
        provenance = {'raw_text_hash_match': ref_report.get('raw_pos_sha256') == file_hash(reference)}
        provenance['status'] = ('matching current annotation frame'
                                if all(provenance.values())
                                else 'reference frame differs or lacks metadata; observations are not a quality score')
    result = {'schema_version': VERSION, 'knowledge_fingerprint': data['knowledge_fingerprint'],
        'reference': str(Path(reference).resolve().relative_to(ROOT))
            if Path(reference).resolve().is_relative_to(ROOT) else str(reference),
        'reference_sha256': file_hash(reference), 'reference_provenance': provenance,
        'sources': data['sources'], 'wasm_sha256': data['wasm_sha256'], 'analysis': analysis,
        'catalog': {'grammar_sections': data['grammar_section_sizes'],
            'grammar_records': len(data['grammar_rules']),
            'top_bindings': sum(b['source'] == 'top' for b in data['bindings']),
            'rule_lexical_bindings': sum(b['source'] == 'rules' for b in data['bindings']),
            'resolution_single_entries': len(data['resolution']['single']),
            'sequence_records': len(data['sequence_rules']),
            'word_compound_rule_records': len(engine.compound_rules),
            'clause_compound_rule_records': len(engine.clause_compound_rules),
            'compound_rule_result_counts': dict(Counter(r['result'] for r in engine.compound_rules)),
            'sequence_evaluation': 'deferred: requires compound composition before outer sentence interpretation',
            'unresolved_forms': data['unresolved']},
        'policy': data['policy'],
        'limitations': ['Counts are lexical/candidate observations, not grammar judgments or accuracy.',
            'No automatic POS resolution, style substitution or rewriting was performed.',
            'Style contract: default LSE prose; quoted character speech LSN. Contextual application is pending.',
            'Sequence labels describe the composition/grammar layer; raw tag renaming is not the resolution model.',
            'No flat sequence-window counts are treated as compounds or sentence parses.',
            'Word-order constraints require governing-role analysis; not asserted as violations.',
            'No live MT, API-key configuration, phrase alignment or AI call was performed by this data audit.']}
    atomic_json(destination, result)
    return result


def compare_record(record, data, evidence, profile, work=WORK):
    try:
        unit = record['unit']; source = unit['text']; offset = unit['start']; end = unit['end']
        language = record['chinese_language']
        if language not in ('zh-Hant', 'zh-Hans'): raise ValueError
        if (not isinstance(source, str) or not source.strip() or type(offset) is not int
                or type(end) is not int or offset < 0 or end-offset != len(source)
                or not isinstance(unit['id'], str) or not unit['id']): raise ValueError
        pairs = {'zh_my': (language, 'my'), 'zh_en': (language, 'en'), 'en_my': ('en', 'my')}
        translations = {leg: record[leg]['text'] for leg in pairs}
        if any(not isinstance(v, str) or not v.strip() for v in translations.values()): raise ValueError
        for leg, (src, dst) in pairs.items():
            if record[leg]['source_language'] != src or record[leg]['target_language'] != dst: raise ValueError
    except (KeyError, TypeError, ValueError):
        raise ComparisonError('Input must contain Chinese→Burmese, Chinese→English and English→Burmese legs') from None
    reference_counts = {(row['source'], row['data_path'], row['normalized_form']): row['occurrences']
        for row in profile['analysis']['binding_occurrences']}
    candidates = {}
    for name, leg in [('direct', 'zh_my'), ('english_pivot', 'en_my')]:
        annotation, hit = tag_burmese(translations[leg], work)
        analyzed = evidence.analyze(annotation['raw_pos'], samples=1, retain=80)
        observations = [{**row,
            'reference_occurrences': reference_counts.get((row['source'], row['data_path'], row['normalized_form']), 0),
            'interpretation': 'literal observations only, not resolved grammar/style'}
            for row in analyzed['binding_occurrences']]
        candidates[name] = {'text': translations[leg], 'raw_pos': annotation['raw_pos'],
            'raw_component_analysis': analyzed, 'annotation_cache_hit': hit,
            'reference_observations': observations}
    return {'unit': unit, 'translations': translations, 'provider': record.get('provider'),
        'pipeline': 'direct-vs-english-pivot', 'knowledge_fingerprint': data['knowledge_fingerprint'],
        'reference_profile_sha256': identity(profile), 'candidates': candidates,
        'burmese_surface_diff': surface_diff(translations['zh_my'], translations['en_my']),
        'provider_alignment': {leg: record[leg].get('alignment_projection') for leg in translations},
        'style_policy': data['policy'].get('style_policy'),
        'compound_sentence_style_resolution': 'pending: component tags must be composed before outer grammar',
        'word_order_constraints': 'not evaluated without composed units and governing roles',
        'phrase_alignment_status': 'not_established',
        'ai': {'requests': 0, 'eligible': False,
               'reason': 'Compound/context resolution and validated 1:1 phrase alignment are pending'},
        'automatic_replacements': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--profile', action='store_true',
                        help='Audit the reference and supplied rule data; this is not compound/sentence resolution')
    source.add_argument('--input', type=Path,
                        help='MT candidate JSONL; the three-route zh_my/en_my producer (init/initmt.py) is retired')
    parser.add_argument('--reference', type=Path, default=REFERENCE)
    parser.add_argument('--reference-profile', type=Path, default=PROFILE)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--work', type=Path, default=WORK)
    args = parser.parse_args(argv)
    temporary = None
    try:
        protected = {MASTER_ENC.resolve(), RULES.resolve(), args.reference.resolve()}
        protected.update(p.resolve() for p in (ROOT/'input').glob('*') if p.is_file())
        if args.input: protected.add(args.input.resolve())
        proposed = (args.output or args.reference_profile) if args.profile \
            else (args.output or ROOT/'output/mt'/f'{args.input.stem}-comparison.jsonl')
        if proposed.resolve() in protected or args.reference_profile.resolve() in protected:
            raise ComparisonError('Analysis output must not replace source data')
        data = knowledge(args.work)
        if args.profile:
            output = (args.output or args.reference_profile).resolve()
            if output in protected: raise ComparisonError('Profile output must not replace source data')
            result = build_profile(data, args.reference, output)
            print(f'[profile] {output}')
            print(json.dumps(result['analysis']['totals'], ensure_ascii=False, indent=2))
            return 0
        profile_path = args.reference_profile.resolve()
        profile = json.loads(profile_path.read_text()) if profile_path.exists() else None
        if (not profile or profile.get('knowledge_fingerprint') != data['knowledge_fingerprint']
                or profile.get('reference_sha256') != file_hash(args.reference)):
            profile = build_profile(data, args.reference, profile_path)
        output = (args.output or ROOT/'output/mt'/f'{args.input.stem}-comparison.jsonl').resolve()
        if output in [args.input.resolve(), args.reference.resolve(), profile_path]:
            raise ComparisonError('Comparison output must not replace its inputs')
        output.parent.mkdir(parents=True, exist_ok=True)
        engine = Evidence(data); count = 0
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=output.parent,
                                         prefix='.compare-', delete=False) as out:
            temporary = Path(out.name)
            with args.input.open(encoding='utf-8') as stream:
                for line in stream:
                    if not line.strip(): continue
                    result = compare_record(json.loads(line), data, engine, profile, args.work)
                    out.write(json.dumps(result, ensure_ascii=False)+'\n'); out.flush(); count += 1
            if not count: raise ComparisonError('MT input contains no records')
            os.fsync(out.fileno())
        os.replace(temporary, output); temporary = None
        print(f'[comparison] {count} MT units -> {output}; API/AI requests: 0')
        return 0
    except (ComparisonError, OSError, ValueError, KeyError) as error:
        print(f'error: {error}', file=sys.stderr); return 1
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)


if __name__ == '__main__':
    raise SystemExit(main())
