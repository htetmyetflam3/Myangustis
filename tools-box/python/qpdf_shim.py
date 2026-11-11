#!/usr/bin/env python3
"""qpdf CLI subset over pikepdf - the fallback when no qpdf binary is installed.

The Parser prepares a PDF by running the real qpdf with
    --decrypt --object-streams=disable --qdf -- INPUT OUTPUT
so a machine without qpdf could not open any PDF that is encrypted or stores
its objects in object streams. This shim answers the same call shape with
pikepdf (which bundles libqpdf), so those lanes keep working. It is a
development fallback only: if the real qpdf is on PATH it is always used.
"""
from __future__ import annotations

import sys

try:
    import pikepdf
except ImportError:  # pragma: no cover - reported to the caller
    sys.stderr.write("qpdf shim: pikepdf is not installed (pip install pikepdf)\n")
    sys.exit(2)

FLAGS_WITH_VALUE = {"--password", "-p"}
IGNORED_PREFIXES = ("--object-streams", "--stream-data", "--compression-level",
                    "--decode-level", "--encryption", "--replace-input",
                    "--empty", "--linearize", "--qdf", "--decrypt", "--",
                    "--normalize-content", "--remove-unreferenced-resources",
                    "--suppress-recovery", "--ignore-xref-streams", "--verbose")


def _split(argv: list[str]) -> tuple[dict[str, str], list[str]]:
    files: list[str] = []
    opts: dict[str, str] = {}
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--":
            i += 1
            continue
        if arg in FLAGS_WITH_VALUE:
            if i + 1 >= len(argv):
                raise SystemExit("qpdf shim: %s needs a value" % arg)
            opts[arg.lstrip("-")] = argv[i + 1]
            i += 2
            continue
        if arg.startswith("-"):
            key, _, value = arg.partition("=")
            opts[key.lstrip("-")] = value
            i += 1
            continue
        files.append(arg)
        i += 1
    return opts, files


def main(argv: list[str]) -> int:
    if not argv or "--version" in argv or "--help" in argv:
        sys.stdout.write("qpdf version 11.9.1 (pikepdf %s shim)\n" % pikepdf.__version__)
        return 0

    opts, files = _split(argv)
    if len(files) < 2:
        sys.stderr.write("qpdf shim: expected INPUT and OUTPUT\n")
        return 2
    source, target = files[-2], files[-1]
    encrypted = "--decrypt" in opts or "decrypt" in opts

    was_encrypted = False
    try:
        with pikepdf.open(source) as pdf:
            was_encrypted = bool(pdf.is_encrypted)
            pdf.save(
                target,
                qdf="qdf" in opts,
                object_stream_mode=(
                    pikepdf.ObjectStreamMode.disable
                    if opts.get("object-streams", "") == "disable"
                    else pikepdf.ObjectStreamMode.preserve
                ),
                compress_streams=not ("qdf" in opts),
                encryption=False,
                linearize="linearize" in opts,
            )
    except pikepdf.PasswordError:
        sys.stderr.write("qpdf shim: %s is password-protected\n" % source)
        return 2
    except Exception as error:  # report like qpdf does, on stderr
        sys.stderr.write("qpdf shim: %s\n" % error)
        return 2

    if encrypted and was_encrypted:
        sys.stderr.write("qpdf shim: decrypted with an empty password\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
