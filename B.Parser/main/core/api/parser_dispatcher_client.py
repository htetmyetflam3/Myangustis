"""
Python client for the Parser Dispatcher service.

Call the alive dispatcher service via HTTP instead of spawning Node.js as a
child subprocess. The dispatcher runs as a systemd service on port 8099.

IMPORTANT: The dispatcher does NOT read files. The caller reads the file on
their side and passes the resulting object. See streamReader() in JS or
read_file() below for the Python equivalent.

Usage:
    from parser_dispatcher_client import parse_local, parse_site, read_file

    # Local caller: read file on your side, pass object directly
    obj = read_file("document.pdf")  # or pass your own object
    result = parse_local(obj, "extracting")

    # Site caller: read file on your side, pass object + identity
    obj = read_file("/path/to/upload.pdf")
    result = parse_site(obj, "extracting", identity={"userId": "..."})
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request
import urllib.error
from typing import Any, Dict, Optional


DEFAULT_BASE_URL = "http://127.0.0.1:8099"


def read_file(path: str) -> Dict[str, Any]:
    """Read a file on the caller's side and return an object for BindParser.

    The dispatcher does NOT read files — callers must read and pass the object.
    Returns: { path, size, bytes_b64 } — bytes base64-encoded for JSON transport.
    """
    if not path or not isinstance(path, str):
        raise TypeError("read_file: file path is required")
    stat = os.stat(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"read_file: not a file: {path}")
    with open(path, "rb") as f:
        data = f.read()
    return {
        "path": path,
        "size": stat.st_size,
        "bytes_b64": base64.b64encode(data).decode("ascii"),
    }


class DispatcherClient:
    """HTTP client for the Parser Dispatcher service."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL) -> None:
        self.base_url = base_url.rstrip("/")

    def _request(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}/",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"Dispatcher HTTP {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Dispatcher unreachable at {self.base_url}: {exc}") from exc

    def parse_local(self, object: Any, method: str = "extracting",
                    identity: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Local caller: pass the object directly, no temp file, no read-back."""
        payload: Dict[str, Any] = {
            "caller": "local",
            "object": object,
            "method": method,
        }
        if identity:
            payload["identity"] = identity
        return self._request(payload)

    def parse_site(self, object: Any, method: str = "extracting",
                   identity: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Site caller: pass the object (file already read on your side).

        Use read_file() to read the file into an object before calling this.
        """
        payload: Dict[str, Any] = {
            "caller": "site",
            "object": object,
            "method": method,
        }
        if identity:
            payload["identity"] = identity
        return self._request(payload)


# Module-level convenience functions
_client = DispatcherClient()


def parse_local(object: Any, method: str = "extracting",
                identity: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Local caller: pass the object directly, no temp file, no read-back."""
    return _client.parse_local(object, method, identity)


def parse_site(object: Any, method: str = "extracting",
               identity: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Site caller: pass the object (file already read on your side).

    Use read_file() to read the file into an object before calling this.
    """
    return _client.parse_site(object, method, identity)
