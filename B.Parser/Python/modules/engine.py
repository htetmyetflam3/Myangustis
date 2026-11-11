"""Talk to the JavaScript **engine** as a child process.

There are three separate things in this repository, and only two of them are
parsers:

    B.Parser (JavaScript)   a parser      - a peer of the Python parser
    B.Parser/Python         a parser      - this tree, independent
    Architecture/Engine     the engine    - JavaScript, shared data owner

The Python parser does not re-implement the engine, and it does not decrypt
or read the engine's dictionary/master itself. The engine owns that data and
the JavaScript code that validates it, so Python asks the engine for it —
exactly the existing, supported route:

    node tools-box/js/engine-data.js master
    node tools-box/js/engine-data.js file <path>

This is a **data** call: no parsing is delegated, the JavaScript *parser* is
never invoked, and nothing here imports a `.js` module into Python. Keeping
the engine JS is deliberate — replacing it in Python would fork the
dictionary and drift.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

__all__ = [
    "EngineError",
    "available",
    "read_master_json",
    "read_secure_json",
    "master_info",
    "bridge_path",
    "clear_cache",
]

# modules/engine.py -> Python -> B.Parser -> repo root
REPO_ROOT = Path(__file__).resolve().parents[3]
BRIDGE = REPO_ROOT / "tools-box" / "js" / "engine-data.js"

_CACHE = {}


class EngineError(RuntimeError):
    """The JavaScript engine could not supply the requested data."""


def bridge_path() -> Path:
    return Path(os.environ.get("MYANGUSTIS_ENGINE_DATA_BRIDGE") or BRIDGE)


def available() -> bool:
    """True when Node and the engine-data bridge are both present."""
    if not bridge_path().is_file():
        return False
    node = os.environ.get("NODE_BINARY", "node")
    try:
        subprocess.run([node, "--version"], capture_output=True, check=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return False
    return True


def _node() -> str:
    return os.environ.get("NODE_BINARY", "node")


def _ask(operation, file=None):
    """Run one bridge operation and parse its JSON answer."""
    bridge = bridge_path()
    if not bridge.is_file():
        raise EngineError(
            f"engine bridge not found: {bridge}. The Python parser asks the "
            "JavaScript engine for dictionary/master data; point "
            "MYANGUSTIS_ENGINE_DATA_BRIDGE at tools-box/js/engine-data.js")
    command = [_node(), str(bridge), operation]
    if file is not None:
        command.append(str(Path(file).resolve()))
    timeout = int(os.environ.get("PRASER_ENGINE_TIMEOUT_SECONDS", "120"))
    try:
        proc = subprocess.run(command, capture_output=True, text=True,
                              encoding="utf-8", timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise EngineError(f"could not run the engine bridge: {exc}") from exc
    if proc.returncode != 0:
        detail = (proc.stderr or "").strip().splitlines()
        raise EngineError(detail[-1] if detail else
                          f"engine bridge exited {proc.returncode}")
    try:
        return json.loads(proc.stdout)
    except ValueError as exc:
        raise EngineError(f"engine bridge returned no valid JSON: {exc}") from exc


def _cache_key(operation, file=None):
    bridge = bridge_path()
    try:
        stat = bridge.stat()
        stamp = (stat.st_mtime_ns, stat.st_size)
    except OSError:
        stamp = None
    return (operation, str(Path(file).resolve()) if file else None, stamp)


def read_master_json():
    """The engine's master JSON (``mapData``, ``dictionary``, ...), from Node.

    Cached per process: the engine call costs a Node start-up, and the master
    does not change while a parse is running. Call :func:`clear_cache` after
    replacing it.
    """
    key = _cache_key("master")
    if key not in _CACHE:
        _CACHE[key] = _ask("master")
    return _CACHE[key]


def read_secure_json(file):
    """JSON from a sealed (``.enc``) or plain data file, via the engine."""
    path = Path(file)
    sealed = path if path.suffix.lower() == ".enc" else path.with_name(path.name + ".enc")
    target = sealed if sealed.is_file() else path
    if not target.is_file():
        raise EngineError(f"neither {path} nor {sealed} exists")
    key = _cache_key("file", target)
    if key not in _CACHE:
        _CACHE[key] = _ask("file", target)
    return _CACHE[key]


def master_info():
    """``{"master": <path>, "sha256": <digest>}`` from the engine."""
    return _ask("master-info")


def clear_cache():
    _CACHE.clear()
