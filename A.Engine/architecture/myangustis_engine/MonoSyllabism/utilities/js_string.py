"""JavaScript UTF-16 and String.trim semantics used at the engine boundary."""

# ECMAScript WhiteSpace and LineTerminator (not Python's larger Unicode set).
JS_TRIM_CHARS = ('\u0009\u000b\u000c\u0020\u00a0\u1680\u2000\u2001\u2002\u2003'
                 '\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000'
                 '\ufeff\u000a\u000d\u2028\u2029')


def js_trim(value):
    return value.strip(JS_TRIM_CHARS)


def utf16_units(value):
    data = value.encode('utf-16-le', 'surrogatepass')
    return ''.join(chr(int.from_bytes(data[i:i + 2], 'little')) for i in range(0, len(data), 2))


def from_utf16_units(value):
    return value.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'surrogatepass')


def js_utf8_length(value):
    # Node's Buffer.byteLength replaces unpaired surrogate code units with U+FFFD.
    return len(value.encode('utf-16-le', 'surrogatepass').decode('utf-16-le', 'replace').encode('utf-8'))
