#!/bin/sh
# ============================================================
# FILE: .bin/lib.sh — shared helper for every shell script in this repo.
#
# WHY: scripts used to hardcode their distance to the repo root
# ("$(dirname $0)", "$(dirname $0)/..", "$(dirname $0)/../..").  Every time a
# script moved, that arithmetic broke silently — and silently is the bad part,
# because a wrong REPO_ROOT means the servers read the wrong path maps.
#
# This helper finds the root by SEARCHING for a marker instead of counting
# directories, so a script can live at any depth and keep working.
#
# USAGE — put this at the top of a script, before anything else:
#
#     . "$(dirname "$0")/lib.sh"          # from .bin/
#     . "$(dirname "$0")/../.bin/lib.sh"  # from one level down
#
# CALLING CONVENTION — pass the root as a relative path, or omit it:
#
#     ./.bin/git.sh ../                 # ../ from .bin/ IS the project root
#     ./.bin/codespace.sh ../ status
#     ./.bin/git.sh                     # same thing, root auto-detected
#
# The path is relative to the SCRIPT, not the cwd, so the command means the
# same thing from anywhere. It is shifted off before the script sees "$@".
#
#   then:
#     cd "$REPO_ROOT"          # every script runs from the root
#     ok "done"; warn "..."; die "fatal"
#     need node                # abort unless on PATH
#     v="$(env_get DB_HOST)"   # read a key from .env without sourcing it
#
# POSIX sh only — must run under busybox ash on Alpine. No BASH_SOURCE, no
# arrays, no [[ ]], no ${x,,}.
# ============================================================

# --- repo root ----------------------------------------------
# Walk up from this file until package.json is found. lib.sh lives in .bin/,
# so the search starts there and normally hits the root on the first step.
_lib_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
_find_root() {
  d="$1"
  while [ "$d" != "/" ]; do
    if [ -f "$d/package.json" ]; then printf '%s\n' "$d"; return 0; fi
    d="$(dirname "$d")"
  done
  return 1
}

# EXPLICIT ROOT ARGUMENT (the documented calling convention):
#
#     ./.bin/git.sh ../            # ../ from .bin/ IS the project root
#     ./.bin/codespace.sh ../ status
#     sh deploy/cloudflare/tunnel/tunnel.sh ../../../ check
#
# When the first argument names a directory holding package.json, that IS the
# root: take it and shift it off, so the calling script's "$@" sees only its
# own subcommands. `shift` works here because a sourced file shares the
# caller's positional parameters - this is not a function.
#
# The argument is optional. Omit it and the root is found by walking up from
# the script's own location, so both call styles work.
# The path is resolved relative to the SCRIPT's directory, not the cwd - "../"
# means "one level up from this script", which is what the caller means when
# they type it. Resolving against the cwd instead would make the same command
# succeed or fail depending on where it was run from.
REPO_ROOT=""
if [ $# -gt 0 ]; then
  case "$1" in
    -*) : ;;                      # a flag, not a path
    *)
      if [ -f "$_lib_dir/$1/package.json" ]; then
        REPO_ROOT="$(CDPATH= cd -- "$_lib_dir/$1" && pwd)"; shift
      elif [ -f "$1/package.json" ]; then
        REPO_ROOT="$(CDPATH= cd -- "$1" && pwd)"; shift
      fi
      ;;
  esac
fi

# $0's directory is where the *calling* script lives, which is the right place
# to start. Fall back to $PWD if that fails (e.g. sourced from an odd context).
[ -n "$REPO_ROOT" ] || REPO_ROOT="$(_find_root "$_lib_dir" || _find_root "$PWD" || true)"
[ -n "${REPO_ROOT:-}" ] || {
  printf 'lib.sh: cannot locate repo root (no package.json above %s)\n' "$_lib_dir" >&2
  exit 1
}
export REPO_ROOT

BIN_DIR="$REPO_ROOT/.bin"
export BIN_DIR

# --- output -------------------------------------------------
# Colour only when stdout is a terminal, so logs and pipes stay clean.
if [ -t 1 ]; then
  C_RED=''; C_GRN=''; C_YEL=''; C_CYN=''; C_DIM=''; C_RST=''
  C_RED="$(printf '\033[31m')"; C_GRN="$(printf '\033[32m')"
  C_YEL="$(printf '\033[33m')"; C_CYN="$(printf '\033[36m')"
  C_DIM="$(printf '\033[2m')";  C_RST="$(printf '\033[0m')"
else
  C_RED=''; C_GRN=''; C_YEL=''; C_CYN=''; C_DIM=''; C_RST=''
fi

