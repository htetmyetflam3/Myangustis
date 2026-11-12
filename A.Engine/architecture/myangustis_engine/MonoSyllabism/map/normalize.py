"""Python mirror of the kit's normalize.js."""
import re
import unicodedata
from functools import lru_cache
from .source_map import tables
from .source_mapper import mapperStr
from .function import isLowerOrUpperAZ
from myangustis_engine.MonoSyllabism.utilities.js_string import from_utf16_units


def _index(ch):
    cp = ord(ch)
    return 0x1000 <= cp <= 0x1021 or cp in (0x1025, 0x1027)


def _classify(ch, data):
    if isLowerOrUpperAZ(ch): return 'E'
    if ch in data['BLOCK_PUNCT']: return 'P'
    if ch in data['ENGLISH_DIGITS']: return 'L'
    if ch in data['BURMESE_DIGITS']: return 'B'
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
    root, out, i = _trie(), [], 0
    while i < len(text):
        node, j, last, replacement = root, i, -1, None
        while j < len(text) and text[j] in node:
            node = node[text[j]]; j += 1
            if '_replacement' in node: last, replacement = j, node['_replacement']
        if replacement is not None: out.append(replacement); i = last
        else: out.append(text[i]); i += 1
    return ''.join(out)


def reorderAndWrap(text):
    if not text or not isinstance(text, str): return ''
    data, out, i = tables(), [], 0
    while i < len(text) and text[i] in ' \t': out.append(text[i]); i += 1
    while i < len(text):
        ch = text[i]
        if _index(ch):
            out.append(ch); i += 1
            marks, seen = [], set()
            while i < len(text):
                nxt = text[i]
                if _index(nxt) or nxt not in data['Priority']: break
                priority = data['Priority'][nxt]
                if priority not in seen: seen.add(priority); marks.append(nxt)
                i += 1
            out.extend(sorted(marks, key=lambda c: data['Priority'][c]))
            continue
        start = _classify(ch, data)
        if start in ('E', 'L', 'B'):
            j = i
            while j < len(text):
                typ = _classify(text[j], data)
                if typ not in ('P', start): break
                j += 1
            block = re.sub(r' +', ' ', text[i:j]); trimmed = block.rstrip(' ')
            out.extend(('{', trimmed, '}', block[len(trimmed):])); i = j
        else: out.append(ch); i += 1
    return ''.join(out)


def deleteEnglishBlocks(text):
    data, out, i = tables(), [], 0
    while i < len(text):
        start = _classify(text[i], data)
        if start in ('E', 'L', 'B'):
            j = i
            while j < len(text) and _classify(text[j], data) in ('P', start): j += 1
            block = re.sub(r' +', ' ', text[i:j]); out.append(block[len(block.rstrip(' ')):]); i = j
        else: out.append(text[i]); i += 1
    return ''.join(out)


def normalize(text):
    if not text or not isinstance(text, str): return ''
    text = unicodedata.normalize('NFC', from_utf16_units(text))
    return cleanImposters(''.join(ch for ch in text if ch not in tables()['Glue']))


def mapperNormalize(text): return mapperStr(reorderAndWrap(normalize(text))) if text and isinstance(text, str) else ''
def myNormalize(text): return mapperStr(deleteEnglishBlocks(normalize(text))) if text and isinstance(text, str) else ''
