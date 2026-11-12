from myangustis_engine.MonoSyllabism.main.phoneme.lexer import _node_utf8_length
MAX_LINE_BYTES = 5 * 1024 * 1024

def to_line_strings(tokens, max_line_bytes=MAX_LINE_BYTES):
    line, size, discarded = '', 0, False
    for token in tokens:
        if token == '\n':
            if line or not discarded:
                yield line
            line, size, discarded = '', 0, False
            continue
        if not isinstance(token, str):
            continue
        next_bytes = _node_utf8_length(token)
        if size + next_bytes > max_line_bytes:
            line, size, discarded = '', 0, True
            continue
        line += token
        size += next_bytes
    if line:
        yield line