ok()   { printf '%s✓%s %s\n' "$C_GRN" "$C_RST" "$*"; }
info() { printf '%s•%s %s\n' "$C_CYN" "$C_RST" "$*"; }
warn() { printf '%s!%s %s\n' "$C_YEL" "$C_RST" "$*" >&2; }
die()  { printf '%s✗%s %s\n' "$C_RED" "$C_RST" "$*" >&2; exit 1; }
dim()  { printf '%s%s%s\n' "$C_DIM" "$*" "$C_RST"; }

# Path relative to the repo root, for tidy messages.
rel() { printf '%s\n' "${1#"$REPO_ROOT"/}"; }

# --- guards -------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || die "$1 not found on PATH${2:+ — $2}"; }
have() { command -v "$1" >/dev/null 2>&1; }

# --- env files ----------------------------------------------
# Read ONE key from a dotenv file without sourcing it. Sourcing this repo's
# .env fails outright: it contains a `//`-style comment that the shell tries
# to execute. Grepping also means a stray quote cannot run code.
env_get() {
  _k="$1"; _f="${2:-$REPO_ROOT/.env}"
  [ -f "$_f" ] || return 1
  grep -E "^[[:space:]]*$_k[[:space:]]*=" "$_f" 2>/dev/null \
    | tail -n 1 | cut -d= -f2- \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' \
          -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

# True when a key is present and non-empty.
env_has() { [ -n "$(env_get "$1" "${2:-}" 2>/dev/null)" ]; }

# Read a key the way the EDGE does: the ENVIRONMENT wins, the file is the
# fallback. That precedence is what deploy/cloudflare/SECRETS.md documents, and
# it is not a detail: on a Codespace the repo-scoped secrets arrive as
# environment variables and there is no line for them in .env at all. Any
# reader that only greps the file therefore reports "not set" for a key that is
# set, which is worse than not checking.
#
# env_get above stays file-only on purpose — bootstrap.sh uses it to carry
# values ACROSS a rewrite of .env, where the file's own value is the one that
# matters.
env_first() {
  _k="$1"
  _v="$(printenv "$_k" 2>/dev/null || true)"
  [ -n "$_v" ] && { printf '%s\n' "$_v"; return 0; }
  env_get "$_k" "${2:-}"
}

# --- ports --------------------------------------------------
# Neither ss nor lsof nor netstat exists on the target Alpine box, so read
# /proc/net/tcp directly. Port is hex there; 00000000 = 0.0.0.0.
port_busy() {
  _p="$1"
  _hex="$(printf '%04X' "$_p")"
  { cat /proc/net/tcp /proc/net/tcp6 2>/dev/null || true; } \
    | awk -v h=":$_hex" '$4=="0A" && index($2,h){found=1} END{exit !found}'
}

# Ports the last boot actually used. bootstrap.sh writes them to
# logs/pids/ports, and everything that reports or sweeps a port reads it from
# here — a boot moved to :3002 must not be described as ":3000 down".
linga_ports() { # → "SITE ENGINE SPA"
  _pf="$REPO_ROOT/R_Site/Praser/Python/logs/pids/ports"
  _sp=3000; _ep=9000; _ap=5173
  if [ -f "$_pf" ]; then
    read -r _a _b _c < "$_pf" 2>/dev/null || true
    [ -n "${_a:-}" ] && _sp="$_a"
    [ -n "${_b:-}" ] && _ep="$_b"
    [ -n "${_c:-}" ] && _ap="$_c"
  fi
  printf '%s %s %s\n' "$_sp" "$_ep" "$_ap"
}

# --- misc ---------------------------------------------------
confirm() {
  printf '%s [y/N] ' "$1"
  read -r _a 2>/dev/null || return 1
  case "$_a" in [yY]|[yY][eE][sS]) return 0 ;; *) return 1 ;; esac
}

# --- the shell block (repo-root .bashrc) --------------------
# The repo-root .bashrc is ALIASES: one per command, each shaped like the line
# you would type by hand — go to the script's folder, run the script:
#
#     alias push='cd ~/linga/.bin && ./git.sh'
#
# That is the whole design: the path is written out, not computed, so a line in
# that file means exactly what it says and can be copy-pasted. No $REPO_ROOT
# variable, no dispatch, no installer to source first — and nothing here should
# grow logic that the aliases could just carry.
#
# The work is in the scripts, so every alias is reproducible by typing what it
# says. What the shell needs from its rc file is one line that SOURCES that
# file, and it lives inside markers so installing twice replaces it instead of
# stacking copies — this is that installer, and it is idempotent.
LINGA_RC_SRC="$REPO_ROOT/.bashrc"
LINGA_RC_MARK_A="# >>> linga commands (managed by .bashrc — do not edit) >>>"
LINGA_RC_MARK_B="# <<< linga commands <<<"

