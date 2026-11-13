"""Buffer, file stream, and path utilities used by the engine."""
import codecs
import math
from pathlib import Path
from myangustis_engine.secure_data.secure import ENGINE_ROOT
from myangustis_engine.MonoSyllabism.utilities.stream import collect_from_text, read_chunk_size


def resolve_path(path):
    path = Path(path)
    return path if path.is_absolute() else (ENGINE_ROOT / path).resolve()


def split_buffer(buffer):
    index = buffer.rfind('\n')
    if index < 0: return {'lines': None, 'remainder': buffer}
    return {'lines': buffer[:index + 1], 'remainder': buffer[index + 1:]}


def get_flush_lines(source):
    if isinstance(source, (int, float)):
        size = source
    else:
        try: size = resolve_path(source).stat().st_size
        except (OSError, TypeError): return 1000
    mb = size / (1024 * 1024)
    if mb < .02: return math.inf
    if mb < 2: return 1000
    if mb < 10: return 2500
    return 5000


def collector(file_path, high_water_mark=None):
    path = resolve_path(file_path)
    chunk_size = high_water_mark if high_water_mark is not None else read_chunk_size(path.stat().st_size)
    if chunk_size <= 0: raise ValueError('high_water_mark must be positive')
    buffer = ''
    decoder = codecs.getincrementaldecoder('utf-8')(errors='replace')
    with path.open('rb') as stream:
        while chunk := stream.read(chunk_size):
            split = split_buffer(buffer + decoder.decode(chunk))
            if split['lines'] is not None:
                yield split['lines']
            buffer = split['remainder']
    buffer += decoder.decode(b'', final=True)
    if buffer: yield buffer


def read_file_content(file_path): return ''.join(collector(file_path))


def read_and_prepare(file_path, runtime):
    for block in collector(file_path):
        yield runtime.mapperNormalize(block)


def resolve_inputs(path):
    path = resolve_path(path)
    if path.is_dir():
        files = sorted(p for p in path.iterdir() if p.is_file() and p.suffix == '.txt')
        if not files: raise ValueError(f'No .txt files in: {path}')
        return files
    if path.exists(): return [path]
    raise FileNotFoundError(f'Input not found: {path}')
