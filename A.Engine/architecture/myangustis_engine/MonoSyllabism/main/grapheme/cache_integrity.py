import hashlib, json, os
from functools import lru_cache
from pathlib import Path
TREE_DIR = Path(os.environ.get('MYANGUSTIS_TREE_DIR', Path(__file__).resolve().parents[3] / '.cache-tree'))

@lru_cache(maxsize=None)
def verify_cache_tree(tree_dir=TREE_DIR):
    directory = Path(tree_dir).resolve()
    path = directory / 'CACHE-MANIFEST.json'
    try:
        manifest = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ValueError(f'Cannot read prebuilt tree manifest: {path}') from exc
    files = manifest.get('files')
    if not isinstance(files, dict) or not files:
        raise ValueError(f'Prebuilt tree manifest lists no files: {path}')
    for name, expected in files.items():
        target = (directory / name).resolve()
        if target.parent != directory:
            raise ValueError(f'Invalid tree manifest path: {name}')
        try:
            actual = hashlib.sha256(target.read_bytes()).hexdigest()
        except OSError as exc:
            raise ValueError(f'Prebuilt tree file missing: {target}') from exc
        if actual != expected:
            raise ValueError(f'Prebuilt tree integrity failed for {name}: {actual} != {expected}')
    return manifest


def cache_info(tree_dir=TREE_DIR):
    directory = Path(tree_dir).resolve()
    manifest = verify_cache_tree(directory)
    return {'manifest': 'CACHE-MANIFEST.json', 'treeDir': str(directory),
            'rebuilt': manifest.get('rebuilt'), 'generatedAt': manifest.get('generatedAt'),
            'counts': manifest.get('counts', {}), 'files': list(manifest['files'])}


def write_cache_manifest(tree_dir=TREE_DIR, meta=None):
    from datetime import datetime, timezone
    import os
    directory = Path(tree_dir).resolve()
    files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(directory.iterdir())
             if p.is_file() and p.name != 'CACHE-MANIFEST.json'}
    pos = directory / 'pos.tree.json'
    counts = {'posRoots': len(json.loads(pos.read_text(encoding='utf-8')))} if pos.exists() else {}
    manifest = {**(meta or {}), 'generatedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                'treeDir': os.path.relpath(directory), 'counts': counts, 'files': files}
    (directory / 'CACHE-MANIFEST.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    verify_cache_tree.cache_clear()
    from myangustis_engine.MonoSyllabism.main.grapheme.tree_loaded import load_tree, mappings
    load_tree.cache_clear()
    mappings.cache_clear()
    return manifest
