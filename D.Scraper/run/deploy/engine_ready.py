#!/usr/bin/env python3
"""Check the Python engine and prebuilt trees without building or modifying them."""
from __future__ import annotations
import argparse
import asyncio
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    # Kept for existing unit files: this never builds trees or changes data.
    parser.add_argument('--fix', action='store_true', help='compatibility option; never builds trees')
    parser.parse_args(argv)
    try:
        from myangustis_engine import bind_engine
        from myangustis_engine.secure_data.secure import read_master_json
        from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import verify_cache_tree
        manifest = verify_cache_tree()
        required = {'syllable.tree.json', 'rtl-tree.json', 'pos.tree.json', 'syllable.mapped.txt'}
        missing = required.difference(manifest['files'])
        if missing:
            raise ValueError(f'missing prebuilt tree files: {", ".join(sorted(missing))}')
        read_master_json()
        async def check():
            async for _ in bind_engine({'sourceText': '', 'flag': 'syllable', 'log': False}):
                pass
        asyncio.run(check())
    except Exception as error:
        print(f'[engine] not ready: {error}', file=sys.stderr)
        return 1
    print('[engine] Python engine, sealed master, and prebuilt trees are ready')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
