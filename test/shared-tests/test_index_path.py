import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class WorkspaceEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ("index-path.py",):
            shutil.copyfile(ROOT / name, self.root / name)
        (self.root / "package.json").write_text('{"type":"module"}')
        self.data = self.root / "A.Engine/architecture/myangustis_engine/.data"
        self.data.mkdir(parents=True)
        self.env = {**os.environ, "CHAIN_SHELL": "shell", "CHAIN_EMPTY": ""}
        for name in ("CHAIN_VALUE", "CHAIN_DATA", "CHAIN_OLD", "CHAIN_ONLY"):
            self.env.pop(name, None)

    def python(self, code):
        return subprocess.check_output([sys.executable, "-c", code], cwd=self.root,
                                       env=self.env, text=True)

    def test_python_loads_sources_with_expected_precedence(self):
        (self.root / ".env").write_text("CHAIN_VALUE=root\nCHAIN_SHELL=file\nCHAIN_EMPTY=filled\n")
        (self.data / ".env").write_text("CHAIN_VALUE=data\nCHAIN_DATA=data\n")
        (self.root / ".data").mkdir()
        (self.root / ".data/.env").write_text("CHAIN_OLD=forbidden\n")
        keys = ["CHAIN_VALUE", "CHAIN_SHELL", "CHAIN_EMPTY", "CHAIN_DATA", "CHAIN_OLD"]
        python = json.loads(self.python(
            "import importlib,json,os; p=importlib.import_module('index-path'); "
            f"print(json.dumps({{'env':p.ENV_RESULT,'values':{{k:os.environ.get(k) for k in {keys!r}}},'junk':str(p.JUNK_DIR)}}))"))
        self.assertEqual(python['values'], dict(zip(keys, ['root', 'shell', 'filled', 'data', None])))
        self.assertEqual(python['env']['sources'], [str(self.root / '.env'), str(self.data / '.env')])
        self.assertTrue((self.root / 'Junk').is_dir())

    def test_engine_source_works_without_root_and_missing_files_are_optional(self):
        (self.data / '.env').write_text('CHAIN_ONLY=engine\n')
        result = json.loads(self.python("import importlib,json,os; p=importlib.import_module('index-path'); print(json.dumps([p.ENV_RESULT,os.environ.get('CHAIN_ONLY')]))"))
        self.assertEqual(result, [{'sources': [str(self.data / '.env')], 'applied': ['CHAIN_ONLY']}, 'engine'])
        (self.data / '.env').unlink()
        result = json.loads(self.python("import importlib,json; p=importlib.import_module('index-path'); print(json.dumps(p.ENV_RESULT))"))
        self.assertEqual(result, {'sources': [], 'applied': []})

    def test_dotenv_parser_matches_node_for_supported_forms(self):
        text = """# comment
export EXPORTED="with spaces"
SINGLE='one # two'
BACKTICK=`literal`
HASH=before#after
SPACED=before # after
MULTI="first
second"
ESCAPE="line\\nnext"
DUP=first
DUP=last
EMPTY=
1BAD=x
invalid-key=y
NEXT=\x20\x20
    after-space
TAIL=tail
"""
        (self.root / 'sample.env').write_text(text)
        py = json.loads(self.python("import importlib,json,pathlib; p=importlib.import_module('index-path'); print(json.dumps(p.parse_dotenv(pathlib.Path('sample.env').read_text())))"))
        node = json.loads(subprocess.check_output(['node', '--input-type=module', '-e',
            "import {parseEnv} from 'node:util'; import fs from 'node:fs'; const o=parseEnv(fs.readFileSync('sample.env','utf8')); console.log(JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k])=>/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)))));"],
            cwd=self.root, env=self.env, text=True))
        self.assertEqual(py, node)



if __name__ == '__main__':
    unittest.main()
