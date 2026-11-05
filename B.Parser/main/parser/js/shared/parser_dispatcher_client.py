"""
Python client for the Parser Dispatcher service.

Call the alive dispatcher service via HTTP instead of spawning Node.js as a
child subprocess. The dispatcher runs as a systemd service on port 8099.

Usage:
    from parser_dispatcher_client import parse_local, parse_site

    # Local caller: pass an object directly (no temp file, no read-back)
    result = parse_local({"source": my_text_or_stream_object}, "extracting")

    # Site caller: pass the file path on disk
    result = parse_site("/path/to/upload.pdf", "extracting", identity={"userId": "..."})
"""

from __future__ import annotations

import json
import urllib.request
import urllib.error
from typing import Any, Dict, Optional


DEFAULT_BASE_URL = "http://127.0.0.1:8099"


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

    def parse_site(self, file_path: str, method: str = "extracting",
                   identity: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Site caller: file already on disk at file_path."""
        payload: Dict[str, Any] = {
            "caller": "site",
            "filePath": file_path,
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


def parse_site(file_path: str, method: str = "extracting",
               identity: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Site caller: file already on disk at file_path."""
    return _client.parse_site(file_path, method, identity)
