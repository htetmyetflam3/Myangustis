"""The JSON-only bridge between the two parsers.

``B.Parser`` exists twice on purpose: a JavaScript implementation and this
Python one. They are **independent programs**. Neither imports the other,
neither starts the other as a child process, and no dependency chain runs in
either direction.

The one thing they share is *data*: every map, inventory and evidence table
lives in ``B.Parser/@jason-map`` as JSON (a ``.enc`` file is sealed JSON
bytes, still data). Change a map there and both parsers see it; that is the
whole integration contract. If Python needs a new constant, it belongs in a
JSON file — never in a ``.js`` module.

Resolution order for a map name:

1. ``PRASER_MAP_DIR`` (environment override, for tests and deployments)
2. ``B.Parser/@jason-map``            (current layout)
3. ``B.Parser/parser/jason-map``      (pre-move layout, read-only compatibility)
4. ``B.Parser/jason-map``             (older flat layout, read-only compatibility)
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

# modules/maps.py -> Python -> B.Parser
PARSER_ROOT = Path(__file__).resolve().parents[2]

_PRIMARY_DIR = Path(os.environ.get("PRASER_MAP_DIR") or (PARSER_ROOT / "@jason-map"))
_SEARCH_DIRS = (
    _PRIMARY_DIR,
    PARSER_ROOT / "parser" / "jason-map",
    PARSER_ROOT / "jason-map",
)


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
        from engine import read_secure_json  # local import: avoids a cycle
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
