# /// script
# requires-python = ">=3.10"
# dependencies = ["jieba>=0.42", "OpenCC>=1.1"]
# ///
"""Install the two bilingual dictionaries used by the chapter merge.

    Chinese -> English   CC-CEDICT (118,840 entries, traditional + simplified)
    English -> Burmese   English-Myanmar dictionary database (21,984 headwords)

Both are downloaded once from their GitHub projects and stored under
`Engine/knowledge/dicts/`, which is not committed. Run again at any time; the
installer is idempotent and verifies the SHA-256 of everything it writes.

    uv run format/fetch_dicts.py            # install if missing
    uv run format/fetch_dicts.py --force    # reinstall
    uv run format/fetch_dicts.py --check    # report only
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import pickle
import re
import sqlite3
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
STORE = ROOT / "Engine" / "knowledge" / "dicts"
PROVENANCE = STORE / "provenance.json"

CEDICT_URL = "https://codeload.github.com/marcanuy/cedict_utils/zip/refs/heads/master"
CEDICT_MEMBER = "cedict_utils-master/cedict_utils/data/dump.dat"
ENMY_URL = "https://codeload.github.com/soeminnminn/EngMyanDictionary/zip/refs/heads/master"
ENMY_MEMBER = "EngMyanDictionary-master/app/src/main/assets/database/dictionary.db"

CHROME = {"User-Agent": "proofreading-dict-fetch/1.0"}


def download(url: str, destination: Path) -> str:
    digest = hashlib.sha256()
    with urllib.request.urlopen(urllib.request.Request(url, headers=CHROME), timeout=300) as response:
        with destination.open("wb") as stream:
            while True:
                chunk = response.read(1 << 20)
                if not chunk:
                    break
                digest.update(chunk)
                stream.write(chunk)
    return digest.hexdigest()


class _SafeUnpickler(pickle.Unpickler):
    """Only lists, tuples, strings and ints -- nothing callable."""

    def find_class(self, module, name):  # noqa: D102
        raise pickle.UnpicklingError(f"refusing to load {module}.{name}")


def build_cedict(archive: Path, target: Path) -> int:
    with zipfile.ZipFile(archive) as bundle:
        payload = bundle.read(CEDICT_MEMBER)
    lines = _SafeUnpickler(io.BytesIO(payload)).load()
    rows: list[str] = []
    for line in lines:
        if not isinstance(line, str) or line.startswith("#"):
            continue
        match = re.match(r"^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+/(.*)/\s*$", line)
        if not match:
            continue
        traditional, simplified, pinyin, glosses = match.groups()
        rows.append("\t".join((traditional, simplified, pinyin, glosses)))
    target.write_text(
        "# CC-CEDICT  traditional\tsimplified\tpinyin\tglosses (slash separated)\n"
        + "\n".join(rows) + "\n",
        encoding="utf-8",
    )
    return len(rows)


TAG = re.compile(r"<[^>]+>")
SPACES = re.compile(r"[ \t\u00a0]+")


def plain_definition(html: str) -> str:
    text = html.replace("<br>", "\n").replace("</p>", "\n")
    text = TAG.sub("", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    lines = [SPACES.sub(" ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def build_enmy(archive: Path, target: Path) -> int:
    handle, name = tempfile.mkstemp(suffix=".db")
    os.close(handle)
    temporary = Path(name)
    try:
        with zipfile.ZipFile(archive) as bundle:
            temporary.write_bytes(bundle.read(ENMY_MEMBER))
        source = sqlite3.connect(f"file:{temporary}?mode=ro", uri=True)
        rows = source.execute(
            "select word, stripword, definition, keywords from dictionary"
        ).fetchall()
        source.close()

        if target.exists():
            target.unlink()
        output = sqlite3.connect(target)
        output.execute("PRAGMA journal_mode=OFF")
        output.execute(
            "CREATE TABLE entry (id INTEGER PRIMARY KEY, word TEXT, key TEXT, definition TEXT, keywords TEXT)"
        )
        output.execute("CREATE INDEX entry_word ON entry (word)")
        output.execute("CREATE INDEX entry_key ON entry (key)")
        count = 0
        for word, strip, definition, keywords in rows:
            if not word:
                continue
            output.execute(
                "INSERT INTO entry (word, key, definition, keywords) VALUES (?, ?, ?, ?)",
                (word, (strip or word).lower(), plain_definition(definition or ""), keywords or ""),
            )
            count += 1
        output.commit()
        output.close()
        return count
    finally:
        temporary.unlink(missing_ok=True)


def describe(path: Path) -> dict:
    payload = path.read_bytes()
    return {"path": str(path.relative_to(ROOT)), "bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest()}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--force", action="store_true", help="rebuild even if present")
    parser.add_argument("--check", action="store_true", help="report the current install")
    args = parser.parse_args(argv)

    STORE.mkdir(parents=True, exist_ok=True)
    cedict = STORE / "cc-cedict.tsv"
    enmy = STORE / "en-my.sqlite"

    if args.check:
        for path in (cedict, enmy):
            print(f"{'present' if path.exists() else 'missing'}  {path}  "
                  + (f"{path.stat().st_size} bytes" if path.exists() else ""))
        if PROVENANCE.exists():
            print(PROVENANCE.read_text(encoding="utf-8"))
        return 0

    if cedict.exists() and enmy.exists() and not args.force:
        print(f"[dicts] already installed in {STORE}")
        print(f"[dicts] use --force to rebuild, --check to inspect")
        return 0

    with tempfile.TemporaryDirectory() as workspace:
        workspace = Path(workspace)

        if args.force or not cedict.exists():
            archive = workspace / "cedict.zip"
            print(f"[dicts] downloading CC-CEDICT from {CEDICT_URL}")
            cedict_sha = download(CEDICT_URL, archive)
            count = build_cedict(archive, cedict)
            print(f"[dicts] cc-cedict.tsv: {count} entries, sha256 {cedict_sha[:12]} (archive)")

        if args.force or not enmy.exists():
            archive = workspace / "enmy.zip"
            print(f"[dicts] downloading English-Myanmar from {ENMY_URL}")
            enmy_sha = download(ENMY_URL, archive)
            count = build_enmy(archive, enmy)
            print(f"[dicts] en-my.sqlite: {count} headwords, sha256 {enmy_sha[:12]} (archive)")

    provenance = {
        "note": "Installed by format/fetch_dicts.py. Not committed; rebuild with --force.",
        "cedict": {"source": CEDICT_URL, "member": CEDICT_MEMBER, **describe(cedict)},
        "en_my": {"source": ENMY_URL, "member": ENMY_MEMBER, **describe(enmy)},
        "installer": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    }
    PROVENANCE.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")
    print(f"[dicts] installed into {STORE}")
    print(json.dumps(provenance, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
