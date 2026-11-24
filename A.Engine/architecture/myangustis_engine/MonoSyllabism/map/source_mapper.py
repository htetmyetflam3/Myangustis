from functools import lru_cache
from .source_map import tables
from .function import compose, decompose
from myangustis_engine.MonoSyllabism.utilities.js_string import from_utf16_units


@lru_cache(maxsize=1)
def _maps():
    data = tables()
    mm, ascii = {}, {}
    for group in ('Base', 'Tail', 'Asat', 'Num'):
        for i, char in enumerate(data['MMap'][group]):
            code = data['NewMap'][group][i]
            mm[char] = code
            ascii[code] = char
    return mm, ascii


@lru_cache(maxsize=1)
def _char_sets():
    data = tables()
    new = data['NewMap']
    clause = data['newClause']
    return {
        'new_base': frozenset(new['Base']),
        'new_tail': frozenset(new['Tail']),
        'new_asat0': new['Asat'][0],
        'new_num': frozenset(new['Num']),
        'mm_base': frozenset(data['MMap']['Base']),
        'stick': frozenset(clause['stick']),
        'standalone': frozenset(clause['standalone']),
    }


def _iterate(text):
    if '{' not in text:
        for ch in text:
            yield False, ch
        return
    pos = 0
    while pos < len(text):
        if text[pos] == '{':
            end = text.find('}', pos + 1)
            if end != -1:
                yield True, text[pos:end + 1]
                pos = end + 1
                continue
        yield False, text[pos]
        pos += 1


def mapperStr(text):
    mm, ascii = _maps()
    sets = _char_sets()
    if '{' not in text:
        out = ''.join(mm.get(char, char) for char in text)
    else:
        out = ''.join(char if bypass else mm.get(char, char) for bypass, char in _iterate(text))
    return compose(out, ascii, sets['new_base'])


@lru_cache(maxsize=8192)
def _to_burmese_cached(text):
    _, ascii = _maps()
    sets = _char_sets()
    decomposed = decompose(text, sets['mm_base'])
    if '{' not in decomposed:
        out = ''.join(ascii.get(char, char) for char in decomposed)
        return from_utf16_units(out.replace('}', '') if '}' in out else out)
    out = ''.join(char if bypass else ascii.get(char, char) for bypass, char in _iterate(decomposed))
    return from_utf16_units(out.replace('{', '').replace('}', ''))


def toBurmeseStr(text):
    return _to_burmese_cached(text) if len(text) <= 64 else _to_burmese_uncached(text)


def _to_burmese_uncached(text):
    _, ascii = _maps()
    sets = _char_sets()
    decomposed = decompose(text, sets['mm_base'])
    if '{' not in decomposed:
        out = ''.join(ascii.get(char, char) for char in decomposed)
        return from_utf16_units(out.replace('}', '') if '}' in out else out)
    out = ''.join(char if bypass else ascii.get(char, char) for bypass, char in _iterate(decomposed))
    return from_utf16_units(out.replace('{', '').replace('}', ''))


def isTail(ch):
    if len(ch) == 1 and 'a' <= ch <= 'z': return 'baseasat'
    sets = _char_sets()
    if ch == sets['new_asat0']: return 'asat'
    return 'Mark' if ch in sets['new_tail'] else False


def isBase(ch): return ch in _char_sets()['new_base']
def isNum(ch): return ch in _char_sets()['new_num']
def isStick(ch): return ch in _char_sets()['stick']
def isStandalone(ch): return ch in _char_sets()['standalone']
