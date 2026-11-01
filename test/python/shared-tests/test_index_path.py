import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class WorkspaceEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ("index-path.py", "index-path.js"):
            shutil.copyfile(ROOT / name, self.root / name)
        (self.root / "package.json").write_text('{"type":"module"}')
        self.data = self.root / "Architecture/Engine/.data"
        self.data.mkdir(parents=True)
        self.env = {**os.environ, "CHAIN_SHELL": "shell", "CHAIN_EMPTY": ""}
        for name in ("CHAIN_VALUE", "CHAIN_DATA", "CHAIN_OLD", "CHAIN_ONLY"):
            self.env.pop(name, None)

    def python(self, code):
        return subprocess.check_output([sys.executable, "-c", code], cwd=self.root,
                                       env=self.env, text=True)

    def test_python_and_node_load_the_same_sources_and_precedence(self):
        (self.root / ".env").write_text("CHAIN_VALUE=root\nCHAIN_SHELL=file\nCHAIN_EMPTY=filled\n")
        (self.data / ".env").write_text("CHAIN_VALUE=data\nCHAIN_DATA=data\n")
        (self.root / ".data").mkdir()
        (self.root / ".data/.env").write_text("CHAIN_OLD=forbidden\n")
        keys = ["CHAIN_VALUE", "CHAIN_SHELL", "CHAIN_EMPTY", "CHAIN_DATA", "CHAIN_OLD"]
        python = json.loads(self.python(
            "import importlib,json,os; p=importlib.import_module('index-path'); "
            f"print(json.dumps({{'env':p.ENV_RESULT,'values':{{k:os.environ.get(k) for k in {keys!r}}},'junk':str(p.JUNK_DIR)}}))"))
        node = json.loads(subprocess.check_output(["node", "--input-type=module", "-e",
            "import {ENV_RESULT,JUNK_DIR} from './index-path.js'; "
            f"const keys={json.dumps(keys)}; console.log(JSON.stringify({{env:ENV_RESULT,values:Object.fromEntries(keys.map(k=>[k,process.env[k]??null])),junk:JUNK_DIR}}));"],
            cwd=self.root, env=self.env, text=True))
        self.assertEqual(python, node)
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

    def test_existing_python_consumers_use_shared_workspace_environment(self):
        for name in ('tools-box/python/hfinit.py', 'E.Scraper/main/modules/guard/helper/site_login.py',
                     'C.Proofreading/main/tools/api/rapidapi_translator.py'):
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, target)
        (self.root / '.env').write_text('LOGIN_USERNAME=from-root\nLOGIN_PASSWORD=password\nRAPIDAPI_KEY=root-key\nHG_TOKEN=root-token\n')
        (self.root / 'C.Proofreading/main/tools/api/.env').write_text('RAPIDAPI_KEY=local-key\n')
        self.env.update({'LOGIN_USERNAME': '', 'LOGIN_PASSWORD': '', 'RAPIDAPI_KEY': '', 'HG_TOKEN': ''})
        script = """
import importlib.util, json, os, sys, types
from pathlib import Path
# Only credential loading is exercised; network dependencies may be absent.
if importlib.util.find_spec('httpx') is None:
    sys.modules['httpx'] = types.ModuleType('httpx')
if importlib.util.find_spec('bs4') is None:
    bs4 = types.ModuleType('bs4')
    bs4.BeautifulSoup = bs4.Tag = object
    sys.modules['bs4'] = bs4
for name, filename in [('hf', 'tools-box/python/hfinit.py'), ('login', 'E.Scraper/main/modules/guard/helper/site_login.py'), ('api', 'C.Proofreading/main/tools/api/rapidapi_translator.py')]:
    spec = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    if name == 'login':
        credentials = module.load_credentials('example.com')
        assert credentials.username == 'from-root' and credentials.password == 'password'
    if name == 'api':
        assert module.parse_env_file(Path('.env'))['RAPIDAPI_KEY'] == 'root-key'
print(json.dumps([os.environ['RAPIDAPI_KEY'], os.environ['HG_TOKEN']]))
"""
        self.assertEqual(json.loads(self.python(script)), ['root-key', 'root-token'])


if __name__ == '__main__':
    unittest.main()
