"""The JSON job contract — the only integration surface between parsers.

The JavaScript parser and this Python parser are peers. A service that wants
either one writes a **job JSON**, and the parser writes a **result JSON**:

    request.json
    {
      "job": {
        "inPath":     "/abs/input.pdf",     # or "data": "<base64>" for bytes
        "outPath":    "/abs/output.docx",
        "filename":   "input.pdf",
        "inputKind":  "pdf",                # pdf | docx
        "method":     "manual",             # manual | default
        "output":     "docx",               # txt | docx | pdf
        "applyCleanup": true,
        "includeText":  true,
        "includePreview": false,
        "sourceEncoding": "auto",           # auto | unicode | zawgyi-one
        "textLayout": null                  # auto | off | zawcode
      },
      "caller": "site",
      "responsePath": "/abs/response.json"
    }

    response.json
    {
      "status": "ok",
      "file": "...", "pages": 12, "counts": {...}, "metadata": {...},
      "text": "...", "changes": [], "encodingPath": null,
      "parser": {"language": "python", "name": "myangustis-prser"}
    }

Field names deliberately match the JavaScript Manager's request/response so
one caller can drive either parser without a translation layer. No parser
imports the other: the exchange is files, and files are JSON.
"""

from __future__ import annotations

import base64
import json
import os
from pathlib import Path

from myangustis_parser.entry import manager

__all__ = ["JobError", "read_job", "run_job", "write_response", "run_job_file"]

PARSER_ID = {"language": "python", "name": "myangustis-prser"}


class JobError(ValueError):
    """The job JSON is not a job this parser can run."""


def read_job(source):
    """Read a job from a path, an open file, or an already-parsed dict."""
    if isinstance(source, dict):
        return source
    if hasattr(source, "read"):
        return json.load(source)
    with open(source, encoding="utf-8") as stream:
        return json.load(stream)


def _payload(request):
    """The inner job object, accepting a bare job as well as a wrapper."""
    if not isinstance(request, dict):
        raise JobError("job JSON must be an object")
    if "job" in request:
        job = request["job"]
        if not isinstance(job, dict):
            raise JobError("'job' must be an object")
        return job, request
    return request, request


def run_job(request, *, caller=None, log=None):
    """Run one job in this process and return the result object."""
    job, wrapper = _payload(request)
    caller = caller or wrapper.get("caller") or "site"

    out_path = job.get("outPath")
    if not out_path:
        raise JobError("job.outPath is required")

    common = dict(kind=job.get("inputKind"),
                  method=job.get("method"),
                  apply_cleanup=bool(job.get("applyCleanup", True)),
                  include_text=bool(job.get("includeText", True)),
                  include_preview=bool(job.get("includePreview", False)),
                  source_encoding=job.get("sourceEncoding") or "auto",
                  caller=caller,
                  text_layout=job.get("textLayout"),
                  log=log)

    try:
        if job.get("data"):
            try:
                data = base64.b64decode(job["data"], validate=True)
            except Exception as exc:  # noqa: BLE001 - any decode failure is the same
                raise JobError(f"job.data is not valid base64: {exc}") from exc
            result = manager.dispatch_bytes(
                data, job.get("filename") or "input.pdf", out_path, **common)
        else:
            in_path = job.get("inPath")
            if not in_path:
                raise JobError("job.inPath (or job.data) is required")
            result = manager.dispatch_path(
                in_path, out_path, filename=job.get("filename"), **common)
    except manager.ManagerError as exc:
        return {"status": "error", "error": str(exc), "parser": dict(PARSER_ID)}

    result["status"] = "ok"
    result["parser"] = dict(PARSER_ID)
    return result


def write_response(path, payload):
    """Atomically write a result JSON; create the parent directory."""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f".{target.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, target)
    return target


def run_job_file(job_path, response_path=None):
    """Read a job file, run it, and write the response where asked.

    ``responsePath`` inside the job is honoured when no explicit path is
    given, so a caller can hand over one file and collect one file.
    """
    request = read_job(job_path)
    _job, wrapper = _payload(request)
    result = run_job(request)
    target = response_path or wrapper.get("responsePath")
    if target:
        write_response(target, result)
    return result
