#!/bin/sh
# ============================================================
# Connect to the project Codespace from a local terminal.
#
#   ./.bin/codespace.sh          ssh in (default)
#   ./.bin/codespace.sh status   is it running?
#   ./.bin/codespace.sh start    wake it without ssh
#   ./.bin/codespace.sh stop     stop it (saves core-hours)
#   ./.bin/codespace.sh logs     creation/setup log
#   ./.bin/codespace.sh list     all your codespaces
#   ./.bin/codespace.sh cp FILE  copy a local file into the repo
#   ./.bin/codespace.sh ports    forwarded ports
#
# Config comes from the repo-root .env:
#
#   CODESPACE_NAME=curly-space-lamp-q77q5j7pq6g4f45x6
#   GH_TOKEN=              # leave blank; use `gh auth login` instead
#
# NOTE: .env is tracked in git, so anything written there is pushed.
# CODESPACE_NAME is not secret and is fine to keep here. If you ever do need
# GH_TOKEN, export it in your shell instead of writing it to this file:
#   GH_TOKEN=ghp_xxx ./.bin/codespace.sh
#
# POSIX sh - runs under busybox ash on Alpine.
# ============================================================
set -eu

# The script lives at the repo root, so its own directory IS the repo root.
. "$(dirname "$0")/lib.sh"
ENV_FILE="${CODESPACE_ENV_FILE:-$REPO_ROOT/.env}"

# die/ok/info come from lib.sh

# --- config -------------------------------------------------
# Read one KEY from the env file without sourcing it. Sourcing this .env
# breaks anyway: line 4 is a `//`-style comment that the shell tries to
# execute ("//INPUT_PATH=...: No such file or directory").
read_key() {
  [ -f "$ENV_FILE" ] || return 1
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$ENV_FILE" 2>/dev/null \
    | tail -n 1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# Environment wins over the file, so a one-off export can override.
[ -n "${CODESPACE_NAME:-}" ] || CODESPACE_NAME="$(read_key CODESPACE_NAME || true)"
[ -n "${GH_TOKEN:-}" ]       || GH_TOKEN="$(read_key GH_TOKEN || true)"

command -v gh >/dev/null 2>&1 || die "gh not found. On Alpine: apk add github-cli"

# --- auth ---------------------------------------------------
# Prefer an existing interactive login; only fall back to the token. gh reads
# GH_TOKEN from the environment natively, so it never appears in argv
# (/proc/<pid>/cmdline is world-readable).
if ! gh auth status >/dev/null 2>&1; then
  if [ -n "${GH_TOKEN:-}" ]; then
    export GH_TOKEN
    gh auth status >/dev/null 2>&1 || die "GH_TOKEN rejected. Needs 'codespace' scope."
    info "authenticated via GH_TOKEN"
  else
    die "not logged in. Run: gh auth login"
  fi
fi
[ -n "${GH_TOKEN:-}" ] && export GH_TOKEN || true

[ -n "${CODESPACE_NAME:-}" ] || die "CODESPACE_NAME not set. Add it to $ENV_FILE"

cmd="${1:-ssh}"
[ $# -gt 0 ] && shift || true

case "$cmd" in
  ssh|connect|"")
    info "connecting to $CODESPACE_NAME"
    info "(a stopped codespace starts automatically; first connect is slow)"
    # cd into the repo on arrival so you land where the work is.
    exec gh codespace ssh -c "$CODESPACE_NAME" -- -t \
      'cd /workspaces/linga 2>/dev/null || cd /workspaces/*; exec $SHELL -l'
    ;;
  status)
    gh codespace list --json name,state,gitStatus,machineName \
      --jq '.[] | select(.name=="'"$CODESPACE_NAME"'")
            | "name:    \(.name)\nstate:   \(.state)\nmachine: \(.machineName)\nbranch:  \(.gitStatus.ref)\nahead:   \(.gitStatus.ahead)  behind: \(.gitStatus.behind)"' \
      2>/dev/null || gh codespace list
    ;;
  start|wake)
    info "starting $CODESPACE_NAME"
    # There is no explicit `start`; a trivial ssh command wakes it.
    gh codespace ssh -c "$CODESPACE_NAME" -- 'echo awake' && ok "running"
    ;;
  stop)
    gh codespace stop -c "$CODESPACE_NAME" && ok "stopped (core-hours no longer burning)"
    ;;
  logs)
    gh codespace logs -c "$CODESPACE_NAME"
    ;;
  list|ls)
    gh codespace list
    ;;
  cp)
    [ $# -ge 1 ] || die "usage: $0 cp <local-file> [remote-path]"
    src="$1"; dst="${2:-/workspaces/linga/}"
    gh codespace cp -e "$src" "remote:$dst" -c "$CODESPACE_NAME" && ok "copied $src -> $dst"
    ;;
  ports)
    gh codespace ports -c "$CODESPACE_NAME"
    ;;
  *)
    die "unknown command: $cmd (try: ssh|status|start|stop|logs|list|cp|ports)"
    ;;
esac
