"""Build a source-free runtime tree with Cython; use a clean output directory.

Run on the target OS/architecture/Python ABI. Trees and encrypted master are
provided separately; neither the master key nor source files are copied.
"""
import argparse
from pathlib import Path
import shutil
import sys
import tempfile
import subprocess

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='new, empty deployment directory')
    parser.add_argument('--trees', type=Path, help='verified prebuilt tree directory to copy')
    args = parser.parse_args()
    output = args.output.resolve()
    if output.exists() and any(output.iterdir()):
        parser.error('--output must be an empty directory')
    if output == ROOT or output in ROOT.parents:
        parser.error('output cannot contain the source repository')
    from Cython.Build import cythonize
    from Cython.Compiler import Options
    Options.docstrings = False
    from setuptools import Distribution, Extension
    from myangustis_engine.MonoSyllabism.main.grapheme.cache_integrity import verify_cache_tree

    files = [p for p in PACKAGE.rglob('*.py') if p.name != '__init__.py'
             and 'tests' not in p.parts and 'graph' not in p.parts and p.name != 'build_native.py']
    extensions = [Extension('.'.join(path.relative_to(ROOT).with_suffix('').parts), [str(path)],
                            extra_compile_args=['-g0'] if sys.platform != 'win32' else []) for path in files]
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='myangustis-cython-') as tmp:
        compiled = cythonize(extensions, build_dir=str(Path(tmp) / 'c'), compiler_directives={'language_level': 3, 'embedsignature': False}, quiet=True)
        dist = Distribution({'name': 'myangustis-engine-native', 'ext_modules': compiled})
        cmd = dist.get_command_obj('build_ext')
        cmd.build_lib = str(output)
        cmd.build_temp = str(Path(tmp) / 'objects')
        cmd.ensure_finalized()
        cmd.run()
    # Strip native debugging symbols when the platform tool is available.
    strip = shutil.which('strip') if sys.platform.startswith('linux') else None
    if strip:
        for extension in output.rglob('*.so'):
            subprocess.run([strip, '--strip-unneeded', str(extension)], check=True)
    # Minimal package glue only; all engine implementations are native modules.
    for path in PACKAGE.rglob('__init__.py'):
        if 'tests' in path.parts or 'graph' in path.parts: continue
        target = output / path.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(path.read_text() if path == PACKAGE / '__init__.py' else '', encoding='utf-8')
    knowledge = PACKAGE / 'knowledge/isTreasure'
    knowledge_target = output / 'myangustis_engine/knowledge/isTreasure'
    knowledge_target.mkdir(parents=True, exist_ok=True)
    for name in ('template-data.json', 'mainrules.json'):
        shutil.copy2(knowledge / name, knowledge_target / name)
    if args.trees:
        source = args.trees.resolve()
        manifest = verify_cache_tree(source)
        target = output / 'myangustis_engine/.cache-tree'
        target.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source / 'CACHE-MANIFEST.json', target)
        for name in manifest['files']: shutil.copy2(source / name, target / name)
    print(f'Native runtime built in {output}')


if __name__ == '__main__':
    # Invocation by file path must still see the package parent on the import path.
    sys.path.insert(0, str(ROOT))
    main()
