#!/usr/bin/env python3
"""Legacy PDF tool entry point; conversion runs this parser's own Manager.

This compatibility entry point delegates to the shared Parser pipeline.
It contains no separate extraction or repair implementation.
"""


def _delegate_to_manager():
    import argparse
    import os
    import sys

    parser = argparse.ArgumentParser(description="Convert a PDF with the Python parser")
    parser.add_argument("pdf", help="Input PDF file path")
    parser.add_argument("out", nargs="?", default="", help="Output file or directory")
    parser.add_argument("--admin", action="store_true", help="Prompt once for cleanup")
    parser.add_argument("--auto-approve", action="store_true", help="Apply cleanup")
    parser.add_argument("--source-encoding", choices=["auto", "unicode", "zawgyi-one"], default="auto")
    args = parser.parse_args()
    from myangustis_parser.entry.cli import main as manager_main
    cleanup = "yes" if args.auto_approve else "ask" if args.admin else "no"
    argv = [args.pdf]
    if args.out:
        argv.append(args.out)
    return manager_main([*argv, "--cleanup", cleanup, "--source-encoding", args.source_encoding])


if __name__ == "__main__":
    raise SystemExit(_delegate_to_manager())
