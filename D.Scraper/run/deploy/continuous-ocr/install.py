#!/usr/bin/env python3
"""Install independent OCR service and failure-reminder timer; does not start OCR."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

def q(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('%', '%%').replace('$', '$$') + '"'

def render_units(uv):
    """Generate unit files without mutating the host (also used by verification)."""
    path = ':'.join(dict.fromkeys([str(Path(uv).parent),
                                  '/usr/local/sbin','/usr/local/bin','/usr/sbin','/usr/bin','/sbin','/bin']))
    command = ' '.join(map(q, [uv, 'run', '--project', ROOT.parent, '--', 'python', '-u', HERE / 'run.py']))
    preflight = ' '.join(map(q, [uv, 'run', '--project', ROOT.parent, '--', 'python', ROOT / 'deploy' / 'engine_ready.py', '--fix']))
    common = f'''User=root
WorkingDirectory={str(ROOT).replace('%','%%')}
Environment=PATH={path}
Environment=PYTHONUNBUFFERED=1
EnvironmentFile=-{str(ROOT).replace('%','%%')}/.env
StandardOutput=journal
StandardError=journal
'''
    return {
        'scraper-ocr.service': f'''[Unit]
Description=Continuous scanned PDF OCR into scraper Parquet
Wants=network-online.target scraper-ocr-reminder.timer
After=network-online.target
[Service]
Type=exec
{common}ExecStartPre={preflight}
ExecStart={command}
ExecStopPost={command} --failure-hook
Restart=no
TimeoutStartSec=infinity
TimeoutStopSec=90
RuntimeMaxSec=infinity
KillSignal=SIGINT
KillMode=control-group
[Install]
WantedBy=multi-user.target
''',
        'scraper-ocr-reminder.service': f'''[Unit]
Description=Retained failed OCR PDF reminder check
[Service]
Type=oneshot
{common}ExecStart={command} --remind
TimeoutStartSec=infinity
''',
        'scraper-ocr-reminder.timer': '''[Unit]
Description=Check retained OCR failures independently of OCR queue
[Timer]
# One check an hour, matching the one-mail-an-hour gate in reminders(). The boot
# check fires once per boot so a restart does not wait an hour to be noticed.
# AccuracySec is relaxed because 10s precision on an hourly timer buys nothing and
# stops systemd coalescing the wakeup with other timers.
OnBootSec=2min
OnUnitInactiveSec=1h
AccuracySec=1min
Unit=scraper-ocr-reminder.service
[Install]
WantedBy=timers.target
''',
    }


def main():
    if os.geteuid() != 0 or not Path('/run/systemd/system').is_dir():
        sys.exit('Run as root on the systemd VPS.')
    uv = shutil.which('uv')
    if not uv or not shutil.which('ssh') or not shutil.which('tesseract'):
        sys.exit('Install uv, openssh-client and Tesseract with Myanmar language data first.')
    for name in ['scraper-ocr.service', 'scraper-ocr-reminder.service']:
        state = subprocess.run(['systemctl', 'show', name, '-p', 'ActiveState', '--value'],
                               capture_output=True, text=True).stdout.strip()
        if state in {'active', 'activating', 'deactivating'}:
            sys.exit(f'Stop {name} before installing.')
    units = render_units(uv)
    for name, content in units.items():
        target = Path('/etc/systemd/system') / name
        target.write_text(content)
        target.chmod(0o644)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'scraper-ocr-reminder.timer'], check=True)
    print('Installed. OCR has NOT started.\n'
          'Start: systemctl start scraper-ocr.service\n'
          'Logs: journalctl -u scraper-ocr.service -f\n'
          'Stop OCR: systemctl stop scraper-ocr.service\n'
          'Stop reminders too: systemctl disable --now scraper-ocr-reminder.timer')

if __name__ == '__main__':
    main()
