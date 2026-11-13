"""Read encrypted engine data without a JavaScript runtime or plaintext files."""
import hashlib
import json
import os
from pathlib import Path
import re

ENGINE_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ENGINE_ROOT / '.data'
MASTER_ENC = Path(os.environ.get('MYANGUSTIS_MASTER_ENC', DATA_DIR / 'master.json.enc'))
# Prefer the conventional local key if present; the bundled test key is public.
_DEFAULT_KEY_FILE = DATA_DIR / 'master.key.txt'
if not _DEFAULT_KEY_FILE.exists():
    _DEFAULT_KEY_FILE = DATA_DIR / 'note.test.txt'
MASTER_KEY_FILE = Path(os.environ.get('MYANGUSTIS_MASTER_KEY_FILE', _DEFAULT_KEY_FILE))


def _key():
    value = os.environ.get('MASTER_JSON_KEY', '').strip()
    if not value:
        try:
            value = MASTER_KEY_FILE.read_text(encoding='utf-8').strip()
        except FileNotFoundError as exc:
            raise RuntimeError('Set MASTER_JSON_KEY or MYANGUSTIS_MASTER_KEY_FILE') from exc
    if not re.fullmatch(r'[0-9a-fA-F]{64}', value):
        raise ValueError('The master key must be exactly 32 bytes in hexadecimal')
    return bytes.fromhex(value)


def _open_container(path):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    sealed = Path(path).read_bytes()
    if len(sealed) < 32 or sealed[:4] != b'MGR1':
        raise ValueError(f'Invalid MGR1 container: {path}')
    return AESGCM(_key()).decrypt(sealed[4:16], sealed[32:] + sealed[16:32], None).decode('utf-8')


def master_fingerprint(): return hashlib.sha256(MASTER_ENC.read_bytes()).hexdigest()
def read_master_text(): return _open_container(MASTER_ENC)
def read_master_json(): return json.loads(read_master_text())


def read_secure_text(file):
    path = Path(file)
    encrypted = path if str(path).endswith('.enc') else Path(str(path) + '.enc')
    if encrypted.resolve() == MASTER_ENC.resolve(): return read_master_text()
    if encrypted.exists(): return _open_container(encrypted)
    return path.read_text(encoding='utf-8')


def read_secure_json(file): return json.loads(read_secure_text(file))


def load_main_rules():
    return json.loads((ENGINE_ROOT / 'knowledge/isTreasure/mainrules.json').read_text(encoding='utf-8'))


def load_template_data():
    document = json.loads((ENGINE_ROOT / 'knowledge/isTreasure/template-data.json').read_text(encoding='utf-8'))
    document['StyleSets'] = {key: set(value) for key, value in document['StyleSets'].items()}
    return document
