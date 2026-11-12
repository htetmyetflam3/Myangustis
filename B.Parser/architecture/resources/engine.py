"""Read parser dictionary data through the Python engine, without Node."""
from functools import lru_cache
from pathlib import Path
from myangustis_engine.secure_data import secure


class EngineError(RuntimeError):
    """Engine data is not available or could not be read."""


def available():
    return secure.MASTER_ENC.is_file()


@lru_cache(maxsize=1)
def read_master_json():
    try:
        return secure.read_master_json()
    except (OSError, ValueError, RuntimeError) as exc:
        raise EngineError(f'Cannot read the engine master: {exc}') from exc


def read_secure_json(file):
    try:
        return secure.read_secure_json(file)
    except (OSError, ValueError, RuntimeError) as exc:
        raise EngineError(f'Cannot read engine data {file}: {exc}') from exc


def master_info():
    try:
        return {'master': str(secure.MASTER_ENC), 'sha256': secure.master_fingerprint()}
    except OSError as exc:
        raise EngineError(f'Cannot read the engine master: {exc}') from exc


def clear_cache():
    read_master_json.cache_clear()
