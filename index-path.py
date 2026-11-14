"""Shared Python workspace paths and environment, matching index-path.js."""

import importlib.util
import os
import re
from functools import lru_cache
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
JUNK_DIR = ROOT_DIR / "Junk"
ENGINE_DATA_DIR = ROOT_DIR / "A.Engine" / "architecture" / "myangustis_engine" / ".data"
_VALID_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_dotenv(text):
    """Parse the dotenv forms accepted by Node's util.parseEnv for valid keys."""
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    values = {}
    i = 0
    while i < len(lines):
        line = lines[i].lstrip()
        i += 1
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key.startswith("export "):
            key = key[7:].strip()
        valid_key = bool(_VALID_KEY.fullmatch(key))
        had_whitespace = bool(value) and value[0].isspace()
        value = value.lstrip()
        if had_whitespace and not value:
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i < len(lines):
                value = lines[i].lstrip()
                i += 1
        if value and value[0] in "\"'`":
            quote = value[0]
            parts = [value[1:]]
            end = parts[-1].find(quote)
            next_line = i
            while end < 0 and next_line < len(lines):
                parts.append(lines[next_line])
                next_line += 1
                end = parts[-1].find(quote)
            if end >= 0:
                parts[-1] = parts[-1][:end]
                value = "\n".join(parts)
                if quote == '"':
                    value = value.replace("\\n", "\n")
                i = next_line
                if valid_key:
                    values[key] = value
                continue
        if valid_key:
            values[key] = value.split("#", 1)[0].strip()
    # Node's parseEnv enumerates parsed names in sorted order.
    return dict(sorted(values.items()))


def load_env_file(path, *, override=False):
    """Apply one dotenv file and return the names applied to the environment."""
    values = parse_dotenv(Path(path).read_text(encoding="utf-8"))
    applied = []
    for key, value in values.items():
        if override or not os.environ.get(key):
            os.environ[key] = value
            applied.append(key)
    return applied


# ── path anchoring ───────────────────────────────────────────────────────
# Every path in .env is written by a human who thinks in workspace terms:
#   PARSER_INPUT_DIR=/Junk/Parser/upload/
#   PARSER_LOG_FILE=/log/
#   PRASER_OUTPUT_DIR=./output/
# A leading "/" must NOT mean "the filesystem root" — it means the project
# root. Without this, "/Junk/..." resolves to "/Junk/..." on disk and the
# parser silently reads from the wrong place (or nothing at all).
#
# Rules, in order:
#   ""            -> None
#   "~/dir"       -> the user's home directory (explicit escape)
#   "abs:/dir"    -> a real host path (explicit escape, also file:/path:)
#   "C:\dir"      -> a Windows drive path, taken as written
#   "/dir"        -> <project>/dir when it does not exist on the host;
#                    an existing host directory is honoured as a deployment path
#   "dir", "./dir"-> <project>/dir
#
# PRASER_PATH_ROOT / MYANGUSTIS_PATH_ROOT move the anchor (default: this file's
# directory) without editing any other setting.
PATH_ROOT_ENV = ("PRASER_PATH_ROOT", "MYANGUSTIS_PATH_ROOT")
ABSOLUTE_PREFIXES = ("abs:", "file:", "path:")
_WINDOWS_DRIVE = re.compile(r"^[A-Za-z]:[\\/]")


def path_root():
    """The directory relative and slash-leading .env paths are anchored to."""
    for name in PATH_ROOT_ENV:
        raw = (os.environ.get(name) or "").strip()
        if raw:
            return anchor(raw, base=ROOT_DIR)
    return ROOT_DIR


def host_location(path):
    """True when an absolute value names a real place on this host.

    A value whose nearest existing ancestor is the filesystem root is a project
    path written with a leading slash (``/Junk/...``, ``/log/``), not a host
    location.
    """
    current = Path(path)
    while True:
        if current.exists():
            return current != Path(current.anchor)
        if current == Path(current.anchor):
            return False
        current = current.parent


def anchor(value, *, base=None):
    """Resolve one .env path value against the project root.

    ``base`` defaults to :func:`path_root`. Returns ``None`` for an empty
    value so callers can write ``anchor(os.environ.get('X')) or default``.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    base = Path(base) if base is not None else path_root()
    lowered = text.lower()
    for prefix in ABSOLUTE_PREFIXES:
        if lowered.startswith(prefix):
            return Path(text[len(prefix):].strip()).expanduser()
    if text.startswith("~"):
        return Path(text).expanduser()
    if _WINDOWS_DRIVE.match(text):
        return Path(text)
    candidate = Path(text)
    if candidate.is_absolute():
        # An absolute value that really exists on this host is a deployment
        # path and is honoured. Anything else is a project path written with a
        # leading slash; drop the slash, never start from the filesystem root.
        if host_location(candidate) or candidate.is_relative_to(base):
            return candidate
        return base / str(candidate).lstrip("/\\")
    return base / candidate


def load_root_env():
    """Use process environment, root .env, then engine data .env, in that order."""
    sources = []
    applied = []
    for file in (ROOT_DIR / ".env", ENGINE_DATA_DIR / ".env"):
        try:
            names = load_env_file(file)
        except FileNotFoundError:
            continue
        sources.append(str(file))
        applied.extend(names)
    return {"sources": sources, "applied": applied}


@lru_cache(maxsize=1)
def get_engine_data():
    """Load the Engine's native Python secure-data reader on demand."""
    from myangustis_engine.secure_data import secure
    return secure


ENV_RESULT = load_root_env()
JUNK_DIR.mkdir(parents=True, exist_ok=True)
