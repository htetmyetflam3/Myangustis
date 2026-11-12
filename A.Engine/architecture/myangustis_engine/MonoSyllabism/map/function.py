"""Pure Python counterparts of the WASM kit's character helpers."""
import re
from myangustis_engine.MonoSyllabism.utilities.js_string import from_utf16_units


def isLowercaseAZ(ch): return isinstance(ch, str) and len(ch) == 1 and 'a' <= ch <= 'z'
def isUppercaseAZ(ch): return isinstance(ch, str) and len(ch) == 1 and 'A' <= ch <= 'Z'
def isLowerOrUpperAZ(ch): return isLowercaseAZ(ch) or isUppercaseAZ(ch)


def with_brace_bypass(text, transform):
    result, pos = [], 0
    while pos < len(text):
        ch = text[pos]
        if ch == '{':
            end = text.find('}', pos + 1)
            if end != -1:
                result.append(text[pos:end+1]); pos = end+1; continue
        result.append(ch if ch in '{}' else transform(ch))
        pos += 1
    return ''.join(result)


def compose(text, ascii_to_mm, base_set):
    def replace(match):
        upper_e, upper_dollar, lower_dollar, other_dollar, upper = match.groups()
        if upper_e: return upper_e + '#'
        asc = upper_dollar or lower_dollar or other_dollar
        if asc: return ascii_to_mm.get(asc, match.group()) if asc in base_set else match.group()
        if upper: return upper.lower()
        return match.group()
    return from_utf16_units(re.sub(r'([A-Z])\^\$|\$([A-Z])|\$([a-z])|\$([^A-Za-z])|([A-Z])\^', replace, text))


def decompose(text, mm_bases):
    def transform(ch):
        if ch == '#': return '^$'
        if isLowercaseAZ(ch): return ch.upper() + '^'
        if ch in mm_bases: return '\u1039' + ch
        return ch
    return from_utf16_units(with_brace_bypass(text, transform))
