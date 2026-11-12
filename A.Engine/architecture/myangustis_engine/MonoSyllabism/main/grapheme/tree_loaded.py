import json
from functools import lru_cache
from pathlib import Path
from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import TREE_DIR, verify_cache_tree

@lru_cache(maxsize=None)
def load_tree(name, tree_dir=TREE_DIR):
    directory = Path(tree_dir).resolve()
    manifest = verify_cache_tree(directory)
    if name not in manifest['files']:
        raise ValueError(f'Tree not listed in manifest: {name}')
    return json.loads((directory / name).read_text(encoding='utf-8'))


def mapped_rows(tree_dir=TREE_DIR):
    directory = Path(tree_dir).resolve()
    manifest = verify_cache_tree(directory)
    if 'syllable.mapped.txt' not in manifest['files']:
        raise ValueError('Mapped rows not listed in manifest')
    for line in (directory / 'syllable.mapped.txt').read_text(encoding='utf-8-sig').split('\n'):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = [p.strip().strip('\"\'') for p in line.split(':')]
        if len(parts) >= 3:
            yield {'burmese': parts[0], 'ascii': parts[1], 'id': parts[2]}


@lru_cache(maxsize=None)
def mappings(tree_dir=TREE_DIR):
    result = {'burmese': {}, 'ascii': {}, 'id_burmese': {}, 'id_ascii': {}}
    for row in mapped_rows(tree_dir):
        if row['id'] and row['ascii']:
            result['ascii'][row['ascii']] = row['id']
            result['id_ascii'][row['id']] = row['ascii']
        if row['id'] and row['burmese']:
            result['burmese'][row['burmese']] = row['id']
            result['id_burmese'][row['id']] = row['burmese']
    return result


def get_step_key(entry, step):
    return f'St-{step}' if entry and f'St-{step}' in entry and entry[f'St-{step}'] is not None else 'St-F'


def find_entry(step_data, text, pos):
    for item in step_data or []:
        token = next(iter(item), None)
        if token is not None and text.startswith(token, pos):
            return {'entry': item, 'tok': token, 'len': len(token)}
    return None


def load_syllables_data(path=None):
    from myangustis_engine.secure_data.secure import MASTER_ENC, read_secure_json
    document = read_secure_json(path or MASTER_ENC)
    syllables = document.get('syllables', [])
    if isinstance(syllables, dict): syllables = syllables.get('burmese', [])
    if not syllables: raise ValueError(f'No syllables found in {path or MASTER_ENC}')
    return syllables
