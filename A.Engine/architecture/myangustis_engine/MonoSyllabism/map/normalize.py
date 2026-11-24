"""Python mirror of the kit's normalize.js."""
import re
import unicodedata
from functools import lru_cache
from .source_map import tables
from .source_mapper import mapperStr
from .function import isLowerOrUpperAZ
from myangustis_engine.MonoSyllabism.utilities.js_string import from_utf16_units


_MULTI_SPACE_RE = re.compile(r' +')


@lru_cache(maxsize=1)
def _norm_sets():
    data = tables()
    return (
        frozenset(data['BLOCK_PUNCT']),
        frozenset(data['ENGLISH_DIGITS']),
        frozenset(data['BURMESE_DIGITS']),
        frozenset(data['Glue']),
        data['Priority'],
    )


def _index(ch):
    cp = ord(ch)
    return 0x1000 <= cp <= 0x1021 or cp in (0x1025, 0x1027)


def _classify(ch, block_punct, english_digits, burmese_digits):
    if isLowerOrUpperAZ(ch): return 'E'
    if ch in block_punct: return 'P'
    if ch in english_digits: return 'L'
    if ch in burmese_digits: return 'B'
    return None


@lru_cache(maxsize=1)
def _trie():
    trie = {}
    for entry in tables()['IMPOSTER'].values():
        for imp in entry['imposters']:
            node = trie
            for ch in imp: node = node.setdefault(ch, {})
            node['_replacement'] = entry['correct']
    return trie


def cleanImposters(text):
    root = _trie()
    if not any(ch in root for ch in text):
        return text
    out, i, n = [], 0, len(text)
    while i < n:
        ch = text[i]
        if ch not in root:
            out.append(ch); i += 1
            continue
        node, j, last, replacement = root[ch], i + 1, -1, None
        if '_replacement' in node:
            last, replacement = j, node['_replacement']
        while j < n and text[j] in node:
            node = node[text[j]]; j += 1
            if '_replacement' in node: last, replacement = j, node['_replacement']
        if replacement is not None: out.append(replacement); i = last
        else: out.append(ch); i += 1
    return ''.join(out)


def reorderAndWrap(text):
    if not text or not isinstance(text, str): return ''
    block_punct, english_digits, burmese_digits, _glue, priority_map = _norm_sets()
    out, i = [], 0
    while i < len(text) and text[i] in ' \t': out.append(text[i]); i += 1
    while i < len(text):
        ch = text[i]
        if _index(ch):
            out.append(ch); i += 1
            marks, seen = [], set()
            while i < len(text):
                nxt = text[i]
                if _index(nxt) or nxt not in priority_map: break
                priority = priority_map[nxt]
                if priority not in seen: seen.add(priority); marks.append(nxt)
                i += 1
            if len(marks) > 1:
                marks.sort(key=priority_map.__getitem__)
            out.extend(marks)
            continue
        start = _classify(ch, block_punct, english_digits, burmese_digits)
        if start in ('E', 'L', 'B'):
            j = i
            while j < len(text):
                typ = _classify(text[j], block_punct, english_digits, burmese_digits)
                if typ not in ('P', start): break
                j += 1
            block = _MULTI_SPACE_RE.sub(' ', text[i:j]); trimmed = block.rstrip(' ')
            out.extend(('{', trimmed, '}', block[len(trimmed):])); i = j
        else: out.append(ch); i += 1
    return ''.join(out)


def deleteEnglishBlocks(text):
    block_punct, english_digits, burmese_digits, _glue, _priority = _norm_sets()
    out, i = [], 0
    while i < len(text):
        start = _classify(text[i], block_punct, english_digits, burmese_digits)
        if start in ('E', 'L', 'B'):
            j = i
            while j < len(text) and _classify(text[j], block_punct, english_digits, burmese_digits) in ('P', start): j += 1
            block = _MULTI_SPACE_RE.sub(' ', text[i:j]); out.append(block[len(block.rstrip(' ')):]); i = j
        else: out.append(text[i]); i += 1
    return ''.join(out)


def normalize(text):
    if not text or not isinstance(text, str): return ''
    _bp, _ed, _bd, glue, _pr = _norm_sets()
    text = unicodedata.normalize('NFC', from_utf16_units(text))
    return cleanImposters(''.join(ch for ch in text if ch not in glue))


def mapperNormalize(text): return mapperStr(reorderAndWrap(normalize(text))) if text and isinstance(text, str) else ''
def myNormalize(text): return mapperStr(deleteEnglishBlocks(normalize(text))) if text and isinstance(text, str) else ''
