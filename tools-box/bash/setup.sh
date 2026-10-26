#!/usr/bin/env bash
# FILE: .bin/setup.sh — STAGE 1/3 of the linear flow.
#
#   stage 1 (here)   .bin/setup.sh                install: npm trees, pip, cloudflared
#   stage 2          .bin/bootstrap.sh boot       runtime .env · dirs · the three webs
#   stage 3          deploy/cloudflare/tunnel/tunnel.sh deploy    public ingress
#
# One direction only, and each stage knows which one it is: this script prints
# its own position and the exact command for the next one. Pass `full` (the
# second argument, boolean, false by default) and it does not stop here — it
# carries straight on into stage 2 and stage 3.
#
#   ./.bin/setup.sh          install only          (no alias: `setup` is stage 2's)
#   ./.bin/setup.sh start    install → boot → tunnel (alias: setup_flow)
#   ./.bin/setup.sh full     the same thing — `full` is the flag whenever it is
#                            the second argument: `setup_flow full`
#   ./.bin/setup.sh status   where the three stages stand
#
# Deliberately minimal, and two findings from auditing the repo shape what it
# installs:
#
#   1. The praser declares 12 Python deps in pyproject.toml but imports only
#      TWO of them: flask and fpdf2. docx_extract.py unzips the docx and walks
#      the XML with stdlib zipfile + ElementTree; pdf_extract.py does raw
#      zlib/struct on the PDF. pdfminer.six, python-docx, pyarrow, pillow,
#      thriftpy2, ijson, parquet, fonttools are dead weight — pyarrow and
#      pillow being the two slowest wheels in the set. So: install the two
#      that are actually imported, skip `pip install -e .` entirely.
#
#   2. better-sqlite3 is a root dependency whose native build fails, but it is
#      imported ONLY by scrmgr.js — a standalone tool that bootstrap.sh and
#      both servers never touch. --ignore-scripts skips the native build and
#      still yields a working nodemon, which bootstrap.sh hard-requires.
#
# Every npm tree the flow needs is installed here — root, R_Site, R_Engine,
# R_Site/Build — because stage 2 starts the webs from whatever is already on
# disk (`boot --skip-install`). This file used to install everything except
# R_Engine, which left the engine web dying on MODULE_NOT_FOUND at :9000; the
# devcontainer copy had the fix and this one did not. One stage, one list.
set -eu

# REPO_ROOT and ok/info/warn/die come from .bin/lib.sh. It also exports the
# three stage paths, so nobody has to re-derive "where is stage 2" here.
. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 1

# Words the aliases pass through, and what each means:
#   (nothing) · run    stage 1 only
#   start · full       the whole flow: this stage, then boot, then the tunnel
#   status             hand over to .bin/status.sh
FULL=0
case "${1:-}" in
  ""|run)          FULL=0 ;;
  start|full|true|yes|1) FULL=1 ;;
  status)          exec bash "$LINGA_STATUS" ;;
  -h|--help)
    awk '/^# FILE:/{on=1} /^set -eu/{exit} on {sub(/^# ?/,""); print}' "$0"; exit 0 ;;
  *) die "unknown argument: $1 — expected: [run|start|status|full]" ;;
esac

SETUP_LOG="$(mktemp -t linga-setup.XXXXXX 2>/dev/null || echo /tmp/linga-setup.log)"
trap 'rm -f "$SETUP_LOG"' EXIT

say()  { printf '%s▸%s %s\n' "$C_BLU" "$C_RST" "$*"; }
C_BLU="$(printf '\033[34m')"; C_BLD="$(printf '\033[1m')"
[ -t 1 ] || { C_BLU=""; C_BLD=""; }

info "${C_BLD}1/3 setup${C_RST}  ${C_DIM}$(pwd)${C_RST}  ${C_DIM}deps · python · cloudflared${C_RST}"
[ "$FULL" -eq 1 ] && info "full: when this finishes, stages 2/3 (boot) and 3/3 (tunnel) run too" || true

