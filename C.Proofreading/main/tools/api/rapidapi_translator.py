#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Dependency-free client for the RapidAPI "Multi format AI translator" API.

Host: `multi-format-ai-translator-the-most-complete.p.rapidapi.com`

Three documented endpoints, and the exact wire format each one uses (they are
not consistent with each other, which is why this file exists):

    POST /detect           Content-Type: text/plain   body = the raw text
    POST /translate        Content-Type: text/plain   body = the raw text
    POST /translate/batch  Content-Type: application/json  body = ["text", ...]

All three take `?source=` (default `auto`) and `?target=` as query parameters
and answer with `{"status": true, "data": {...}}`; `/translate/batch` returns
`data.translated_texts` in input order.

Design rules, borrowed from `mt/translate.py`:

- The key is read from `RAPIDAPI_KEY` and is never written to disk or printed.
  A key is redacted from any error text before an exception is raised.
- Nothing is loaded implicitly. `load_env_file()` is called only when `--env-file`
  (or `RAPIDAPI_ENV_FILE`) names a file, and it never prints or returns values.
  The shell environment always wins over the file.
- Redirects are not followed, so the key cannot be forwarded to another host.
- Only 408/425/429/5xx and network errors are retried. A retried request may
  already have been counted by RapidAPI; the caller sees `stats["retries"]`.
- A cached success is never re-requested. The cache key includes the host,
  source language, target language and the exact text, never the key.

Only the Python standard library is used, so the MCP server next to this file
runs under any `python3` without installing anything.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HOST = "multi-format-ai-translator-the-most-complete.p.rapidapi.com"
BASE_URL = "https://" + HOST

KEY_ENV = "RAPIDAPI_KEY"
BASE_URL_ENV = "RAPIDAPI_BASE_URL"  # tests / gateways only
HOST_ENV = "RAPIDAPI_HOST"
CACHE_ENV = "RAPIDAPI_CACHE"
ENV_FILE_ENV = "RAPIDAPI_ENV_FILE"

DEFAULT_CACHE = ROOT / "content" / "mtranslate" / "rapidapi-cache.sqlite3"

# The provider documents a 5,000-character ceiling per request. Keep a margin so
# a multi-byte paragraph does not push a batch over the limit.
MAX_REQUEST_CHARS = 4500
MAX_REQUEST_ITEMS = 40

# The novel is translated one pair of chapters per call, reviewed before the
# next pair is spent. Every entry point enforces this; see mt/apicaller.py.
MAX_CHAPTERS_PER_CALL = 2

RETRY_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})
USER_AGENT = "proofreading-rapidapi/1.0"


class TranslatorError(Exception):
    """An actionable API failure. Never contains the API key."""

    def __init__(self, message: str, *, status: int | None = None,
                 retry_after: float | None = None, attempts: int = 0) -> None:
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after
        self.attempts = attempts


@dataclass
class BatchResult:
    texts: list[str]
    source_language: str = ""
    source_language_name: str = ""
    requests: int = 0
    cached: int = 0
    cache_hits: list[bool] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "texts": self.texts,
            "source_language": self.source_language,
            "source_language_name": self.source_language_name,
            "requests": self.requests,
            "cached": self.cached,
        }


# ---------------------------------------------------------------- .env

_VALID_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def parse_env_file(path: Path | str) -> dict[str, str]:
    """KEY=VALUE lines from a dotenv file. Comments, blanks and `export ` allowed.

    Supports single or double quotes around the value. No substitution is
    performed, so `$` and `{` stay literal; a line without `=` or with an
    invalid name is skipped rather than raising.
    """
    values: dict[str, str] = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        name, sep, value = line.partition("=")
        if not sep:
            continue
        name = name.strip()
        if not _VALID_KEY.match(name):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        elif " #" in value:
            value = value.split(" #", 1)[0].rstrip()
        values[name] = value
    return values


