import time
from myangustis_engine.MonoSyllabism.utilities import formatter as fmt
from myangustis_engine.MonoSyllabism.main.grapheme.traverser import walk

from myangustis_engine.MonoSyllabism.utilities.js_string import (
    utf16_units as _utf16_units, from_utf16_units as _from_utf16_units,
    to_valid_utf8_str as _to_valid_utf8_str, js_utf8_length as _node_utf8_length,
)


def run_segmentor(blocks, runtime, logger=None):
    line_count = 0
    started = time.time()
    if logger:
        logger.tracker('SEGMENT').start_time = started
        logger.emit_log('SEGMENT', 'processing', 'segmenting...', {'lineCount': 0})
    for block in blocks:
        block = _utf16_units(block)
        pos = 0
        while pos < len(block):
            char = block[pos]
            if char == '\n':
                yield '\n'
                line_count += 1
                pos += 1
                if logger and line_count % 5000 == 0:
                    elapsed = max(time.time() - started, 0.001)
                    print(f'[PROGRESS] {line_count:,} lines | {elapsed / 3.333:.1f}s | {line_count / elapsed * 3.333:.0f}/sec')
            elif char == ' ':
                yield fmt.SPACE_TOKEN
                pos += 1
            elif char == '{':
                end = block.find('}', pos)
                if end != -1:
                    yield fmt.to_syllable_token(_to_valid_utf8_str(block[pos:end + 1]), runtime)
                    pos = end + 1
                else:
                    yield fmt.to_syllable_token(char, runtime)
                    pos += 1
            elif (runtime.isTail(char) and not runtime.isLowercaseAZ(char)) or (not runtime.isBase(char) and not runtime.isLowercaseAZ(char)):
                if '\ud800' <= char <= '\udbff' and pos + 1 < len(block) and '\udc00' <= block[pos + 1] <= '\udfff':
                    yield fmt.to_syllable_token(_to_valid_utf8_str(block[pos:pos + 2]), runtime)
                    pos += 2
                elif '\ud800' <= char <= '\udfff':
                    yield fmt.to_syllable_token('\ufffd', runtime)
                    pos += 1
                else:
                    yield fmt.to_syllable_token(char, runtime)
                    pos += 1
            else:
                end = walk(block, pos, _utf16=True)['lastValidPos']
                if end > pos:
                    yield fmt.to_syllable_token(_to_valid_utf8_str(block[pos:end]), runtime)
                    pos = end
                elif '\ud800' <= char <= '\udbff' and pos + 1 < len(block) and '\udc00' <= block[pos + 1] <= '\udfff':
                    yield fmt.to_syllable_token(_to_valid_utf8_str(block[pos:pos + 2]), runtime)
                    pos += 2
                elif '\ud800' <= char <= '\udfff':
                    yield fmt.to_syllable_token('\ufffd', runtime)
                    pos += 1
                else:
                    yield fmt.to_syllable_token(char, runtime)
                    pos += 1
    if logger:
        print(f'[SEGMENTOR] Done. Total lines: {line_count}')
