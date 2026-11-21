#!/usr/bin/env python3
"""Forward PDF-tool arguments to the single B.Parser entry point."""

from pathlib import Path
import sys

PARSER_ROOT = Path(__file__).resolve().parents[2]
if str(PARSER_ROOT) not in sys.path:
    sys.path.insert(0, str(PARSER_ROOT))

from main import main as parser_main  # noqa: E402


def _delegate_to_main():
    return parser_main(["parse", *sys.argv[1:]])


if __name__ == "__main__":
    raise SystemExit(_delegate_to_main())
