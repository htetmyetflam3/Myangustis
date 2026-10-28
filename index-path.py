"""Shared Python workspace paths and environment, matching index-path.js."""

import os
import re
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
JUNK_DIR = ROOT_DIR / "Junk"
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


def load_root_env():
    """Use process environment, root .env, then engine data .env, in that order."""
    sources = []
    applied = []
    for file in (ROOT_DIR / ".env", ROOT_DIR / "Architecture/Engine/.data/.env"):
        try:
            names = load_env_file(file)
        except FileNotFoundError:
            continue
        sources.append(str(file))
        applied.extend(names)
    return {"sources": sources, "applied": applied}


ENV_RESULT = load_root_env()
JUNK_DIR.mkdir(parents=True, exist_ok=True)
