# uncompyle6 version 3.9.3
# Python bytecode version base 2.5 (62131)
# Decompiled from: Python 3.13.5 (main, Aug 10 2026, 12:06:59) [GCC 14.2.0]
# Embedded file name: struct.pyo
# Compiled at: 2006-08-02 23:27:30
__version__ = '0.1'
from _struct import Struct, error
_MAXCACHE = 100
_cache = {}

def _compile(fmt):
    if len(_cache) >= _MAXCACHE:
        _cache.clear()
    s = Struct(fmt)
    _cache[fmt] = s
    return s


def calcsize(fmt):
    try:
        o = _cache[fmt]
    except KeyError:
        o = _compile(fmt)

    return o.size


def pack(fmt, *args):
    try:
        o = _cache[fmt]
    except KeyError:
        o = _compile(fmt)

    return o.pack(*args)


def pack_into(fmt, buf, offset, *args):
    try:
        o = _cache[fmt]
    except KeyError:
        o = _compile(fmt)

    return o.pack_into(buf, offset, *args)


def unpack(fmt, s):
    try:
        o = _cache[fmt]
    except KeyError:
        o = _compile(fmt)

    return o.unpack(s)


def unpack_from(fmt, buf, offset=0):
    try:
        o = _cache[fmt]
    except KeyError:
        o = _compile(fmt)

    return o.unpack_from(buf, offset)


return

# okay decompiling TextTools/struct.pyo
