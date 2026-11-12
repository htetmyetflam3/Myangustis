"""Output formatting used by the engine's entry and POS holders."""
from .js_string import js_trim
DELIM = '  '
SYLLABLE_SUFFIX = '√'
SPACE_TOKEN = ' √'
EOS_MARK = '<eos>'


def to_syllable_token(text, runtime):
    return runtime.toBurmeseStr(text) + SYLLABLE_SUFFIX


def split_syllables(line):
    return [part for part in line.split(SYLLABLE_SUFFIX) if part]


def to_syllable_line(line):
    return DELIM.join(part for part in line.split(SYLLABLE_SUFFIX) if js_trim(part))


def token_burmese(token):
    return ''.join(token.get('syllables') or [])


def token_id(token):
    return ''.join(token.get('ids') or []) or token_burmese(token)


def to_burmese_line(result):
    return DELIM.join(s for token in result.get('tokens', []) for s in token.get('syllables', []))


def to_burmese_line_with_pos(result, field='finalPos'):
    def format_token(token):
        text = token_burmese(token)
        if text.endswith(EOS_MARK):
            return text
        value = token.get(field, '?')
        if isinstance(value, list):
            value = ','.join(str(v) for v in value)
        return f'{text}{{{value}}}'
    return DELIM.join(map(format_token, result.get('tokens', [])))


def as_eos(surface): return surface + EOS_MARK


def is_eos_token(surface): return surface.endswith(EOS_MARK)


def merged_ids(ids): return ''.join(ids or [])


def token_is_boundary(token): return is_eos_token(token_burmese(token))


def to_ids_line_with_pos(result, field='rawPos'):
    def render(token):
        ident = token_id(token)
        if token_is_boundary(token): return ident
        value = token.get(field)
        if isinstance(value, list): value = ','.join(map(str, value))
        elif value is None: value = 'undefined'
        return f'{ident}{{{value}}}'
    return DELIM.join(render(t) for t in result.get('tokens', []))


def to_id_mapper_line(result, id_of=lambda s: s):
    return DELIM.join(id_of(s[:-len(EOS_MARK)] if is_eos_token(s) else s)
                      for t in result.get('tokens', []) for s in t.get('syllables', []))


def to_id_merged_line(result): return DELIM.join(token_id(t) for t in result.get('tokens', []))
