from myangustis_engine.MonoSyllabism.main.phoneme.lexer import _utf16_units, _from_utf16_units, _node_utf8_length

def read_chunk_size(size):
    mb = size / (1024 * 1024)
    if mb < 2: return 256 * 1024
    if mb < 5: return 512 * 1024
    if mb < 10: return 256 * 1024
    return 1024 * 1024


def collect_from_text(text, chunk_size=None):
    size = chunk_size if chunk_size is not None else read_chunk_size(_node_utf8_length(text))
    if size <= 0:
        raise ValueError('chunk_size must be positive')
    # JS slices text in UTF-16 code units, including across surrogate pairs.
    units = _utf16_units(text)
    n = len(units)
    pos = 0
    while pos < n:
        end = min(pos + size, n)
        last = units.rfind('\n', pos, end)
        if last < 0:
            yield _from_utf16_units(units[pos:end])
            pos = end
        else:
            yield _from_utf16_units(units[pos:last + 1])
            pos = last + 1
