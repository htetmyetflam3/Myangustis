#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Install the offline models used by `mt/translate.py --engine offline`.

    python3 mt/fetch_engine.py --check
    python3 mt/fetch_engine.py --install zh-en
    python3 mt/fetch_engine.py --install en-zh

Exactly two routes, because `mt/translate.py` runs exactly two:

    zh-en   Chinese -> English    translate-zh_en-1_0    ~86 MB
    en-zh   English -> Chinese    translate-en_zh-1_0    ~86 MB

There is no Burmese model anywhere. Argos publishes a hundred packages and none
is `my`. The current tracked API translation is English-only; the retained human
Burmese source is separate and has known encoding damage.

Nothing has to be installed to run this file. An `.argosmodel` is a zip, and it
is unpacked here with `zipfile` — `argostranslate` is neither imported nor
needed. That package was only ever an unpacker, and requiring it made a
`--install` fail after the 86 MB clone had already been downloaded.

The models themselves are read by `mt/translate.py` with `ctranslate2` and
`sentencepiece`. Those two are needed to *run* a model, not to install one, so
this script is standard-library only.

The mirror is `jiangwensm/OPUS-argosmodels` on GitHub, fetched with a sparse git
clone because argosopentech.com is not reachable from the machines this runs on.
Models land outside the repository, in `$XDG_DATA_HOME/argos-translate/packages`,
and are never committed. Nothing is written inside the repo: the state is the
package directory itself, printed by `--check` and by `--json`.

    python3 mt/fetch_engine.py --check --json
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

MIRROR = "https://github.com/jiangwensm/OPUS-argosmodels"
FILES = {
    "zh-en": "1.0/translate-zh_en-1_0.argosmodel",
    "en-zh": "1.0/translate-en_zh-1_0.argosmodel",
}
PACKAGE_ROOT = (Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
                / "argos-translate" / "packages")
MODEL_MARKER = "model/model.bin"


def package_dir(route: str, root: Path | str | None = None) -> Path:
    """Where one route's package lives; `mt/translate.py` looks here too."""
    return Path(root or PACKAGE_ROOT) / f"translate-{route.replace('-', '_')}-1_0"


def installed(route: str, root: Path | str | None = None) -> Path | None:
    """The package directory, or None unless the checkpoint is actually there."""
    path = package_dir(route, root)
    return path if (path / "model" / "model.bin").is_file() else None


