from myangustis_engine.MonoSyllabism.main.phoneme.lexer import _utf16_units, _from_utf16_units

def read_chunk_size(size):
    mb = size / (1024 * 1024)
    if mb < 2: return 256 * 1024
    if mb < 5: return 512 * 1024
    if mb < 10: return 256 * 1024
    return 1024 * 1024


def collect_from_text(text, chunk_size=None):
    size = chunk_size if chunk_size is not None else read_chunk_size(len(text.encode('utf-8')))
    if size <= 0:
        raise ValueError('chunk_size must be positive')
    # JS slices text in UTF-16 code units, including across surrogate pairs.
    text = _utf16_units(text)
    while text:
        window = text[:size]
        last = window.rfind('\n')
        if last < 0:
            yield _from_utf16_units(window)
            text = text[len(window):]
        else:
            yield _from_utf16_units(window[:last + 1])
            text = window[last + 1:] + text[len(window):]