# rc_target [rc-file] — which file the block goes in ($LINGA_BASHRC, then ~/.bashrc)
rc_target() {
  _t="${1:-${LINGA_BASHRC:-$HOME/.bashrc}}"
  [ -n "$_t" ] || _t="$HOME/.bashrc"
  case "$_t" in
    /*) printf '%s\n' "$_t" ;;
    *)  printf '%s\n' "$PWD/$_t" ;;
  esac
}

# rc_strip FILE — the file without any managed block (stdout)
rc_strip() {
  _f="$1"
  [ -f "$_f" ] || return 0
  awk -v a="$LINGA_RC_MARK_A" -v b="$LINGA_RC_MARK_B" '
    $0 == a { skip = 1; next }
    $0 == b { skip = 0; next }
    skip != 1 { print }' "$_f"
}

# rc_install [rc-file] — write/refresh the block
rc_install() {
  [ -f "$LINGA_RC_SRC" ] || { warn "no $LINGA_RC_SRC — cannot install the shell commands"; return 1; }
  _f="$(rc_target "${1:-}")"
  _tmp="$_f.linga.$$"
  mkdir -p "$(dirname "$_f")" 2>/dev/null || { warn "cannot create $(dirname "$_f")"; return 1; }
  rc_strip "$_f" > "$_tmp" || { rm -f "$_tmp"; warn "could not read $_f"; return 1; }
  [ -s "$_tmp" ] && printf '\n' >> "$_tmp"
  {
    printf '%s\n' "$LINGA_RC_MARK_A"
    printf '# setup_flow · boot · assets · kill · pull · test · lint — type `commands` for the rest\n'
    printf '[ -f "%s" ] && . "%s"\n' "$LINGA_RC_SRC" "$LINGA_RC_SRC"
    printf '%s\n' "$LINGA_RC_MARK_B"
  } >> "$_tmp"
  # cat > file, not mv: the rc file keeps its inode, owner and mode, and a
  # symlinked ~/.bashrc is written through instead of being replaced.
  if ! cat "$_tmp" > "$_f" 2>/dev/null; then
    rm -f "$_tmp"; warn "could not write $_f"; return 1
  fi
  rm -f "$_tmp"
  ok "shell commands installed → $_f"
  dim "sources: $LINGA_RC_SRC"
  dim "already-open shells: source $_f   (or open a new one)"
}

# rc_uninstall [rc-file] — drop the block, leave the rest of the file alone
rc_uninstall() {
  _f="$(rc_target "${1:-}")"
  [ -f "$_f" ] || { dim "nothing to remove — $_f does not exist"; return 0; }
  grep -qF "$LINGA_RC_MARK_A" "$_f" 2>/dev/null || { dim "no linga block in $_f"; return 0; }
  _tmp="$_f.linga.$$"
  if rc_strip "$_f" > "$_tmp" && cat "$_tmp" > "$_f" 2>/dev/null; then
    rm -f "$_tmp"; ok "block removed from $_f"
  else
    rm -f "$_tmp"; warn "could not rewrite $_f"; return 1
  fi
}

# rc_installed [rc-file] — true when the block is already in place
rc_installed() {
  _f="$(rc_target "${1:-}")"
  [ -f "$_f" ] && grep -qF "$LINGA_RC_MARK_A" "$_f" 2>/dev/null
}

# --- the scripts, by name -----------------------------------
# One variable per script, so nothing has to re-derive a path and nothing can
# disagree about which file owns which stage.
LINGA_SETUP="$BIN_DIR/setup.sh"          # stage 1  deps · python · cloudflared
LINGA_BOOTSTRAP="$BIN_DIR/bootstrap.sh"  # stage 2  .env · dirs · the three webs
LINGA_TUNNEL="$REPO_ROOT/deploy/cloudflare/tunnel/tunnel.sh"   # stage 3  ingress
LINGA_STATUS="$BIN_DIR/status.sh"        # where the three stages stand
LINGA_KILL="$BIN_DIR/kill.sh"            # stage 3 → 2, the whole thing down
LINGA_PULL="$BIN_DIR/pull.sh"            # git pull, then chmod +x .bin
LINGA_WORKER="$BIN_DIR/worker.sh"        # the Cloudflare Worker, deployed and checked
export LINGA_RC_SRC LINGA_SETUP LINGA_BOOTSTRAP LINGA_TUNNEL LINGA_STATUS LINGA_KILL LINGA_PULL LINGA_WORKER
