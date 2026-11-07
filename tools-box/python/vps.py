"""One-shot SSH transfers using the repository-root .env.

    python3 tools-box/python/vps.py --download-list representative-pdf-names.txt selected-pdfs
    python3 tools-box/python/vps.py --download REMOTE_FILE LOCAL_DIR
    python3 tools-box/python/vps.py --upload LOCAL_FILE REMOTE_DIR

--download-list reads filenames from the local list and downloads them from
SSH_DIR over one SSH connection. It skips existing local filenames and writes
one file at a time. The remote host needs tar. SSH_HOST, SSH_USER, SSH_PORT,
SSH_KEY and SSH_DIR are read from the repository-root .env. SSH_KEY is a path
to a private key file on this machine; SSH_DIR is the complete remote folder.

The individual upload/download modes use the remote path supplied on the
command line. There is no resume, retry, ledger or hash verification.

exit codes: 0 ok, 1 failed, 2 usage error
"""

from __future__ import annotations

import argparse
import importlib
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path
from typing import IO

CONNECT_TIMEOUT = 20


class VpsError(RuntimeError):
    """Unreachable host, missing key or bad argument."""


@dataclass(frozen=True)
class SSHConfig:
    host: str
    user: str
    port: int
    key: str
    directory: str

    @property
    def target(self) -> str:
        return f"{self.user}@{self.host}"


def load_config() -> SSHConfig:
    """Read the SSH settings directly from the shared root .env."""
    repo_root = Path(__file__).resolve().parents[2]
    env_file = repo_root / ".env"
    try:
        text = env_file.read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise VpsError("repository-root .env not found") from error
    except (OSError, UnicodeError) as error:
        raise VpsError("cannot read repository-root .env") from error

    if str(repo_root) not in sys.path:
        sys.path.insert(0, str(repo_root))
    values = importlib.import_module("index-path").parse_dotenv(text)
    host = values.get("SSH_HOST", "").strip()
    user = values.get("SSH_USER", "").strip()
    if not host or not user:
        raise VpsError("SSH_HOST and SSH_USER must be set in the root .env")
    try:
        port = int(values.get("SSH_PORT", "").strip() or "22")
    except ValueError as error:
        raise VpsError("SSH_PORT must be a number from 1 to 65535") from error
    if not 1 <= port <= 65535:
        raise VpsError("SSH_PORT must be a number from 1 to 65535")
    key = values.get("SSH_KEY", "").strip()
    if any(char in key for char in "\0\r\n") or key.startswith("-----BEGIN "):
        raise VpsError("SSH_KEY must be a path to a local key file")
    return SSHConfig(
        host=host,
        user=user,
        port=port,
        key=key,
        directory=values.get("SSH_DIR", "").strip(),
    )


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
    """Return the remote account home for the individual transfer modes."""
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


def _names_to_download(list_path: Path, local_dir: Path) -> list[str]:
    try:
        lines = list_path.read_text(encoding="utf-8").splitlines()
    except (OSError, UnicodeError) as error:
        raise VpsError("cannot read the filename list") from error

    names = []
    seen = set()
    for name in lines:
        if not name:
            continue
        if name in (".", "..") or "/" in name or "\0" in name:
            raise VpsError("the list must contain filenames, not paths")
        if name in seen:
            continue
        seen.add(name)
        if os.path.lexists(local_dir / name):
            _log(f"Skipping existing: {name}")
        else:
            names.append(name)
    return names


def _remote_directory_arg(directory: str) -> str:
    if directory in ("~", "~/"):
        return '"$HOME"'
    if directory.startswith("~/"):
        return '"$HOME"/' + shlex.quote(directory[2:])
    return shlex.quote(directory)


def _save_member(archive: tarfile.TarFile, member: tarfile.TarInfo, target: Path) -> bool:
    source = archive.extractfile(member)
    if source is None:
        return False
    try:
        try:
            output = target.open("xb")
        except FileExistsError:
            _log(f"Skipping existing: {target.name}")
            return False
        created = os.fstat(output.fileno())
        try:
            with output:
                shutil.copyfileobj(source, output, length=1024 * 1024)
        except BaseException:
            # Remove only the incomplete file this transfer created, if it is
            # still the same regular file. Never remove a pre-existing target.
            try:
                current = target.lstat()
                if (stat.S_ISREG(current.st_mode) and current.st_dev == created.st_dev
                        and current.st_ino == created.st_ino):
                    target.unlink()
            except OSError:
                pass
            raise
        return True
    finally:
        source.close()


def download_list(config: SSHConfig, list_path: Path, local_dir: Path) -> None:
    if not config.directory:
        raise VpsError("SSH_DIR must be set in the root .env")
    names = _names_to_download(list_path, local_dir)
    if not names:
        _log("Nothing to download.")
        return
    try:
        local_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise VpsError("cannot create the download directory") from error

    # Exact names only, no directory listing. A single tar stream sends one
    # file after another over the one SSH connection.
    arguments = " ".join(shlex.quote(name) for name in names)
    command = (
        f"cd -- {_remote_directory_arg(config.directory)} || exit 1; "
        "set --; "
        f"for name in {arguments}; do "
        'if [ -f "$name" ]; then set -- "$@" "$name"; fi; '
        'done; if [ "$#" -gt 0 ]; then tar -chf - -- "$@"; fi'
    )
    try:
        process = subprocess.Popen(
            _ssh(config, command), stdin=subprocess.DEVNULL, stdout=subprocess.PIPE
        )
    except FileNotFoundError as error:
        raise VpsError("ssh binary not found; install openssh-client") from error

    remaining = set(names)
    stream_error = False
    try:
        with tarfile.open(fileobj=process.stdout, mode="r|") as archive:
            for member in archive:
                if member.name not in remaining or not member.isfile():
                    continue
                target = local_dir / member.name
                if _save_member(archive, member, target):
                    _log(f"Downloaded: {member.name}")
                remaining.remove(member.name)
        while process.stdout.read(1024 * 1024):
            pass
    except (tarfile.TarError, EOFError):
        stream_error = True
    except BaseException:
        process.terminate()
        process.stdout.close()
        process.wait()
        raise
    finally:
        process.stdout.close()
    status = process.wait()
    if status and len(remaining) == len(names):
        raise VpsError("SSH connection or remote directory failed")
    for name in names:
        if name in remaining:
            _log(f"Not downloaded: {name}")
    if status or remaining or stream_error:
        raise VpsError("download incomplete")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="vps.py",
        description=(
            "SSH transfers using the repository-root .env. "
            "--download-list reads local filenames and downloads them from SSH_DIR "
            "over one connection."
        ),
        epilog=(
            "examples:\n"
            "  python3 tools-box/python/vps.py --download-list representative-pdf-names.txt selected-pdfs\n"
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
    direction.add_argument(
        "--download-list", action="store_true", help="download filenames from a local list in one SSH connection"
    )
    parser.add_argument(
        "source", metavar="SOURCE", help="local path, remote path, or filename list"
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
        if args.download_list:
            download_list(config, local_dir_arg(args.source), local_dir_arg(args.destination))
        else:
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
    except OSError:
        _log("[remote] failed: local file error")
        return 1
    except KeyboardInterrupt:
        _log("[remote] interrupted")
        return 130


if __name__ == "__main__":
    sys.exit(main())
