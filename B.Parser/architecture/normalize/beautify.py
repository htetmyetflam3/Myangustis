"""Parser-side ZawCode slot swap from JS beautify/zawcode-order.js.

This produces a candidate or applies a selected page decision. It does not
score words or perform the later vector repair.
"""
from functools import lru_cache
from myangustis_parser.resources.engine import read_master_json


@lru_cache(maxsize=1)
def _bases():
    bases = read_master_json().get('mapData', {}).get('MMap', {}).get('Base')
    if not isinstance(bases, list):
        raise ValueError('Engine master is missing MMap.Base')
    return frozenset(bases)


def arrange_zawcode_order(text):
    if not isinstance(text, str):
        raise TypeError('Expected text')
    chars = list(text.replace('\u200b', ''))
    bases = _bases()
    out = []
    i = 0
    e, aa, ra = 'ေ', 'ာ', 'ြ'
    while i < len(chars):
        cur = chars[i]
        nxt, after, fourth, fifth = (chars[k] if k < len(chars) else None
                                      for k in range(i + 1, i + 5))
        if i == 0 or chars[i - 1] != e:
            if cur == e and nxt == ra and after in bases and fourth == e and fifth in bases:
                out.extend((after, ra, e, fifth, e)); i += 5; continue
            if cur == e and nxt in bases and after in bases and fourth == aa:
                out.extend((nxt, e, after, aa)); i += 4; continue
            if nxt == aa and after == ra and cur in bases and fourth in bases:
                out.extend((cur, aa, fourth, ra)); i += 4; continue
            if cur == ra and nxt in bases and after == e and fourth == ra and fifth in bases:
                out.extend((nxt, ra, fifth, ra, e)); i += 5; continue
            if cur == e and nxt in bases and after == aa:
                out.extend((nxt, e, aa)); i += 3; continue
            if cur == e and nxt == ra and after in bases:
                out.extend((after, ra, e)); i += 3; continue
            if cur == ra and nxt in bases:
                out.extend((nxt, ra)); i += 2; continue
            if cur == e and nxt in bases:
                out.extend((nxt, e)); i += 2; continue
        out.append(cur)
        i += 1
    return ''.join(out)
