"""Load bundled parser JSON or encrypted overrides through the Python engine.

Set PRASER_MAP_DIR to use an external data directory.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

# Shipped parser maps, with an optional external deployment override.
from myangustis_parser.resources.paths import PARSER_ROOT
_PRIMARY_DIR = Path(os.environ.get("PRASER_MAP_DIR") or (Path(__file__).resolve().parent / "maps_data"))
_SEARCH_DIRS = (_PRIMARY_DIR,)



def search_dirs():
    """Directories searched for JSON maps, in order, without duplicates."""
    seen, out = set(), []
    for directory in _SEARCH_DIRS:
        key = str(directory)
        if key not in seen:
            seen.add(key)
            out.append(directory)
    return tuple(out)


def map_dir() -> Path:
    """The directory new maps are written to (the first one that exists)."""
    for directory in search_dirs():
        if directory.is_dir():
            return directory
    return _PRIMARY_DIR


def find_map(name: str):
    """Absolute path of a JSON map, or ``None`` when it is not shipped.

    ``name`` may be a bare file name (``scan.json``), a relative path
    (``vector/index.svg``) or an absolute path.
    """
    candidate = Path(name)
    if candidate.is_absolute():
        return candidate if candidate.is_file() else None
    for directory in search_dirs():
        path = directory / name
        if path.is_file():
            return path
        # A sealed container may be the only copy on disk.
        if not name.endswith(".enc"):
            sealed = path.with_name(path.name + ".enc")
            if sealed.is_file():
                return sealed
    return None


def map_path(name: str) -> Path:
    """Like :func:`find_map` but raises instead of returning ``None``."""
    path = find_map(name)
    if path is None:
        searched = ", ".join(str(d) for d in search_dirs())
        raise FileNotFoundError(
            f"JSON map {name!r} is not present; searched: {searched}. "
            "The Python parser reads data only — copy the map JSON, do not "
            "wire in a JavaScript module."
        )
    return path


def read_json(path) -> object:
    """Load one JSON (or sealed ``.enc`` JSON) file."""
    path = Path(path)
    if path.suffix.lower() == ".enc":
        from myangustis_parser.resources.engine import read_secure_json  # local import: avoids a cycle
        return read_secure_json(path)
    with path.open(encoding="utf-8") as source:
        return json.load(source)


@lru_cache(maxsize=None)
def load_map(name: str) -> object:
    """Load a shipped map by name once per process."""
    return read_json(map_path(name))


def load_optional(name: str, default=None):
    """Load a map when it is shipped, else return ``default``."""
    path = find_map(name)
    if path is None:
        return default
    return read_json(path)


def clear_cache() -> None:
    """Drop cached maps (tests that replace a JSON file use this)."""
    load_map.cache_clear()
