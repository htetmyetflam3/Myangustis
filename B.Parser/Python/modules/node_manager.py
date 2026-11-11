"""Python access to the JavaScript Manager, not a second production parser.

Normal API calls keep the public limits. Local callers can provide an opened
binary stream to dispatch_stream; Python and Node pull it in chunks.
"""

from __future__ import annotations

import codecs
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


_ENTRY = Path(__file__).resolve().parents[3] / "extend" / "python-entry.js"


class ManagerError(RuntimeError):
    """A Node Manager request failed."""


def mute_advisories():
    """Start the shared 24-hour advisory mute, including for later processes."""
    command = [os.environ.get("NODE_BINARY", "node"), str(_ENTRY), "--quiet", "--mute-only"]
    try:
        proc = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                              text=True, encoding="utf-8", timeout=30, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ManagerError(f"Could not mute Node advisories: {exc}") from exc
    if proc.returncode:
        raise ManagerError(proc.stderr.strip() or "Could not mute Node advisories")
    return proc.stderr.strip()


def _read_response(response):
    try:
        with response.open(encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError) as exc:
        raise ManagerError("Node Manager returned no valid response") from exc


def _request(job, *, caller="site", operation="dispatch"):
    timeout = int(os.environ.get("PRASER_PYTHON_TIMEOUT_SECONDS", "7200"))
    if timeout < 1:
        raise ValueError("PRASER_PYTHON_TIMEOUT_SECONDS must be positive")
    with tempfile.TemporaryDirectory(prefix="myangustis-manager-") as directory:
        response = Path(directory) / "response.json"
        request = {"job": job, "caller": caller, "operation": operation,
                   "responsePath": str(response)}
        command = [os.environ.get("NODE_BINARY", "node"), str(_ENTRY)]
        # Keep a terminal attached for first-use guidance. In noninteractive
        # calls forward captured warnings too, especially raster-match warnings.
        interactive = sys.stderr.isatty()
        try:
            proc = subprocess.run(
                command, input=json.dumps(request), text=True, encoding="utf-8",
                stdout=subprocess.DEVNULL, stderr=None if interactive else subprocess.PIPE,
                timeout=timeout, check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ManagerError(f"Could not complete Node Manager request: {exc}") from exc
        if proc.stderr:
            sys.stderr.write(proc.stderr)
        if proc.returncode != 0:
            detail = (proc.stderr or "").strip().splitlines()
            raise ManagerError(detail[-1] if detail else f"Node Manager exited {proc.returncode}")
        return _read_response(response)


def dispatch_path(in_path, out_path, *, kind=None, filename=None, method=None,
                  apply_cleanup=True, include_text=True, include_preview=False,
                  source_encoding="auto", caller="site"):
    source = Path(in_path).resolve()
    name = os.path.basename(filename or source.name)
    if kind is None:
        kind = "docx" if name.lower().endswith((".docx", ".doc")) else "pdf"
    if method is None:
        method = "manual" if kind == "pdf" else "default"
    return _request({
        "job": "extracting", "method": method,
        "output": Path(out_path).suffix.lower().lstrip("."),
        "inPath": str(source), "outPath": str(Path(out_path).resolve()),
        "filename": name, "inputKind": kind,
        "applyCleanup": bool(apply_cleanup), "includeText": bool(include_text),
        "includePreview": bool(include_preview), "sourceEncoding": source_encoding,
    }, caller=caller)


def dispatch_bytes(data, filename, out_path, *, kind, method=None,
                   apply_cleanup=True, include_text=True, include_preview=False,
                   source_encoding="auto", caller="site"):
    with tempfile.TemporaryDirectory(prefix="myangustis-input-") as directory:
        source = Path(directory) / ("input.docx" if kind == "docx" else "input.pdf")
        fd = os.open(source, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        return dispatch_path(source, out_path, kind=kind, filename=filename, method=method,
                             apply_cleanup=apply_cleanup, include_text=include_text,
                             include_preview=include_preview,
                             source_encoding=source_encoding, caller=caller)


def dispatch_stream(source, out_path, *, filename, kind=None, method=None,
                    apply_cleanup=True, include_text=False, include_preview=False,
                    source_encoding="auto"):
    # Prefer an opened binary stream: the caller owns the source path and this
    # local entry pulls bytes rather than reading the whole source into memory.
    if not callable(getattr(source, "read", None)):
        raise TypeError("source must be an opened binary stream")
    name = os.path.basename(filename)
    if kind is None:
        if name.lower().endswith(".pdf"):
            kind = "pdf"
        elif name.lower().endswith(".docx"):
            kind = "docx"
        else:
            raise ValueError("local stream input must be a PDF or DOCX")
    if kind not in ("pdf", "docx"):
        raise ValueError("local stream input must be a PDF or DOCX")
    if method is None:
        method = "manual" if kind == "pdf" else "default"
    job = {
        "job": "extracting", "method": method,
        "output": Path(out_path).suffix.lower().lstrip("."),
        "outPath": str(Path(out_path).resolve()), "filename": name, "inputKind": kind,
        "applyCleanup": bool(apply_cleanup), "includeText": bool(include_text),
        "includePreview": bool(include_preview), "sourceEncoding": source_encoding,
    }
    with tempfile.TemporaryDirectory(prefix="myangustis-manager-") as directory:
        response = Path(directory) / "response.json"
        request = Path(directory) / "request.json"
        fd = os.open(request, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump({"job": job, "responsePath": str(response)}, stream)
        command = [os.environ.get("NODE_BINARY", "node"), str(_ENTRY), "--local-stream", str(request)]
        interactive = sys.stderr.isatty()
        with tempfile.TemporaryFile() as errors:
            try:
                proc = subprocess.Popen(command, stdin=subprocess.PIPE,
                                        stdout=subprocess.DEVNULL, stderr=None if interactive else errors)
            except OSError as exc:
                raise ManagerError(f"Could not start Node Manager: {exc}") from exc
            try:
                while True:
                    chunk = source.read(64 * 1024)
                    if not isinstance(chunk, (bytes, bytearray, memoryview)):
                        raise TypeError("source must yield bytes")
                    if not chunk:
                        break
                    proc.stdin.write(chunk)
                proc.stdin.close()
                status = proc.wait()
            except BrokenPipeError:
                try:
                    proc.stdin.close()
                except BrokenPipeError:
                    pass
                status = proc.wait()
            except BaseException:
                try:
                    proc.stdin.close()
                except OSError:
                    pass
                if proc.poll() is None:
                    proc.kill()
                proc.wait()
                raise
            detail = []
            if not interactive:
                errors.seek(0, os.SEEK_END)
                end = errors.tell()
                errors.seek(max(0, end - 8192))
                detail = errors.read().decode("utf-8", errors="replace").strip().splitlines()
                errors.seek(0)
                decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
                while chunk := errors.read(64 * 1024):
                    sys.stderr.write(decoder.decode(chunk))
                sys.stderr.write(decoder.decode(b"", final=True))
            if status != 0:
                raise ManagerError(detail[-1] if detail else f"Node Manager exited {status}")
        return _read_response(response)


def render_text(in_path, out_path):
    return _request({"inPath": str(Path(in_path).resolve()),
                     "outPath": str(Path(out_path).resolve())}, operation="renderText")
