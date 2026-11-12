import re, time
from myangustis_engine.MonoSyllabism.utilities import formatter as fmt
from myangustis_engine.MonoSyllabism.main.grapheme.tree_loaded import load_tree, mappings
from myangustis_engine.MonoSyllabism.main.grapheme.traverser import walk_pos
from myangustis_engine.MonoSyllabism.main.phoneme.classify_number import classify_number

def _classify(token, tables):
    if token in (' ', '\t', '\r', '\n'): return None
    digits = set(tables.get('ALL_DIGITS', []))
    if token and any(ch in digits for ch in token) and all(ch in digits or ch in ' -/.,' for ch in token):
        return classify_number(token)['rawPos']
    if token == '။' or token in tables.get('PUNCTUATION', []): return ['pan']
    if token.startswith('{') and token.endswith('}'): return ['en']
    return ['F']


def run_tagger(units, runtime, logger=None):
    start = time.time()
    if logger:
        logger.tracker('TAGGER').start_time = start
        logger.emit_log('TAGGER', 'processing', 'tagging...')
    token_count = word_count = 0
    tables = runtime.tables()
    ids = mappings()['burmese']
    tree = dict(load_tree('pos.tree.json'))
    for form in tables.get('newClause', {}).get('standalone', []):
        ident = ids.get(form)
        if not ident: continue
        override = {'ဪ': 'in', 'ဦး': 'r'}.get(form)
        if override:
            tree[ident] = {**tree.get(ident, {}), 'x': [override]}
        elif ident not in tree:
            tree[ident] = {'x': ['r']}
    tree_id = re.compile(r'^[A-Z¶£¥¦§¨©ª«¬®¯°±²³π][0-9]{3}$')
    for line in units:
        syllables = fmt.split_syllables(line)
        id_tokens = [ids.get(s, s) for s in syllables]
        tokens, pos = [], 0
        while pos < len(id_tokens):
            syl, ident = syllables[pos], id_tokens[pos]
            if syl == '။':
                tokens.append({'syllables': [syl + fmt.EOS_MARK], 'ids': [ident], 'rawPos': ['eos']})
                pos += 1
            elif not tree_id.fullmatch(ident):
                tags = _classify(syl, tables)
                if tags is not None:
                    tokens.append({'syllables': [syl], 'ids': [ident], 'rawPos': tags})
                pos += 1
            else:
                result = walk_pos(id_tokens, pos, tree)
                end = result['lastValidPos']
                tokens.append({'syllables': syllables[pos:end], 'ids': [''.join(id_tokens[pos:end])], 'rawPos': result['rawPos']})
                pos = end
        token_count += len(tokens)
        word_count += sum(1 for t in tokens if t['rawPos'][0] not in ('?', 'pan', 'eos', 'en', 'count', 'phone', 'addr', 'year', 'exactdate'))
        yield {'tokens': tokens, 'isEos': bool(syllables and syllables[-1] == '။')}
    if logger:
        tracker = logger.tracker('TAGGER')
        tracker.inc('tokenReceived', token_count)
        tracker.inc('wordCount', word_count)
        tracker.end_time = time.time()
        logger.emit_log('TAGGER', 'success', 'done', {'tokenCount': token_count, 'wordCount': word_count, 'elapsedSec': f'{tracker.end_time - start:.1f}', 'elapsed': int((tracker.end_time - start) * 1000)})