def model_bytes(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


def unpack(archive: Path | str, route: str, root: Path | str | None = None) -> Path:
    """Unpack one `.argosmodel` into the directory `translate.py` expects."""
    archive = Path(archive)
    root = Path(root or PACKAGE_ROOT)
    target = package_dir(route, root)
    staging = Path(tempfile.mkdtemp(prefix=f".unpack-{route}-", dir=str(root)))
    try:
        with zipfile.ZipFile(archive) as bundle:
            names = [name for name in bundle.namelist() if not name.endswith("/")]
            marker = next((name for name in names if name.endswith(MODEL_MARKER)), None)
            if marker is None:
                raise SystemExit(
                    f"{archive.name}: no {MODEL_MARKER} inside, so it is not an "
                    ".argosmodel archive")
            # Archives in the wild either start at the package root or wrap
            # everything in one top-level folder. Both land the same way.
            prefix = marker[: -len(MODEL_MARKER)]
            for name in names:
                if prefix and not name.startswith(prefix):
                    continue
                relative = name[len(prefix):]
                if not relative:
                    continue
                # Never trust an archive path: no absolute names, no `..`.
                if PurePosixPath(relative).is_absolute() or ".." in PurePosixPath(relative).parts:
                    raise SystemExit(f"{archive.name}: refusing unsafe member {name!r}")
                destination = staging / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                with bundle.open(name) as source, destination.open("wb") as sink:
                    shutil.copyfileobj(source, sink)
        if not (staging / MODEL_MARKER).is_file():
            raise SystemExit(f"{archive.name}: unpacked without {MODEL_MARKER}")
        if target.exists():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        staging.rename(target)
    finally:
        if staging.exists():  # only on failure; the rename above consumes it
            shutil.rmtree(staging, ignore_errors=True)
    return target


def fetch(route: str, root: Path | str | None = None) -> Path:
    """Clone the one archive out of the mirror, unpack it, return the package."""
    if route not in FILES:
        raise SystemExit(f"no offline model for {route}; "
                         f"available: {', '.join(sorted(FILES))}")
    root = Path(root or PACKAGE_ROOT)
    root.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as workspace:
        workspace = Path(workspace)
        print(f"[engine] cloning {MIRROR} (sparse: {FILES[route]})")
        clone = subprocess.run(
            ["git", "clone", "--depth", "1", "--filter=blob:none", "--sparse",
             MIRROR, str(workspace / "m")],
            capture_output=True, text=True,
        )
        if clone.returncode != 0:
            raise SystemExit(
                f"[engine] git clone failed: {clone.stderr.strip().splitlines()[-1:] or ''}\n"
                "[engine] git must be installed and github.com reachable")
        checkout = subprocess.run(
            ["git", "-C", str(workspace / "m"), "sparse-checkout", "set",
             "--skip-checks", FILES[route]],
            capture_output=True, text=True,
        )
        if checkout.returncode != 0:
            raise SystemExit(f"[engine] sparse checkout failed: {checkout.stderr.strip()}")
        archive = workspace / "m" / FILES[route]
        if not archive.is_file():
            raise SystemExit(f"[engine] clone did not produce {FILES[route]}")
        print(f"[engine] unpacking {archive.name} ({archive.stat().st_size / 1e6:.0f} MB)")
        return unpack(archive, route, root)


def report(root: Path | str | None = None) -> dict:
    root = Path(root or PACKAGE_ROOT)
    routes = {}
    for route, archive in FILES.items():
        path = installed(route, root)
        routes[route] = {
            "state": "installed" if path else "downloadable",
            "path": str(path) if path else None,
            "bytes": model_bytes(path) if path else 0,
            "archive": archive,
        }
    return {"package_dir": str(root), "routes": routes}


def print_report(payload: dict) -> None:
    print(f"\n[engine] package directory: {payload['package_dir']}")
    print(f"{'route':<8}{'status':<14}{'size':<9}path")
    for route, row in payload["routes"].items():
        size = f"{row['bytes'] / 1e6:.0f} MB" if row["bytes"] else "-"
        print(f"{route:<8}{row['state']:<14}{size:<9}{row['path'] or '-'}")
    if not any(row["state"] == "installed" for row in payload["routes"].values()):
        print("[engine] nothing installed yet; "
              "python3 mt/fetch_engine.py --install zh-en")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Install the offline zh-en / en-zh models used by mt/translate.py.",
        epilog="Standard library only; argostranslate is not needed or used.")
    parser.add_argument("--install", action="append", choices=sorted(FILES), default=[],
                        metavar="{zh-en,en-zh}", help="route to install")
    parser.add_argument("--all-available", action="store_true",
                        help="install every downloadable model (both routes)")
    parser.add_argument("--check", action="store_true",
                        help="report what is installed; installs nothing")
    parser.add_argument("--remove", action="append", choices=sorted(FILES), default=[],
                        metavar="{zh-en,en-zh}", help="delete an installed model")
    parser.add_argument("--package-dir", type=Path, default=None, metavar="PATH",
                        help=f"where packages live (default: {PACKAGE_ROOT})")
    parser.add_argument("--json", action="store_true",
                        help="print the report as one JSON object, write nothing")
    args = parser.parse_args(argv)

    root = args.package_dir or PACKAGE_ROOT

    if args.remove:
        for route in args.remove:
            target = installed(route, root)
            if target:
                shutil.rmtree(target)
                print(f"[engine] removed {target}")
            else:
                print(f"[engine] {route}: not installed")

    wanted = list(args.install)
    if args.all_available:
        wanted = sorted(FILES)
    for route in wanted:
        existing = installed(route, root)
        if existing:
            print(f"[engine] {route}: already installed at {existing}")
            continue
        print(f"[engine] {route}: {fetch(route, root)}")

    payload = report(root)
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print_report(payload)
    return 0


if __name__ == "__main__":
    sys.exit(main())
