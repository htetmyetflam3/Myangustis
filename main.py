#!/usr/bin/env python3
"""Run scraper and the independent SSH parser together; OCR is separate."""
from __future__ import annotations
import argparse
import os
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent


def run(scraper_args):
    env = dict(os.environ, SCRAPER_SYSTEMD_DIRECT='1', PYTHONUNBUFFERED='1')
    commands = [[sys.executable, '-u', str(ROOT / 'D.Scraper/run/main.py'), *scraper_args],
                [sys.executable, '-u', str(ROOT / 'B.Parser/main.py'), 'parse', '--ssh', '--foreground']]
    children = []
    try:
        for command, directory in zip(commands, (ROOT / 'D.Scraper/run', ROOT / 'B.Parser')):
            children.append(subprocess.Popen(command, cwd=directory, env=env))
        while True:
            scraper, parser = children
            try:
                status = parser.wait(timeout=1)
            except subprocess.TimeoutExpired:
                if scraper.poll() not in (None, 0):
                    return scraper.returncode
                continue
            return status if status else 1  # continuous parser must not exit early
    except KeyboardInterrupt:
        return 130
    finally:
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            try:
                child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    service = parser.add_mutually_exclusive_group()
    service.add_argument('--service', action='store_true', help='install and start the combined systemd service')
    service.add_argument('--foreground', action='store_true', help='run both workers in the current process')
    parser.add_argument('scraper_args', nargs=argparse.REMAINDER,
                        help='scraper arguments after -- (default: --process)')
    args = parser.parse_args(argv)
    scraper_args = args.scraper_args
    if scraper_args[:1] == ['--']:
        scraper_args = scraper_args[1:]
    scraper_args = scraper_args or ['--process']
    auto_service = not args.foreground and os.geteuid() == 0 and Path('/run/systemd/system').is_dir()
    if args.service or auto_service:
        from systemd_lib import install_and_start
        try:
            install_and_start('myangustis.service', [sys.executable, '-u', str(ROOT / 'main.py'), '--foreground', '--', *scraper_args], ROOT)
            return 0
        except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
            print(f'error: {error}', file=sys.stderr)
            return 1
    return run(scraper_args)


if __name__ == '__main__':
    raise SystemExit(main())
