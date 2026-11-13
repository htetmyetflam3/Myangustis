#!/usr/bin/env python3
"""Run from an existing scraper checkout: uv run ocr.py (no flags).

Install its independent systemd units,
and start OCR detached from this SSH session. Existing scraper modules and
configuration are imported in place, never copied over or replaced.
"""
from __future__ import annotations
import fcntl
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def call(*args, **kwargs):
    return subprocess.run([str(x) for x in args], check=True, **kwargs)


def main():
    if os.geteuid() != 0 or not Path('/run/systemd/system').is_dir():
        sys.exit('Run uv run ocr.py as root on your systemd VPS.')
    for executable in ['uv', 'tesseract', 'ssh', 'systemctl']:
        if not shutil.which(executable):
            sys.exit(f'{executable} must be installed and on PATH.')
    state_dir = ROOT / 'scan' / 'ocr'
    state_dir.mkdir(parents=True, exist_ok=True)
    with (state_dir / 'launch.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        active = subprocess.run(['systemctl', 'is-active', 'scraper-ocr.service'],
                                capture_output=True, text=True).stdout.strip()
        if active in {'active', 'activating', 'reloading'}:
            print('OCR is already running. Logs: journalctl -u scraper-ocr.service -f')
            return
        if active == 'deactivating':
            sys.exit('OCR is stopping; run this command again after it stops.')
        # Use the existing SSH loader as-is. No duplicate credentials parser.
        sys.path.insert(0, str(ROOT))
        import bootstrap  # noqa: E402,F401
        from save_remote import load_config
        config = load_config()
        print(f'Using existing scraper SSH settings: {config.user}@{config.host}:{config.port}', flush=True)
        # Stop only our reminder units before refreshing our unit definitions.
        # An absent unit on first run is normal. Never stop scraper.service.
        subprocess.run(['systemctl', 'stop', 'scraper-ocr-reminder.timer',
                        'scraper-ocr-reminder.service'], check=False)
        call(sys.executable, ROOT / 'deploy' / 'continuous-ocr' / 'install.py', cwd=ROOT)
        call('systemctl', 'start', '--no-block', 'scraper-ocr.service', cwd=ROOT)
        print('OCR start requested in the background. You can close SSH.\n'
              'Status: systemctl status scraper-ocr.service\n'
              'Logs: journalctl -u scraper-ocr.service -f\n'
              'Stop: systemctl stop scraper-ocr.service', flush=True)

if __name__ == '__main__':
    main()
