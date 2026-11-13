"""Explicit tree builder. Never imported by the segmentation or POS runtime."""
import argparse
import json
from pathlib import Path
from .disassembler import Bb, build_syllable_lookup, build_pos_tree, extract_pos_data
from myangustis_engine.secure_data.secure import read_master_json, master_fingerprint
from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import TREE_DIR, write_cache_manifest
from myangustis_engine.MonoSyllabism.map.normalize import mapperNormalize


def build(output_dir, master, mapper=mapperNormalize, *, source_master_sha256=None):
    syllables = master.get('syllables', [])
    if isinstance(syllables, dict): syllables = [s for value in syllables.values() if isinstance(value, list) for s in value]
    if not isinstance(syllables, list) or not syllables: raise ValueError('Master contains no syllables')
    result = build_syllable_lookup(syllables, mapper)
    # First mapping wins, like the JS buildPos path; runtime map loading has its own policy.
    mapping = {}
    for row in result['refArray']: mapping.setdefault(row['original'], row['id'])
    _, pos = extract_pos_data(master)
    pos_result = build_pos_tree(mapping, pos)
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    def write_json(name, value):
        (directory / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
    write_json('syllable.tree.json', Bb(result['lookupData'])['data'])
    write_json('rtl-tree.json', result['rtlGrouped'])
    write_json('ref-syllables.json', result['refArray'])
    write_json('pos.tree.json', pos_result['tree'])
    (directory / 'syllable.mapped.txt').write_text('\n'.join(result['mappedLines']) + '\n', encoding='utf-8')
    failures = pos_result['failedEntries']
    fail_path = directory / 'pos-fail.txt'
    if failures:
        fail_path.write_text(''.join(f'[{e["pos"]}] "{e["line"]}" | missing: {", ".join(e["missing"])}\n' for e in failures), encoding='utf-8')
    elif fail_path.exists(): fail_path.unlink()
    # Unlike the kit's destructive cleanup, leave the supplied master untouched.
    metadata = {'builder': 'python', 'excludedPosEntries': len(failures)}
    if source_master_sha256 is not None:
        metadata['sourceMasterSha256'] = source_master_sha256
    write_cache_manifest(directory, metadata)
    return {'output': str(directory), 'syllables': len(result['refArray']), 'posRoots': len(pos_result['tree']), 'failures': len(failures)}


def main():
    parser = argparse.ArgumentParser(description='Build engine trees separately from runtime')
    parser.add_argument('--output', type=Path, default=TREE_DIR)
    args = parser.parse_args()
    print(json.dumps(build(args.output, read_master_json(), source_master_sha256=master_fingerprint()), ensure_ascii=False))


if __name__ == '__main__': main()
