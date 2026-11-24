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


def arrange_zawcode_order(text, *, prebase_vowel_slot=True):
    """The ZawCode slot swap, in the journal's own rule order.

    ``prebase_vowel_slot`` guards the ``ေ`` + base slot (the two-slot rule that
    carries ေ behind the base). That slot is a real ZawCode replacement, but it
    is also the one pattern every correctly ordered Unicode page offers, so it
    may not vote in the lane call: evidence runs the swap with the guard off
    (:func:`zawcode_slot_candidate`), and only the replacement, after the lane
    is confirmed as ZawCode, carries it.
    """
    if not isinstance(text, str):
        raise TypeError('Expected text')
    s = text.replace('\u200b', '') if '\u200b' in text else text
    n = len(s)
    bases = _bases()
    out = []
    i = 0
    e, aa, ra = 'ေ', 'ာ', 'ြ'
    while i < n:
        cur = s[i]
        if i == 0 or s[i - 1] != e:
            nxt = s[i + 1] if i + 1 < n else None
            after = s[i + 2] if i + 2 < n else None
            fourth = s[i + 3] if i + 3 < n else None
            fifth = s[i + 4] if i + 4 < n else None
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
            if prebase_vowel_slot and cur == e and nxt in bases:
                out.extend((nxt, e)); i += 2; continue
        out.append(cur)
        i += 1
    return ''.join(out)


def zawcode_slot_candidate(text):
    """The swap as decision evidence: every slot except ``ေ`` + base.

    Used to answer "does this page read as ZawCode?" -- never to produce a
    page. The ``ေ`` + base slot is applied by :func:`arrange_zawcode_order`
    only once the lane is confirmed.
    """
    return arrange_zawcode_order(text, prebase_vowel_slot=False)
