"""PDF pre-processing that needs qpdf: decryption and object-stream expansion.

Mirror of the JS parser's ``read/decrypt.mjs`` + ``core/qpdf.mjs`` (subprocess
instead of spawn). Two byte-level defects are fixed by rewriting the file
once with qpdf before the parser ever sees it:

* ``/Encrypt`` — restrictions-only encryption opens with the empty password;
  ``qpdf --decrypt`` rewrites it unlocked.
* ``/ObjStm`` — object streams (PDF 1.5+) hide whole indirect objects from
  ``parse_pdf_objects``; ``qpdf --object-streams=disable`` expands them (the
  scraper repo's pikepdf ``ObjectStreamMode.disable`` approach — pikepdf is
  libqpdf, the same library).

The qpdf executable is ``PRASER_QPDF_BIN`` or ``qpdf`` on PATH; a missing
executable raises a named error rather than failing somewhere downstream.
"""

import os
import subprocess
import tempfile
from pathlib import Path

_ENCRYPT_MARK = b"/Encrypt"
_OBJSTM_MARK = b"/ObjStm"


def _qpdf_bin():
    return os.environ.get("PRASER_QPDF_BIN") or "qpdf"


def _run_qpdf(data, args):
    """Run qpdf against private temporary files; return the rewritten bytes."""
    with tempfile.TemporaryDirectory(prefix="linga-qpdf-") as tmp:
        inp = Path(tmp) / "input.pdf"
        out = Path(tmp) / "output.pdf"
        inp.write_bytes(bytes(data))
        try:
            proc = subprocess.run(
                [_qpdf_bin(), *args, "--", str(inp), str(out)],
                capture_output=True, text=True)
        except FileNotFoundError as cause:
            raise RuntimeError(
                f'qpdf executable not found ({_qpdf_bin()!r}); '
                "install qpdf or set PRASER_QPDF_BIN") from cause
        # qpdf exit 3 means warnings with a valid output.
        if proc.returncode not in (0, 3):
            raise RuntimeError(
                f"qpdf exited with status {proc.returncode}"
                + (f": {proc.stderr.strip()}" if proc.stderr.strip() else ""))
        return out.read_bytes(), proc.stderr.strip()


def is_encrypted_pdf(data):
    return _ENCRYPT_MARK in bytes(data)


def decrypt_pdf(data, log=lambda m: None):
    if not is_encrypted_pdf(data):
        return data
    try:
        out, warnings = _run_qpdf(data, ["--password=", "--decrypt"])
    except RuntimeError as cause:
        msg = str(cause).lower()
        if "password" in msg:
            raise RuntimeError(
                "This PDF needs a password to open; supply an unprotected "
                "copy.") from cause
        raise
    if warnings:
        log(f"[i] qpdf decrypt warning: {warnings}")
    log(f"[+] PDF was encrypted; decrypted with qpdf "
        f"({len(data):,} -> {len(out):,} bytes)")
    return out


def has_object_streams(data):
    return _OBJSTM_MARK in bytes(data)


def expand_object_streams(data, log=lambda m: None):
    if not has_object_streams(data):
        return data
    out, warnings = _run_qpdf(data, ["--object-streams=disable"])
    if warnings:
        log(f"[i] qpdf object-stream warning: {warnings}")
    log(f"[+] PDF uses object streams; expanded with qpdf "
        f"({len(data):,} -> {len(out):,} bytes)")
    return out
