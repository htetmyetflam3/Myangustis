"""One-shot file transfers using the Scraper's shared-host SSH configuration.

    uv run vps.py --upload   LOCAL   REMOTE_DIR
    uv run vps.py --download REMOTE  LOCAL_DIR

The Scraper's save_remote.py supplies SSH_HOST, SSH_USER, SSH_PORT and SSH_KEY
from the shared environment/.env. SSH_DIR belongs to the Scraper's archive;
this tool uses the remote path explicitly supplied on the command line.

The first argument is the source and the second is the destination directory.
Local paths are relative to the current directory; remote paths are relative to
the remote account's home unless absolute. Quote a leading ``~`` to prevent
local shell expansion. A source ending in ``/`` transfers its immediate files,
not subdirectories. There is no resume, retry or hash verification. Existing
destination files are overwritten.

exit codes: 0 ok, 1 failed, 2 usage error
"""

from __future__ import annotations

import argparse
import importlib
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import IO

CONNECT_TIMEOUT = 20


class VpsError(RuntimeError):
    """Unreachable host, missing key or bad argument."""


def load_config():
    """Use the same workspace environment and configuration as the Scraper."""
    repo_root = Path(__file__).resolve().parents[2]
    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    importlib.import_module("index-path")

    scraper = next(
        (
            path / "main"
            for path in sorted(repo_root.glob("*.Scraper"))
            if (path / "main" / "bootstrap.py").is_file()
            and (path / "main" / "modules" / "download" / "save_remote.py").is_file()
        ),
        None,
    )
    if scraper is None:
        raise VpsError("Scraper's bootstrap.py and save_remote.py were not found")
    sys.path.insert(0, str(scraper))
    importlib.import_module("bootstrap")
    remote = importlib.import_module("save_remote")
    try:
        config = remote.load_config()
    except remote.RemoteError as error:
        raise VpsError(str(error)) from error
    if not 1 <= config.port <= 65535:
        raise VpsError("SSH_PORT must be a number from 1 to 65535")
    return config


def _log(message: str) -> None:
    print(message, flush=True)


def _ssh(config, command: str) -> list[str]:
    args = [
        "ssh",
        "-p",
        str(config.port),
        "-o",
        "BatchMode=yes",
        "-o",
        f"ConnectTimeout={CONNECT_TIMEOUT}",
        "-o",
        "ServerAliveInterval=30",
    ]
    if config.key:
        args.extend(["-i", os.path.expanduser(config.key), "-o", "IdentitiesOnly=yes"])
    args.extend([config.target, command])
    return args


def _run(
    config,
    command: str,
    *,
    stdin=None,
    stdout: int | IO[bytes] | None = subprocess.PIPE,
) -> subprocess.CompletedProcess:
    """Run one command on the VPS. stdout is captured unless a file is given
    (the download path streams straight into the destination file)."""
    try:
        return subprocess.run(
            _ssh(config, command),
            stdin=stdin,
            stdout=stdout,
            stderr=subprocess.PIPE,
            text=True,
        )
    except FileNotFoundError as error:
        raise VpsError("ssh binary not found; install openssh-client") from error


def _fail(result: subprocess.CompletedProcess, what: str) -> None:
    detail = (result.stderr or "").strip().splitlines()
    raise VpsError(f"{what}: {detail[-1] if detail else f'exit {result.returncode}'}")


def preflight(config) -> str:
    """Check the configured key and connection; return the remote account home."""
    if config.key and not Path(os.path.expanduser(config.key)).is_file():
        raise VpsError("SSH_KEY file not found; check the Scraper's SSH_KEY setting")
    result = _run(config, "echo $HOME")  # expanded by the remote shell, not here
    if result.returncode != 0:
        _fail(result, "cannot connect to the configured SSH host")
    home = (result.stdout or "").strip().splitlines()
    if not home or not home[-1].startswith("/"):
        raise VpsError("cannot read the remote account home")
    return home[-1]


def remote_path(raw: str, home: str) -> str:
    """Absolute remote path: ~ and relative paths resolve in `home`."""
    path = raw.strip()
    if path.startswith("~"):
        path = path[1:].lstrip("/")
    if path.startswith("/"):
        return path
    return f"{home.rstrip('/')}/{path}" if path else home


def wants_directory(raw: str, exists: bool) -> bool:
    """A trailing slash, or an existing directory, means 'the files inside'."""
    return raw.endswith("/") or exists