def load_env_file(path: Path | str | None = None, *,
                  override: bool = False) -> list[str]:
    """Load a dotenv file into os.environ and return the names that were set.

    A variable already present with a non-empty value is kept unless `override`
    is true, so `export RAPIDAPI_KEY=...` in the shell beats the file. Values
    are never printed; a missing file raises, because a silent no-op would hide
    a typo in the path.
    """
    target = path or os.environ.get(ENV_FILE_ENV)
    if not target:
        return []
    file = Path(target).expanduser()
    if not file.is_file():
        raise TranslatorError(f"no env file at {file}")
    loaded: list[str] = []
    for name, value in parse_env_file(file).items():
        if override or not os.environ.get(name):
            os.environ[name] = value
            loaded.append(name)
    return loaded


# ---------------------------------------------------------------- helpers


def _redact(text: str, key: str) -> str:
    if key:
        text = text.replace(key, "<redacted>")
    return text


def _retry_after(headers) -> float | None:
    raw = (headers or {}).get("Retry-After") if headers else None
    if not raw:
        return None
    try:
        return max(0.0, float(str(raw).strip()))
    except ValueError:
        return None


def _error_text(payload: dict) -> str:
    for name in ("error", "message", "detail", "detail_message"):
        value = payload.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return json.dumps(payload, ensure_ascii=False)[:300]


def _single_line(text: str, limit: int = 300) -> str:
    return re.sub(r"\s+", " ", text.strip())[:limit]


_PIECE = re.compile(r"[^。！？!?…；;]*[。！？!?…；;]?\s*")


def split_text(text: str, limit: int) -> list[str]:
    """Split on sentence punctuation; the pieces concatenate back exactly."""
    if limit < 1:
        raise ValueError("limit must be positive")
    if len(text) <= limit:
        return [text]
    pieces: list[str] = []
    buffer = ""
    for match in _PIECE.finditer(text):
        piece = match.group(0)
        if not piece:
            continue
        if not buffer and len(piece) > limit:
            pieces.extend(piece[start:start + limit]
                          for start in range(0, len(piece), limit))
            continue
        if len(buffer) + len(piece) > limit:
            pieces.append(buffer)
            buffer = piece
        else:
            buffer += piece
    if buffer:
        pieces.append(buffer)
    return [piece for piece in pieces if piece]


def chunk_texts(texts, max_chars: int = MAX_REQUEST_CHARS,
                max_items: int = MAX_REQUEST_ITEMS):
    """Group strings into request-sized chunks, preserving order.

    A single string longer than `max_chars` is yielded alone; callers should
    split it first with `split_text`.
    """
    if max_chars < 1 or max_items < 1:
        raise ValueError("chunk limits must be positive")
    chunk: list[str] = []
    size = 0
    for text in texts:
        if chunk and (len(chunk) >= max_items or size + len(text) > max_chars):
            yield chunk
            chunk, size = [], 0
        chunk.append(text)
        size += len(text)
    if chunk:
        yield chunk


def parse_chapters(spec: str | list[str] | None) -> list[int]:
    """`"1-2"`, `"1,2"` or `["1", "3-4"]` -> `[1, 2]` / `[1, 3, 4]`."""
    if spec is None:
        return []
    if isinstance(spec, str):
        spec = [spec]
    numbers: list[int] = []
    for piece in spec:
        for token in str(piece).replace(" ", "").split(","):
            if not token:
                continue
            if "-" in token:
                start, _, end = token.partition("-")
                low, high = int(start), int(end)
                if high < low:
                    raise ValueError(f"chapter range {token!r} is reversed")
                numbers.extend(range(low, high + 1))
            else:
                numbers.append(int(token))
    return list(dict.fromkeys(numbers))


# ---------------------------------------------------------------- cache