# npm_install DIR LABEL [extra npm flags…]
# Retries once with --ignore-scripts: native postinstall steps (better-sqlite3,
# sass-embedded) download node headers, and an offline or restricted sandbox
# cannot. The pure-JS deps still land, which is everything the webs need.
#
# --no-package-lock: this repo does not track lockfiles — the restructure
# deleted them and .gitignore now says so — and an install that quietly writes
# three of them back would hand `./.bin/git.sh` (which stages everything) a
# package-lock.json to commit. There is nothing to read here either, so
# ignoring the lockfile changes no resolved version.
npm_install() {
  local dir="$1" label="$2"
  shift 2
  say "npm install — $label  ${C_DIM}($dir)${C_RST}"
  if npm install "$@" --no-package-lock --no-audit --no-fund --prefix "$dir" > "$SETUP_LOG" 2>&1; then
    ok "$label"
    return 0
  fi
  case " $* " in
    *" --ignore-scripts "*)
      tail -12 "$SETUP_LOG" >&2
      die "$label: npm install failed in $dir/"
      ;;
  esac
  warn "$label: npm install failed — retrying with --ignore-scripts (native modules skipped)"
  if npm install "$@" --ignore-scripts --no-package-lock --no-audit --no-fund --prefix "$dir" > "$SETUP_LOG" 2>&1; then
    warn "$label: installed WITHOUT postinstall scripts (better-sqlite3/sass stay unusable until they can build)"
  else
    tail -12 "$SETUP_LOG" >&2
    die "$label: npm install failed in $dir/"
  fi
}

# ── 1. node trees ──────────────────────────────────────────────────────────
# Root: nodemon lives here and bootstrap.sh dies without it. --ignore-scripts
# avoids the better-sqlite3 node-gyp failure, which is why it is not left to
# the retry above.
npm_install "." "root toolchain (nodemon, eslint)" --ignore-scripts

# The site's own dependency tree (express, multer, mysql2, …).
npm_install "R_Site" "site web deps"

# The engine's tree. bytenode is declared here and map-loader.js requires it at
# import time, so without this install :9000 never comes up.
if [ -f R_Engine/package.json ]; then
  npm_install "R_Engine" "engine web deps"
fi

# The SPA build toolchain. bootstrap.sh needs vite here or it cannot build the
# SPA, and the site serves a 404 at /.
if [ -f R_Site/Build/package.json ]; then
  npm_install "R_Site/Build" "build web (vite)"
fi

# ── 2. python ──────────────────────────────────────────────────────────────
# Only the two packages the praser actually imports.
say "pip install — flask fpdf2"
if pip install --no-cache-dir --disable-pip-version-check flask fpdf2 > "$SETUP_LOG" 2>&1; then
  ok "python deps (flask, fpdf2)"
elif grep -q "externally-managed-environment" "$SETUP_LOG" 2>/dev/null; then
  # Debian/Ubuntu ship PEP 668 "externally managed" pythons: pip refuses to
  # touch the system site-packages, which is the right default everywhere
  # except a disposable container that exists to run this repo. Ask again,
  # explicitly, and say why — this is the one place the flag is justified.
  warn "pip refused (PEP 668, externally managed python) — retrying with --break-system-packages"
  if pip install --break-system-packages --no-cache-dir --disable-pip-version-check flask fpdf2 > "$SETUP_LOG" 2>&1; then
    ok "python deps (flask, fpdf2)"
  else
    tail -12 "$SETUP_LOG" >&2
    warn "pip install failed — the praser's python will not start"
  fi
else
  tail -12 "$SETUP_LOG" >&2
  warn "pip install failed — the praser's python will not start"
fi

