"""secretloader.py — single .env / environment loader for the Python side.

Mirrors secretloader.js semantics so JS and Python resolve secrets identically:

    Priority per key (first win):
      1. os.environ already set (shell, CI, systemd, Docker).
      2. .env next to the caller's file (the directory of __file__).
      3. .env at the repo root (walk up from the caller until pyproject.toml
         or package.json is found).
      4. .data/.env at the repo root (sealed-key companion).

    If no .env is found anywhere, os.environ is the sole source. Only
    require_secret / require_all throw on miss.

    Syntax: KEY=val, export KEY=val, single/double quotes, # comments,
    blank lines. No shell interpolation.

Usage:

    from pathlib import Path
    from secretloader import load_secrets, secret, require_secret, require_all

    load_secrets(__file__)                   # fills os.environ gaps, idempotent
    api_key = secret("API_KEY") or ""        # "" if missing
    master = require_secret("MASTER_JSON_KEY", __file__)   # raises if missing
    require_all(["API_KEY", "COOKIE_SECRET"], __file__)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Iterable

_VALID_KEY = __import__("re").compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_loaded_caller_files: set[str] = set()


# ── parsing ──────────────────────────────────────────────────────────────────

def parse_dotenv(text: str) -> dict[str, str]:
    """Parse dotenv text into {key: value}. No IO."""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not _VALID_KEY.match(key):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        else:
            hash_idx = value.find(" #")
            if hash_idx != -1:
                value = value[:hash_idx].rstrip()
        out[key] = value
    return out


# ── discovery ────────────────────────────────────────────────────────────────

def find_repo_root(start_dir: str | Path) -> Path | None:
    """Walk up until we hit a directory holding package.json or pyproject.toml."""
    d = Path(start_dir).resolve()
    while True:
        if (d / "package.json").is_file() or (d / "pyproject.toml").is_file():
            return d
        parent = d.parent
        if parent == d:
            return None
        d = parent


def candidate_env_files(caller_file: str | Path) -> list[Path]:
    """Return existing .env paths, priority-ordered (caller → root → .data/)."""
    caller_dir = Path(caller_file).resolve().parent
    cands: list[Path] = []
    local = caller_dir / ".env"
    if local.is_file():
        cands.append(local)
    root = find_repo_root(caller_dir)
    if root:
        root_env = root / ".env"
        if root_env.is_file() and root_env != local:
            cands.append(root_env)
        data_env = root / ".data" / ".env"
        if data_env.is_file():
            cands.append(data_env)
    return cands


def _safe_read(path: Path) -> dict[str, str]:
    try:
        return parse_dotenv(path.read_text(encoding="utf-8"))
    except OSError:
        return {}


def _apply_to_environ(values: dict[str, str]) -> list[str]:
    """Fill gaps in os.environ. Never overwrites an existing non-empty value."""
    set_keys: list[str] = []
    for k, v in values.items():
        if os.environ.get(k, "") == "":
            os.environ[k] = v
            set_keys.append(k)
    return set_keys


# ── public API ───────────────────────────────────────────────────────────────

def load_secrets(caller_file: str | Path) -> dict:
    """Load .env files for a caller and fill gaps in os.environ. Idempotent."""
    caller_path = str(Path(caller_file).resolve())
    if caller_path in _loaded_caller_files:
        return {"applied": {}, "sources": []}
    _loaded_caller_files.add(caller_path)
    files = candidate_env_files(caller_path)
    merged: dict[str, str] = {}
    for f in reversed(files):            # farther-first so caller wins
        merged.update(_safe_read(f))
    set_keys = _apply_to_environ(merged)
    return {"applied": merged, "sources": [str(p) for p in files], "set": set_keys}


def secret(key: str, fallback: str | None = None) -> str:
    """Return os.environ[key] or fallback. Empty string counts as 'not set'."""
    v = os.environ.get(key, "")
    if v:
        return v
    return "" if fallback is None else str(fallback)


def require_secret(key: str, caller_file: str | Path | None = None) -> str:
    """Return a required secret, raising a helpful error if missing."""
    v = os.environ.get(key, "")
    if v:
        return v
    searched: list[str] = []
    if caller_file is not None:
        searched = [str(p) for p in candidate_env_files(caller_file)]
    loc = (
        f"Searched .env at: {', '.join(searched)}, plus os.environ."
        if searched
        else "No .env file was found; set the variable in the environment."
    )
    raise RuntimeError(f"Missing required secret '{key}'. {loc}")


def require_all(keys: Iterable[str], caller_file: str | Path | None = None) -> dict[str, str]:
    """Require several keys at once; returns {key: value}."""
    out: dict[str, str] = {}
    for k in keys:
        out[k] = require_secret(k, caller_file)
    return out


def _reset_for_tests() -> None:
    _loaded_caller_files.clear()


__all__ = [
    "load_secrets",
    "secret",
    "require_secret",
    "require_all",
    "parse_dotenv",
    "candidate_env_files",
    "find_repo_root",
    "_reset_for_tests",
]
