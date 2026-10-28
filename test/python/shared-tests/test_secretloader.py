import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parents[3]


class SharedSecretLoaderTests(unittest.TestCase):
    def test_workspaces_resolve_the_shared_loader(self):
        for workspace in ("B.Parser", "C.Proofreading", "E.Scraper", "tools-box"):
            with self.subTest(workspace=workspace):
                result = subprocess.check_output(
                    [sys.executable, "-c", "import sys; from pathlib import Path; "
                     "p=Path.cwd(); "
                     "\nwhile p.parent != p and not (p / 'secretloader.py').is_file(): p=p.parent\n"
                     "sys.path.insert(0, str(p)); import secretloader; print(secretloader.__file__)"],
                    cwd=ROOT / workspace, text=True,
                )
                self.assertEqual(Path(result.strip()), ROOT / "secretloader.py")

    def test_caller_env_priority_is_unchanged(self):
        spec = importlib.util.spec_from_file_location("shared_secretloader", ROOT / "secretloader.py")
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        caller = ROOT / "E.Scraper/main/modules/guard/helper/site_login.py"
        self.assertEqual(loader.find_repo_root(caller.parent), ROOT / "E.Scraper")
        self.assertEqual(loader.parse_dotenv('export KEY="value"\n'), {"KEY": "value"})


    def test_shared_loader_respects_environment_and_caller_priority(self):
        spec = importlib.util.spec_from_file_location("shared_secretloader", ROOT / "secretloader.py")
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            caller = project / "sub" / "script.py"
            caller.parent.mkdir()
            (project / "pyproject.toml").write_text("")
            (project / ".env").write_text("TEST_SHARED_VALUE=root\nTEST_SHARED_OTHER=root\n")
            (caller.parent / ".env").write_text("TEST_SHARED_VALUE=caller\n")
            with patch.dict(os.environ, {"TEST_SHARED_OTHER": "environment"}, clear=True):
                loader.load_secrets(caller)
                self.assertEqual(os.environ["TEST_SHARED_VALUE"], "caller")
                self.assertEqual(os.environ["TEST_SHARED_OTHER"], "environment")

    def test_data_env_only_comes_from_engine_not_root(self):
        spec = importlib.util.spec_from_file_location("shared_secretloader", ROOT / "secretloader.py")
        loader = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(loader)
        with tempfile.TemporaryDirectory() as temporary:
            project = Path(temporary)
            caller = project / "component" / "script.py"
            caller.parent.mkdir()
            (project / "pyproject.toml").write_text("")
            (project / ".data").mkdir()
            (project / ".data/.env").write_text("OLD_ONLY=incorrect\n")
            data = project / "Architecture/Engine/.data"
            data.mkdir(parents=True)
            (data / ".env").write_text("ENGINE_ONLY=correct\n")
            with patch.object(loader, "__file__", str(project / "secretloader.py")), patch.dict(os.environ, {}, clear=True):
                result = loader.load_secrets(caller)
                self.assertEqual(os.environ["ENGINE_ONLY"], "correct")
                self.assertNotIn("OLD_ONLY", os.environ)
                self.assertEqual(result["sources"], [str(data / ".env")])


if __name__ == "__main__":
    unittest.main()