# ── 3. cloudflared ─────────────────────────────────────────────────────────
# The whole reason for using a Codespace. Static binary, no apt repo needed.
# Codespaces is amd64; arm64 handled for completeness. Stage 3 refuses to run
# without it, so this is the one download that is worth doing before stage 3.
if command -v cloudflared >/dev/null 2>&1; then
  ok "cloudflared already installed  ${C_DIM}$(cloudflared --version 2>&1 | head -1)${C_RST}"
else
  cf_arch=""
  case "$(uname -m)" in
    x86_64|amd64)  cf_arch=amd64 ;;
    aarch64|arm64) cf_arch=arm64 ;;
  esac
  if [ -n "$cf_arch" ]; then
    say "installing cloudflared ($cf_arch)"
    if curl -fsSL -o /tmp/cloudflared \
      "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}" 2>/dev/null; then
      chmod +x /tmp/cloudflared
      if sudo mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null; then :
      else mkdir -p "$HOME/.local/bin"; mv /tmp/cloudflared "$HOME/.local/bin/cloudflared"; fi
      ok "cloudflared → $(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
    else
      warn "cloudflared download failed — install it by hand before stage 3"
      warn "  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    fi
  else
    warn "unsupported arch $(uname -m) — install cloudflared by hand before stage 3"
  fi
fi

# ── 4. the command surface ─────────────────────────────────────────────────
# The repo-root .bashrc (the aliases themselves — boot · kill · assets · pull ·
# test · lint …) made reachable from ~/.bashrc by one sourced line inside a
# managed block. Idempotent: it replaces its own block and never touches the
# rest of the file. The aliases live in the repo, not in this installer.
if rc_install; then :; else warn "the shell commands could not be installed (flow still runnable script by script)"; fi

# ── hand-off ───────────────────────────────────────────────────────────────
echo
ok "1/3 setup complete — $(uname -s) $(uname -m)"
command -v node        >/dev/null 2>&1 && printf '    %s\n' "node        $(node -v)"
command -v python3     >/dev/null 2>&1 && printf '    %s\n' "python      $(python3 -V 2>&1 | cut -d' ' -f2)"
command -v cloudflared >/dev/null 2>&1 && printf '    %s\n' "cloudflared $(cloudflared --version 2>&1 | head -1 | awk '{print $3}')"
echo

if [ "$FULL" -eq 1 ]; then
  echo
  info "${C_BLD}full${C_RST} → 2/3 boot, then 3/3 tunnel (bootstrap.sh boot --detach full)"
  # bootstrap.sh `full` is the chain past its own stage: it boots the webs and
  # then hands off to tunnel.sh deploy. --skip-install because stage 1 just
  # installed every tree.
  #
  # A failure here is stage 2's, and it must not look like setup's: the tree is
  # fine, one of the webs is not. Stage 3 is skipped rather than attempted,
  # because a tunnel with no origin behind it is a 502 with extra steps.
  if bash "$LINGA_BOOTSTRAP" boot --detach --skip-install full; then
    echo
    ok "flow up — 1/3 setup · 2/3 webs · 3/3 tunnel"
    printf '    %s\n' "state:  setup status   ·   stop it:  kill   ·   again from scratch: setup_flow full"
  else
    echo
    die "stage 2 (boot) did not finish, so stage 3 (tunnel) was not started — the reason is in the log tail above"
  fi
else
  printf '%s\n' "${C_BLD}next${C_RST}"
  printf '    %s\n' "2/3 boot      ./.bin/bootstrap.sh boot --detach            the three webs"
  printf '    %s\n' "3/3 tunnel    ./deploy/cloudflare/tunnel/tunnel.sh deploy   public ingress"
  printf '    %s\n' "all three     ./.bin/setup.sh start      (alias: setup_flow)"
  printf '    %s\n' "stop it       ./.bin/kill.sh             (alias: kill)"
  printf '%s\n' "${C_DIM}    aliases land in new shells; source ~/.bashrc once to get them here${C_RST}"
fi
