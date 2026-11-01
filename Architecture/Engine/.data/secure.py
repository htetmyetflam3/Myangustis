"""Read the Engine's sealed master in memory, without a Node subprocess."""

import json
import os
import re
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_DATA_DIR = Path(__file__).resolve().parent
MASTER_ENC = _DATA_DIR / "master.json.enc"
_MASTER_KEY_FILE = _DATA_DIR / "master.key.txt"


def read_master_json():
    """Decrypt the existing AES-256-GCM master and return its JSON object."""
    key_hex = os.environ.get("MASTER_JSON_KEY", "").strip()
    if not key_hex:
        try:
            key_hex = _MASTER_KEY_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError as exc:
            raise RuntimeError("MASTER_JSON_KEY or the tracked master key file is required") from exc
    if not re.fullmatch(r"[0-9a-fA-F]{64}", key_hex):
        raise ValueError("The master key must be exactly 32 bytes in hexadecimal")

    sealed = MASTER_ENC.read_bytes()
    header_length = 4 + 12 + 16
    if len(sealed) < header_length or sealed[:4] != b"MGR1":
        raise ValueError(f"Invalid MGR1 container: {MASTER_ENC}")
    iv = sealed[4:16]
    tag = sealed[16:header_length]
    payload = AESGCM(bytes.fromhex(key_hex)).decrypt(iv, sealed[header_length:] + tag, None)
    return json.loads(payload)
