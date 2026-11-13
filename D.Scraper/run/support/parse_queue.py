"""Configuration of the shared-host queue for the continuous parse service."""
import os
import importlib
import sys
from pathlib import Path

from save_remote import _env_values


def load_workspace_env():
    """Load the repository root .env before reading the SSH/queue settings."""
    root = Path(__file__).resolve().parents[3]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    importlib.import_module('index-path').load_root_env()


def remote_parser_dir():
    """Return one direct child of SSH_DIR; /old/ is relative, not absolute.

    Environment wins. The scraper's existing dotenv reader is a fallback; the
    shared workspace loader supplies the repository-root .env to the environment.
    """
    raw = (os.environ.get('REMOTE_PRASER_DIR', '').strip()
           or _env_values().get('REMOTE_PRASER_DIR', '').strip()
           or 'convertable')
    name = raw.strip('/')
    if (not name or name in ('.', '..') or '/' in name or '\\' in name
            or any(ord(ch) < 32 for ch in name)):
        raise ValueError('REMOTE_PRASER_DIR must be one direct child of SSH_DIR')
    return name
