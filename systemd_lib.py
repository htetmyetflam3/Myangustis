"""Install one explicitly named systemd service without affecting other services."""
from __future__ import annotations
import os
from pathlib import Path
import re
import shutil
import subprocess


def quote(value):
    value = str(value).replace('%', '%%').replace('$', '$$')
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


def render_unit(name, command, working_dir):
    if not re.fullmatch(r'[A-Za-z0-9_.@-]+\.service', name):
        raise ValueError('Invalid service name')
    if not command:
        raise ValueError('Missing service command')
    directory = str(working_dir)
    if not Path(directory).is_absolute() or any(ch in directory for ch in ('\n', '\r', '\x00')):
        raise ValueError('Working directory must be a safe absolute path')
    directory = directory.replace('%', '%%')
    return f'''[Unit]
Description=Myangustis {name}
Wants=network-online.target
After=network-online.target

[Service]
Type=exec
WorkingDirectory={directory}
Environment=PYTHONUNBUFFERED=1
ExecStart={' '.join(quote(arg) for arg in command)}
StandardInput=null
StandardOutput=journal
StandardError=journal
KillSignal=SIGINT
TimeoutStopSec=120
Restart=no

[Install]
WantedBy=multi-user.target
'''


def install_and_start(name, command, working_dir):
    unit = render_unit(name, command, working_dir)
    if os.geteuid() != 0 or not Path('/run/systemd/system').is_dir():
        raise RuntimeError('A root systemd host is required to install a service.')
    systemctl = shutil.which('systemctl')
    if not systemctl:
        raise RuntimeError('systemctl is not available on PATH.')
    state = subprocess.run([systemctl, 'show', name, '--property=ActiveState', '--value'],
                           capture_output=True, text=True, check=True).stdout.strip()
    if state not in ('inactive', 'failed'):
        raise RuntimeError(f'{name} is {state}; stop it before replacing it.')
    target = Path('/etc/systemd/system') / name
    temp = target.with_name('.' + name + '.tmp')
    try:
        temp.write_text(unit, encoding='utf-8')
        temp.chmod(0o644)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)
    subprocess.run([systemctl, 'daemon-reload'], check=True)
    subprocess.run([systemctl, 'start', '--no-block', name], check=True)
    print(f'Start requested: {name}\nLogs: journalctl -u {name} -f\nStop: systemctl stop {name}')