class TranslationCache:
    """SQLite cache keyed by host + language pair + exact text."""

    def __init__(self, path: Path | str | None = None, *, enabled: bool = True) -> None:
        self.path = Path(path or os.environ.get(CACHE_ENV) or DEFAULT_CACHE)
        self.enabled = enabled
        self.db: sqlite3.Connection | None = None
        if not enabled:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path)
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS rapidapi_translations (
                cache_key TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                target TEXT NOT NULL,
                source_text TEXT NOT NULL,
                translated_text TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )"""
        )
        self.db.commit()

    @staticmethod
    def make_key(host: str, source: str, target: str, text: str) -> str:
        raw = "\x1f".join((host, source, target, text))
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def get(self, host: str, source: str, target: str, text: str) -> str | None:
        if self.db is None:
            return None
        row = self.db.execute(
            "SELECT translated_text FROM rapidapi_translations WHERE cache_key = ?",
            (self.make_key(host, source, target, text),),
        ).fetchone()
        return row[0] if row else None

    def put(self, host: str, source: str, target: str, text: str, translated: str) -> None:
        if self.db is None:
            return
        self.db.execute(
            "INSERT OR REPLACE INTO rapidapi_translations"
            " (cache_key, source, target, source_text, translated_text)"
            " VALUES (?, ?, ?, ?, ?)",
            (self.make_key(host, source, target, text), source, target, text, translated),
        )

    def commit(self) -> None:
        if self.db is not None:
            self.db.commit()

    def close(self) -> None:
        if self.db is not None:
            self.db.close()
            self.db = None

    def __enter__(self) -> "TranslationCache":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# ---------------------------------------------------------------- client


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        raise TranslatorError(
            f"HTTP {code}: the API answered with a redirect ({newurl.split('?')[0]}); "
            "not following it with the key attached",
            status=code,
        )


class RapidApiClient:
    """One request path per documented endpoint, with retries and validation."""

    def __init__(self, key: str | None = None, *, base_url: str | None = None,
                 host: str | None = None, timeout: float = 60.0,
                 max_attempts: int = 3, backoff: float = 1.0,
                 max_chars: int = MAX_REQUEST_CHARS,
                 max_items: int = MAX_REQUEST_ITEMS) -> None:
        self.key = (key or os.environ.get(KEY_ENV) or "").strip()
        if not self.key:
            raise TranslatorError(
                f"{KEY_ENV} is not set; export it in your shell (never commit it)"
            )
        self.base_url = (base_url or os.environ.get(BASE_URL_ENV) or BASE_URL).rstrip("/")
        scheme = urllib.parse.urlsplit(self.base_url).scheme
        if scheme not in ("http", "https"):
            raise TranslatorError(f"{BASE_URL_ENV} must be an http(s) base URL")
        self.host = (host or os.environ.get(HOST_ENV) or HOST).strip()
        if not self.host:
            raise TranslatorError(f"{HOST_ENV} is empty")
        self.timeout = timeout
        self.max_attempts = max(1, int(max_attempts))
        self.backoff = max(0.0, float(backoff))
        self.max_chars = max(1, int(max_chars))
        self.max_items = max(1, int(max_items))
        self._opener = urllib.request.build_opener(_NoRedirect())
        self.stats = {"requests": 0, "ok": 0, "retries": 0, "failures": 0, "chars": 0}

    # -- transport ---------------------------------------------------

    def _post(self, path: str, *, params: dict | None = None, body: bytes = b"",
              content_type: str = "application/json") -> dict:
        url = self.base_url + path
        if params:
            url += "?" + urllib.parse.urlencode(params)
        last: TranslatorError | None = None
        for attempt in range(1, self.max_attempts + 1):
            request = urllib.request.Request(url, data=body, method="POST", headers={
                "X-RapidAPI-Key": self.key,
                "X-RapidAPI-Host": self.host,
                "Content-Type": content_type,
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            })
            self.stats["requests"] += 1
            self.stats["chars"] += len(body)
            try:
                with self._opener.open(request, timeout=self.timeout) as response:
                    raw = response.read()
                    status = response.status
            except urllib.error.HTTPError as error:
                status = error.code
                retry_after = _retry_after(error.headers)
                detail = ""
                try:
                    detail = error.read().decode("utf-8", "replace")
                except Exception:  # pragma: no cover - defensive
                    pass
                message = self._http_message(path, status, detail, attempt)
                if status in RETRY_STATUS and attempt < self.max_attempts:
                    self.stats["retries"] += 1
                    delay = retry_after if retry_after is not None else self.backoff * 2 ** (attempt - 1)
                    time.sleep(min(delay, 60.0))
                    last = TranslatorError(message, status=status,
                                           retry_after=retry_after, attempts=attempt)
                    continue
                self.stats["failures"] += 1
                raise TranslatorError(message, status=status,
                                      retry_after=retry_after, attempts=attempt) from None
            except (urllib.error.URLError, TimeoutError, OSError) as error:
                reason = getattr(error, "reason", error)
                message = _single_line(
                    _redact(f"network error talking to {self.host}: {reason}", self.key)
                )
                if attempt < self.max_attempts:
                    self.stats["retries"] += 1
                    time.sleep(min(self.backoff * 2 ** (attempt - 1), 30.0))
                    last = TranslatorError(message, attempts=attempt)
                    continue
                self.stats["failures"] += 1
                raise TranslatorError(message, attempts=attempt) from None
            self.stats["ok"] += 1
            return self._decode(raw, status, path)
        raise last or TranslatorError("request failed")

    def _http_message(self, path: str, status: int, detail: str, attempt: int) -> str:
        hint = ""
        if status in (401, 403):
            hint = " — the key was rejected; check the key and that your RapidAPI account is subscribed to this API"
        elif status == 404:
            hint = " — check the endpoint path"
        elif status == 429:
            hint = " — plan quota or rate limit reached"
        detail = _single_line(_redact(detail, self.key), 240)
        suffix = f": {detail}" if detail else ""
        return f"HTTP {status} on {path} (attempt {attempt}/{self.max_attempts}){hint}{suffix}"

    def _decode(self, raw: bytes, status: int, path: str) -> dict:
        text = raw.decode("utf-8", "replace")
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            snippet = _redact(_single_line(text, 200), self.key)
            raise TranslatorError(
                f"HTTP {status} on {path}: response was not JSON ({snippet!r})",
                status=status,
            ) from None
        if not isinstance(payload, dict):
            raise TranslatorError(
                f"HTTP {status} on {path}: unexpected response type "
                f"{type(payload).__name__}", status=status)
        if payload.get("status") is False:
            raise TranslatorError(
                f"API reported failure on {path}: "
                f"{_single_line(_redact(_error_text(payload), self.key))}",
                status=status,
            )
        return payload

    def _data(self, path: str, *, params: dict, body: bytes,
              content_type: str) -> dict:
        payload = self._post(path, params=params, body=body, content_type=content_type)
        data = payload.get("data")
        if not isinstance(data, dict):
            raise TranslatorError(f"API response for {path} has no data object")
        return data

    # -- endpoints ---------------------------------------------------

    def detect(self, text: str) -> dict:
        data = self._data("/detect", params={},
                          body=text.encode("utf-8"),
                          content_type="text/plain; charset=utf-8")
        return {
            "language": data.get("language", ""),
            "language_name": data.get("language_name") or "",
        }

    def translate(self, text: str, target: str, source: str = "auto") -> dict:
        data = self._data("/translate",
                          params={"source": source, "target": target},
                          body=text.encode("utf-8"),
                          content_type="text/plain; charset=utf-8")
        translated = data.get("translated_text")
        if not isinstance(translated, str):
            raise TranslatorError("API response for /translate has no translated_text")
        return {
            "translated_text": translated,
            "source_language": data.get("source_language", ""),
            "source_language_name": data.get("source_language_name") or "",
        }

    def translate_batch(self, texts, target: str, source: str = "auto") -> BatchResult:
        texts = list(texts)
        before = self.stats["requests"]
        unique = list(dict.fromkeys(texts))
        pieces: dict[str, list[str]] = {}
        pending: list[str] = []
        for text in unique:
            if not text.strip():
                continue
            if len(text) > self.max_chars:
                pieces[text] = split_text(text, self.max_chars)
                pending.extend(pieces[text])
            else:
                pending.append(text)
        translated: dict[str, str] = {}
        language = name = ""
        for chunk in chunk_texts(dict.fromkeys(pending), self.max_chars, self.max_items):
            data = self._data(
                "/translate/batch",
                params={"source": source, "target": target},
                body=json.dumps(chunk, ensure_ascii=False).encode("utf-8"),
                content_type="application/json",
            )
            values = data.get("translated_texts")
            if not isinstance(values, list) or len(values) != len(chunk):
                raise TranslatorError(
                    "API returned "
                    f"{len(values) if isinstance(values, list) else 'no'} translations "
                    f"for {len(chunk)} inputs"
                )
            translated.update(zip(chunk, (str(value) for value in values)))
            language = data.get("source_language") or language
            name = data.get("source_language_name") or name
        out: list[str] = []
        for text in texts:
            if text in pieces:
                out.append("".join(translated.get(piece, "") for piece in pieces[text]))
            else:
                out.append(translated.get(text, ""))
        return BatchResult(out, language, name,
                           requests=self.stats["requests"] - before)


class CachedTranslator:
    """Cache-first wrapper: only strings that are not already cached are sent."""

    def __init__(self, client: RapidApiClient | None = None, *,
                 cache_path: Path | str | None = None, enabled: bool = True,
                 **client_kwargs) -> None:
        self.client = client or RapidApiClient(**client_kwargs)
        self.cache = TranslationCache(cache_path, enabled=enabled)

    @property
    def host(self) -> str:
        return self.client.host

    def detect(self, text: str) -> dict:
        return self.client.detect(text)

    def translate(self, text: str, target: str, source: str = "auto") -> str:
        cached = self.cache.get(self.host, source, target, text)
        if cached is not None:
            return cached
        value = self.client.translate(text, target, source)["translated_text"]
        self.cache.put(self.host, source, target, text, value)
        self.cache.commit()
        return value

    def translate_batch(self, texts, target: str, source: str = "auto") -> BatchResult:
        texts = list(texts)
        before = self.client.stats["requests"]
        pieces: dict[str, list[str]] = {}
        misses: list[str] = []
        hits: dict[str, str] = {}
        for text in dict.fromkeys(texts):
            if not text.strip():
                continue
            if len(text) > self.client.max_chars:
                pieces[text] = split_text(text, self.client.max_chars)
                wanted = pieces[text]
            else:
                wanted = [text]
            for piece in wanted:
                cached = self.cache.get(self.host, source, target, piece)
                if cached is None:
                    misses.append(piece)
                else:
                    hits[piece] = cached
        misses = list(dict.fromkeys(misses))
        fresh: BatchResult | None = None
        if misses:
            fresh = self.client.translate_batch(misses, target, source)
            for piece, value in zip(misses, fresh.texts):
                self.cache.put(self.host, source, target, piece, value)
            self.cache.commit()
        values = dict(hits)
        if fresh is not None:
            values.update(zip(misses, fresh.texts))
        out: list[str] = []
        flags: list[bool] = []
        for text in texts:
            parts = pieces.get(text, [text])
            out.append("".join(values.get(piece, "") for piece in parts))
            flags.append(all(piece in hits for piece in parts))
        return BatchResult(
            out,
            (fresh.source_language if fresh else ""),
            (fresh.source_language_name if fresh else ""),
            requests=self.client.stats["requests"] - before,
            cached=sum(1 for flag in flags if flag),
            cache_hits=flags,
        )

    def close(self) -> None:
        self.cache.close()

    def __enter__(self) -> "CachedTranslator":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


# ---------------------------------------------------------------- CLI


def _read_batch_file(path: Path) -> list[str]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [line for line in lines if line.strip()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Call the RapidAPI multi-format translator (key from RAPIDAPI_KEY).")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--detect", metavar="TEXT", help="detect the language of TEXT")
    group.add_argument("--translate", metavar="TEXT", help="translate TEXT")
    group.add_argument("--batch-file", type=Path, metavar="PATH",
                       help="translate one string per line")
    group.add_argument("--check", action="store_true",
                       help="show configuration without making a request")
    parser.add_argument("--target", default="my", help="target language code (default: my)")
    parser.add_argument("--source", default="auto",
                        help="source language code or auto (default: auto)")
    parser.add_argument("--plan", action="store_true",
                        help="print request counts and exit without a network call")
    parser.add_argument("--json", action="store_true", help="print raw JSON")
    parser.add_argument("--no-cache", action="store_true", help="ignore the SQLite cache")
    parser.add_argument("--cache", type=Path, default=None, help="cache path")
    parser.add_argument("--max-chars", type=int, default=MAX_REQUEST_CHARS)
    parser.add_argument("--max-items", type=int, default=MAX_REQUEST_ITEMS)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--env-file", type=Path, default=None, metavar="PATH",
                        help="read KEY=VALUE lines from PATH before running "
                             f"(also {ENV_FILE_ENV}); the shell environment wins")
    args = parser.parse_args(argv)

    try:
        loaded = load_env_file(args.env_file)
    except TranslatorError as error:
        print(f"[rapidapi] {error}", file=sys.stderr)
        return 2
    if loaded:
        print(f"[rapidapi] loaded {', '.join(loaded)} from "
              f"{args.env_file or os.environ.get(ENV_FILE_ENV)}", file=sys.stderr)

    if args.check:
        print(json.dumps({
            "host": os.environ.get(HOST_ENV, HOST),
            "base_url": os.environ.get(BASE_URL_ENV, BASE_URL),
            "key": "set" if os.environ.get(KEY_ENV) else "missing",
            "cache": str(args.cache or os.environ.get(CACHE_ENV) or DEFAULT_CACHE),
            "env_file": str(args.env_file or os.environ.get(ENV_FILE_ENV) or ""),
        }, indent=2))
        return 0

    texts: list[str] = []
    if args.batch_file:
        texts = _read_batch_file(args.batch_file)
    elif args.translate:
        texts = [args.translate]

    if args.plan:
        plan = {
            "items": len(texts),
            "characters": sum(len(text) for text in texts),
            "requests": sum(1 for _ in chunk_texts(
                [piece for text in dict.fromkeys(texts)
                 for piece in split_text(text, args.max_chars)],
                args.max_chars, args.max_items)),
            "endpoint": "/translate/batch" if texts else "/detect",
        }
        print(json.dumps(plan, indent=2))
        return 0

    try:
        with CachedTranslator(cache_path=args.cache, enabled=not args.no_cache,
                              timeout=args.timeout, max_attempts=args.attempts,
                              max_chars=args.max_chars, max_items=args.max_items) as translator:
            if args.detect:
                result = translator.detect(args.detect)
                if args.json:
                    print(json.dumps(result, ensure_ascii=False, indent=2))
                else:
                    print(f"{result['language']}\t{result['language_name']}")
                return 0
            if args.batch_file:
                result = translator.translate_batch(texts, args.target, args.source)
                payload = {"translations": result.texts,
                           "source_language": result.source_language,
                           "source_language_name": result.source_language_name,
                           "requests": result.requests,
                           "cached": result.cached}
                if args.json:
                    print(json.dumps(payload, ensure_ascii=False, indent=2))
                else:
                    for text, value in zip(texts, result.texts):
                        print(f"{text}\t{value}")
                return 0
            result = translator.translate(texts[0], args.target, args.source)
            if args.json:
                print(json.dumps(result, ensure_ascii=False, indent=2))
            else:
                print(result["translated_text"])
            return 0
    except TranslatorError as error:
        print(f"[rapidapi] {error}", file=sys.stderr)
        return 3


if __name__ == "__main__":
    sys.exit(main())
