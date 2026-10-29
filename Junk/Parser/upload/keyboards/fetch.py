#!/usr/bin/env python3
"""Fetch the pinned keyboard originals listed in sources.json.

Some originals have no clear redistribution license. This downloads them from
upstream for local use rather than placing copies in this repository.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import tarfile
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "sources.json"
LOCAL_PREFIX = PurePosixPath("Junk/Parser/upload/keyboards")
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def destination(root: Path, local: str) -> Path:
    relative = PurePosixPath(local).relative_to(LOCAL_PREFIX)
    if any(part in ("", ".", "..") for part in relative.parts):
        raise ValueError(f"Unsafe keyboard path: {local}")
    target = root.joinpath(*relative.parts)
    if not target.resolve().is_relative_to(root.resolve()):
        raise ValueError(f"Keyboard path escapes destination: {local}")
    return target


def fetch_archive(owner: str, repo: str, revision: str) -> bytes:
    url = f"https://codeload.github.com/{owner}/{repo}/tar.gz/{revision}"
    request = Request(url, headers={"User-Agent": "Myangustis-keyboard-fetcher"})
    with urlopen(request, timeout=60) as response:
        data = response.read(MAX_ARCHIVE_BYTES + 1)
    if len(data) > MAX_ARCHIVE_BYTES:
        raise ValueError(f"Archive exceeds {MAX_ARCHIVE_BYTES} bytes: {url}")
    return data


def fetch_all(root: Path) -> tuple[int, int]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    root.mkdir(parents=True, exist_ok=True)
    groups = {}
    kept = 0
    for entry in manifest["files"]:
        target = destination(root, entry["local"])
        if target.is_symlink():
            raise ValueError(f"Refusing to overwrite symlink: {target}")
        if target.exists():
            if not target.is_file() or sha256(target.read_bytes()) != entry["sha256"]:
                raise ValueError(f"Existing file differs; leave it untouched: {target}")
            kept += 1
            continue
        groups.setdefault((entry["source"], entry["revision"]), []).append((entry, target))

    written = 0
    for (source, revision), wanted in groups.items():
        owner, repo = source.split("/", 1)
        archive = fetch_archive(owner, repo, revision)
        remaining = {entry["path"]: (entry, target) for entry, target in wanted}
        verified = []
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as tar:
            for member in tar:
                parts = PurePosixPath(member.name).parts
                relative = "/".join(parts[1:])
                if relative not in remaining or not member.isfile():
                    continue
                entry, target = remaining.pop(relative)
                if member.size != entry["bytes"]:
                    raise ValueError(f"Size mismatch: {source}/{relative}")
                stream = tar.extractfile(member)
                data = stream.read(entry["bytes"] + 1) if stream else b""
                if len(data) != entry["bytes"] or sha256(data) != entry["sha256"]:
                    raise ValueError(f"SHA-256 mismatch: {source}/{relative}")
                verified.append((target, data))
        if remaining:
            raise ValueError(f"Missing upstream files in {source}: {', '.join(remaining)}")
        for target, data in verified:
            target.parent.mkdir(parents=True, exist_ok=True)
            # Exclusive creation avoids overwriting a file that appeared meanwhile.
            with target.open("xb") as stream:
                stream.write(data)
            written += 1
        print(f"{source}: downloaded and verified {len(verified)} files")
    return written, kept


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--destination", type=Path, default=HERE,
                        help="directory for the downloaded keyboard collection")
    args = parser.parse_args()
    written, kept = fetch_all(args.destination)
    print(f"Verified {written + kept} files ({written} downloaded, {kept} already present).")
    print("Check each upstream license before redistribution.")


if __name__ == "__main__":
    main()
