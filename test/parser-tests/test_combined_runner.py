"""Root launcher starts only scraper and parser and installs its own unit."""
import importlib.util
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('combined_runner', ROOT / 'main.py')
combined = importlib.util.module_from_spec(spec)
spec.loader.exec_module(combined)


class TestCombinedRunner(unittest.TestCase):
    def test_root_service_command_runs_foreground_children(self):
        import systemd_lib
        with patch.object(systemd_lib, 'install_and_start') as install:
            self.assertEqual(combined.main(['--service', '--', '--process', '-l', '2']), 0)
        name, cmd, cwd = install.call_args.args
        self.assertEqual(name, 'myangustis.service')
        self.assertIn('--foreground', cmd)
        self.assertEqual(cmd[-3:], ['--process', '-l', '2'])
        self.assertNotIn('ocr', ' '.join(cmd))
        self.assertEqual(cwd, ROOT)

    def test_two_workers_parallel_and_scraper_email_not_disabled(self):
        class Child:
            def __init__(self, parser=False): self.parser, self.returncode, self.stopped = parser, None, False
            def poll(self): return self.returncode
            def wait(self, timeout=None):
                if self.parser and not self.stopped:
                    self.returncode = 2
                    return 2
                return 0
            def terminate(self): self.stopped = True; self.returncode = -15
            def kill(self): self.returncode = -9
        scraper, parser = Child(), Child(True)
        with patch.object(combined.subprocess, 'Popen', side_effect=[scraper, parser]) as popen:
            self.assertEqual(combined.run(['--process']), 2)
        calls = popen.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertIn('--process', calls[0].args[0])
        self.assertEqual(calls[0].kwargs['cwd'], ROOT / 'D.Scraper/run')
        self.assertEqual(calls[0].kwargs['env']['SCRAPER_SYSTEMD_DIRECT'], '1')
        self.assertEqual(calls[1].args[0][-3:], ['parse', '--ssh', '--foreground'])
        self.assertNotIn('ocr', calls[1].args[0])
        self.assertTrue(scraper.stopped)


if __name__ == '__main__': unittest.main()