def expand_local(raw: str) -> list[Path]:
    """One local file, or every file inside a local directory."""
    path = Path(os.path.expanduser(raw))
    if not path.is_absolute():
        path = Path.cwd() / path  # relative to where you ran the script
    if not wants_directory(raw, path.is_dir()):
        if not path.is_file():
            raise VpsError(f"no such local file: {path}")
        return [path]
    if not path.is_dir():
        raise VpsError(f"no such local directory: {path}")
    files = sorted(entry for entry in path.iterdir() if entry.is_file())
    if not files:
        raise VpsError(f"no files inside {path}")
    return files


def expand_remote(config, raw: str, home: str) -> list[str]:
    """One remote file, or every file inside a remote directory."""
    target = remote_path(raw, home)
    if not wants_directory(raw, False):
        return [target]
    directory = target.rstrip("/")
    result = _run(config, f"ls -1p -- {shlex.quote(directory)}")
    if result.returncode != 0:
        _fail(result, f"cannot list remote directory {directory}")
    names = [
        line.strip()
        for line in (result.stdout or "").splitlines()
        if line.strip() and not line.strip().endswith("/")  # skip sub-directories
    ]
    if not names:
        raise VpsError(f"no files inside remote directory {directory}")
    return [f"{directory}/{name}" for name in sorted(names)]


def upload(config, sources: list[Path], remote_dir: str, home: str) -> None:
    directory = remote_path(remote_dir, home)
    result = _run(config, f"mkdir -p -- {shlex.quote(directory)}")
    if result.returncode != 0:
        _fail(result, f"cannot create remote directory {directory}")
    for index, local in enumerate(sources, 1):
        target = f"{directory.rstrip('/')}/{local.name}"
        _log(f"[remote] -> {local} ({local.stat().st_size} bytes) to {target}")
        with local.open("rb") as handle:
            sent = _run(config, f"cat > {shlex.quote(target)}", stdin=handle)
        if sent.returncode != 0:
            _fail(sent, f"upload of {local.name} failed")
        _log(f"[remote] ok {index}/{len(sources)}")


def download(config, sources: list[str], local_dir: Path) -> None:
    local_dir.mkdir(parents=True, exist_ok=True)
    for index, remote in enumerate(sources, 1):
        target = local_dir / remote.rstrip("/").rsplit("/", 1)[-1]
        _log(f"[remote] <- {remote} to {target}")
        with target.open("wb") as handle:
            got = _run(config, f"cat -- {shlex.quote(remote)}", stdout=handle)
        if got.returncode != 0:
            target.unlink(missing_ok=True)  # our own empty file, nothing else
            _fail(got, f"download of {target.name} failed")
        _log(f"[remote] ok {index}/{len(sources)} ({target.stat().st_size} bytes)")


def local_dir_arg(raw: str) -> Path:
    path = Path(os.path.expanduser(raw))
    return path if path.is_absolute() else Path.cwd() / path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vps.py",
        description=(
            "One-shot file transfer using the Scraper's shared-host SSH settings. "
            "--upload is LOCAL then REMOTE_DIR; --download is REMOTE then "
            "LOCAL_DIR. A source ending in / transfers the files inside it."
        ),
        epilog=(
            "examples:\n"
            "  python3 tools-box/python/vps.py --upload ./book.pdf pdfs/convertable/\n"
            "  python3 tools-box/python/vps.py --download pdfs/convertable/book.pdf ./pdfs/\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    direction = parser.add_mutually_exclusive_group(required=True)
    direction.add_argument(
        "--upload", action="store_true", help="push a local file or directory to a remote directory"
    )
    direction.add_argument(
        "--download", action="store_true", help="pull a remote file or directory to a local directory"
    )
    parser.add_argument(
        "source", metavar="SOURCE", help="local path (--upload) or remote path (--download)"
    )
    parser.add_argument(
        "destination",
        metavar="DEST",
        help="remote directory (--upload) or local directory (--download)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        config = load_config()
        home = preflight(config)
        if args.upload:
            sources = expand_local(args.source)
            _log(f"[remote] upload {len(sources)} file(s) -> {args.destination}")
            upload(config, sources, args.destination, home)
        else:
            sources = expand_remote(config, args.source, home)
            dest = local_dir_arg(args.destination)
            _log(f"[remote] download {len(sources)} file(s) -> {dest}")
            download(config, sources, dest)
        _log("[remote] done")
        return 0
    except VpsError as error:
        _log(f"[remote] failed: {error}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
