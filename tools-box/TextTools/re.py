# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: re.pyo
# Compiled at: 2008-02-12 04:24:30
import sys, sre_compile, sre_parse
__all__ = [
 2, 3, 4, 5, 6, 7, 
 8, 9, 10, 11, 12, 13, 14, 15, 16, 
 17, 18, 
 19, 20, 21, 22, 
 23, 24]
__version__ = '2.2.1'
I = IGNORECASE = sre_compile.SRE_FLAG_IGNORECASE
L = LOCALE = sre_compile.SRE_FLAG_LOCALE
U = UNICODE = sre_compile.SRE_FLAG_UNICODE
M = MULTILINE = sre_compile.SRE_FLAG_MULTILINE
S = DOTALL = sre_compile.SRE_FLAG_DOTALL
X = VERBOSE = sre_compile.SRE_FLAG_VERBOSE
T = TEMPLATE = sre_compile.SRE_FLAG_TEMPLATE
DEBUG = sre_compile.SRE_FLAG_DEBUG
error = sre_compile.error

def match(pattern, string, flags=0):
    return _compile(pattern, flags).match(string)


def search(pattern, string, flags=0):
    return _compile(pattern, flags).search(string)


def sub(pattern, repl, string, count=0):
    return _compile(pattern, 0).sub(repl, string, count)


def subn(pattern, repl, string, count=0):
    return _compile(pattern, 0).subn(repl, string, count)


def split(pattern, string, maxsplit=0):
    return _compile(pattern, 0).split(string, maxsplit)


def findall(pattern, string, flags=0):
    return _compile(pattern, flags).findall(string)


if sys.hexversion >= 33685504:
    __all__.append('finditer')

    def finditer(pattern, string, flags=0):
        return _compile(pattern, flags).finditer(string)


def compile(pattern, flags=0):
    return _compile(pattern, flags)


def purge():
    _cache.clear()
    _cache_repl.clear()
    return


def template(pattern, flags=0):
    return _compile(pattern, flags | T)


_alphanum = {}
for c in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890':
    _alphanum[c] = 1

del c

def escape(pattern):
    s = list(pattern)
    alphanum = _alphanum
    for i in range(len(pattern)):
        c = pattern[i]
        if c not in alphanum:
            if c == '\x00':
                s[i] = '\\000'
            else:
                s[i] = '\\' + c

    return pattern[:0].join(s)


_cache = {}
_cache_repl = {}
_pattern_type = type(sre_compile.compile('', 0))
_MAXCACHE = 100

def _compile(*key):
    cachekey = (
     type(key[0]),) + key
    p = _cache.get(cachekey)
    if p is not None:
        return p
    (pattern, flags) = key
    if isinstance(pattern, _pattern_type):
        return pattern
    if not sre_compile.isstring(pattern):
        raise TypeError, 'first argument must be string or compiled pattern'
    try:
        p = sre_compile.compile(pattern, flags)
    except error, v:
        raise error, v

    if len(_cache) >= _MAXCACHE:
        _cache.clear()
    _cache[cachekey] = p
    return p


def _compile_repl(*key):
    p = _cache_repl.get(key)
    if p is not None:
        return p
    (repl, pattern) = key
    try:
        p = sre_parse.parse_template(repl, pattern)
    except error, v:
        raise error, v

    if len(_cache_repl) >= _MAXCACHE:
        _cache_repl.clear()
    _cache_repl[key] = p
    return p


def _expand(pattern, match, template):
    template = sre_parse.parse_template(template, pattern)
    return sre_parse.expand_template(template, match)


def _subx(pattern, template):
    template = _compile_repl(template, pattern)
    if not template[0] and len(template[1]) == 1:
        return template[1][0]

    def filter(match, template=template):
        return sre_parse.expand_template(template, match)

    return filter


import copy_reg

def _pickle(p):
    return (
     _compile, (p.pattern, p.flags))


copy_reg.pickle(_pattern_type, _pickle, _compile)

class Scanner:

    def __init__(self, lexicon, flags=0):
        from sre_constants import BRANCH, SUBPATTERN
        self.lexicon = lexicon
        p = []
        s = sre_parse.Pattern()
        s.flags = flags
        for (phrase, action) in lexicon:
            p.append(sre_parse.SubPattern(s, [
             (
              SUBPATTERN, (len(p) + 1, sre_parse.parse(phrase, flags)))]))

        s.groups = len(p) + 1
        p = sre_parse.SubPattern(s, [(BRANCH, (None, p))])
        self.scanner = sre_compile.compile(p)
        return

    def scan(self, string):
        result = []
        append = result.append
        match = self.scanner.scanner(string).match
        i = 0
        while 1:
            m = match()
            if not m:
                break
            j = m.end()
            if i == j:
                break
            action = self.lexicon[m.lastindex - 1][1]
            if callable(action):
                self.match = m
                action = action(self, m.group())
            if action is not None:
                append(action)
            i = j

        return (
         result, string[i:])


return

# okay decompiling TextTools/re.pyo
