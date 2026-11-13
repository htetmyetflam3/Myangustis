#!/usr/bin/env python3
"""Compatibility entry: start the independent parser on its SSH queue."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from main import main

if __name__ == '__main__':
    raise SystemExit(main(['parse', '--ssh', *sys.argv[1:]]))
