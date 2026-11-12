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


def _iterate(text):
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
    out = ''.join(char if bypass else mm.get(char, char) for bypass, char in _iterate(text))
    return compose(out, ascii, set(tables()['NewMap']['Base']))


def toBurmeseStr(text):
    _, ascii = _maps()
    decomposed = decompose(text, set(tables()['MMap']['Base']))
    out = ''.join(char if bypass else ascii.get(char, char) for bypass, char in _iterate(decomposed))
    return from_utf16_units(out.replace('{', '').replace('}', ''))


def isTail(ch):
    new = tables()['NewMap']
    if ch in 'abcdefghijklmnopqrstuvwxyz' and len(ch) == 1: return 'baseasat'
    if ch == new['Asat'][0]: return 'asat'
    return 'Mark' if ch in new['Tail'] else False


def isBase(ch): return ch in tables()['NewMap']['Base']
def isNum(ch): return ch in tables()['NewMap']['Num']
def isStick(ch): return ch in tables()['newClause']['stick']
def isStandalone(ch): return ch in tables()['newClause']['standalone']
