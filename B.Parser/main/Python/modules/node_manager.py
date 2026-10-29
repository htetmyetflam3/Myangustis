"""Python access to the JavaScript Manager, not a second production parser.

Separate JavaScript and Python parsers were planned and may be revisited later;
currently Python invokes the JavaScript Manager in a Node child process.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile


_ENTRY = Path(__file__).resolve().parents[3] / "extend" / "python-entry.js"


class ManagerError(RuntimeError):
    """A Node Manager request failed."""


def _request(job, *, caller="site", operation="dispatch"):
    timeout = int(os.environ.get("PRASER_PYTHON_TIMEOUT_SECONDS", "7200"))
    if timeout < 1:
        raise ValueError("PRASER_PYTHON_TIMEOUT_SECONDS must be positive")
    with tempfile.TemporaryDirectory(prefix="myangustis-manager-") as directory:
        response = Path(directory) / "response.json"
        request = {"job": job, "caller": caller, "operation": operation,
                   "responsePath": str(response)}
        try:
            proc = subprocess.run(
                [os.environ.get("NODE_BINARY", "node"), str(_ENTRY)],
                input=json.dumps(request), text=True, encoding="utf-8",
                stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ManagerError(f"Could not complete Node Manager request: {exc}") from exc
        if proc.returncode != 0:
            detail = proc.stderr.strip().splitlines()
            raise ManagerError(detail[-1] if detail else f"Node Manager exited {proc.returncode}")
        try:
            with response.open(encoding="utf-8") as stream:
                return json.load(stream)
        except (OSError, ValueError) as exc:
            raise ManagerError("Node Manager returned no valid response") from exc


def dispatch_path(in_path, out_path, *, kind=None, filename=None, method=None,
                  apply_cleanup=True, include_text=True, include_preview=False,
                  caller="site"):
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
        "includePreview": bool(include_preview),
    }, caller=caller)


def dispatch_bytes(data, filename, out_path, *, kind, method=None,
                   apply_cleanup=True, include_text=True, include_preview=False,
                   caller="site"):
    with tempfile.TemporaryDirectory(prefix="myangustis-input-") as directory:
        source = Path(directory) / ("input.docx" if kind == "docx" else "input.pdf")
        fd = os.open(source, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        return dispatch_path(source, out_path, kind=kind, filename=filename, method=method,
                             apply_cleanup=apply_cleanup, include_text=include_text,
                             include_preview=include_preview, caller=caller)


def render_text(in_path, out_path):
    return _request({"inPath": str(Path(in_path).resolve()),
                     "outPath": str(Path(out_path).resolve())}, operation="renderText")
