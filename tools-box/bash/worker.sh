#!/usr/bin/env bash
# FILE: .bin/worker.sh — the Cloudflare Worker, from npm install to a live check.
#
#   ./.bin/worker.sh          what the Worker needs, deploy, verify
#   ./.bin/worker.sh full     the same, forced: reinstall, re-put the secret
#   ./.bin/worker.sh tail     live logs from the DEPLOYED worker (alias: logs)
#
# The whole sequence in the order it has to happen:
#
#   npm install
#   npx wrangler login                        (skipped with CLOUDFLARE_API_TOKEN)
#   npx wrangler secret put EDGE_SECRET --env production
#   npx wrangler deploy --env production
#   ./.bin/test.sh worker                     (back at the repo root)
#
# This is NOT one of the three stages. The stages bring up the machine behind
# the door (setup · boot · tunnel); this publishes the door itself, and it is
# done once per Worker change, not once per boot. That is why `setup_flow`
# does not call it.
#
# THE `--env production` PART IS NOT COSMETIC. `wrangler deploy --env
# production` publishes the Worker named in wrangler.jsonc's env.production —
# i.e. `<name>-production` — and that is the one the custom domain
# (app.devnovex.shop) points at. A secret put WITHOUT `--env production` lands
# on the top-level Worker instead, so the deployed one has no EDGE_SECRET, does
# not sign the requests it forwards, and the origin guard answers 403 to
# everything (or, with no secret at the origin either, the guard is simply off).
# This script always addresses the same environment it deploys, and then reads
# /__edge/info to prove the secret is really there.
set -uo pipefail

. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 1

WORKER_DIR="$REPO_ROOT/deploy/cloudflare/worker"
CONFIG="$WORKER_DIR/wrangler.jsonc"
PROD_ENV="production"
APP_HOST="${APP_HOST:-app.devnovex.shop}"

ACTION="deploy"
# Initialised before the parse: `set -u` is on, and the tail branch never
# reaches an assignment.
FULL=0
case "${1:-}" in
  "")              FULL=0 ;;
  full|true|yes|1) FULL=1 ;;
  # `tail` is here rather than in the docs because the obvious command is
  # wrong: `wrangler tail` with no --env follows the TOP-LEVEL worker
  # (linga-edge), which nothing routes to, so it sits there showing nothing
  # while the live traffic goes to linga-edge-production.
  tail|logs)       ACTION="tail" ;;
  -h|--help)
    awk '/^# FILE:/{on=1} /^set -u/{exit} on {sub(/^# ?/,""); print}' "$0"
    exit 0 ;;
  *) die "unknown argument: $1 — expected: [full|tail]" ;;
esac

command -v node >/dev/null 2>&1 || die "node is not on PATH"
[ -d "$WORKER_DIR" ] || die "no worker at $(rel "$WORKER_DIR")"
[ -f "$CONFIG" ] || die "no $(rel "$CONFIG") — wrangler needs it to know where this deploys"

# The Worker's own name, for the messages. wrangler.jsonc wins over
# package.json's "name" (that one is just npm's), so read it from there.
WORKER_NAME="$(grep -m1 -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' "$CONFIG" | cut -d'"' -f4)"
[ -n "$WORKER_NAME" ] || WORKER_NAME="(unnamed)"

info "${C_GRN}cloudflare worker${C_RST} — $WORKER_NAME → https://$APP_HOST  ${C_DIM}(env: $PROD_ENV)${C_RST}"
[ "$FULL" -eq 1 ] && dim "full: reinstall · re-login · re-put the secret · redeploy" || true

# ── 1. npm install ─────────────────────────────────────────────────────────
WRANGLER="$WORKER_DIR/node_modules/.bin/wrangler"
if [ "$FULL" -eq 0 ] && [ -x "$WRANGLER" ]; then
  ok "worker deps present  ${C_DIM}$(rel "$WORKER_DIR")/node_modules${C_RST}"
else
  info "npm install  ${C_DIM}($(rel "$WORKER_DIR"))${C_RST}"
  # --no-package-lock: this repo tracks no lockfiles (an install must not hand
  # `git add -A` a new one), and wrangler is the only dependency anyway.
  ( cd "$WORKER_DIR" && npm install --no-package-lock --no-audit --no-fund ) \
    || die "npm install failed in $(rel "$WORKER_DIR")"
  ok "worker deps installed"
fi
[ -x "$WRANGLER" ] && WRANGLER_CMD=("$WRANGLER") || WRANGLER_CMD=(npx wrangler)

wrangler() { ( cd "$WORKER_DIR" && "${WRANGLER_CMD[@]}" "$@" ); }

if [ "$ACTION" = "tail" ]; then
  [ -x "$WRANGLER" ] || dim "no local wrangler — using npx (slower to start)"
  info "wrangler tail --env $PROD_ENV  ${C_DIM}live logs from $WORKER_NAME-$PROD_ENV${C_RST}"
  dim "the top-level worker ($WORKER_NAME) is not what serves https://$APP_HOST — hence --env"
  cd "$WORKER_DIR" || exit 1
  exec "${WRANGLER_CMD[@]}" tail --env "$PROD_ENV"
fi

# ── 2. auth ────────────────────────────────────────────────────────────────
# Three ways in, cheapest first: an API token (no browser, what CI and a
# Codespace want), an existing OAuth login, and only then the interactive
# login. `wrangler whoami` is the honest test — it makes a real API call.
AUTH=""
WHOAMI=""
# `wrangler whoami` EXITS 0 WHEN IT IS NOT AUTHENTICATED — it prints "You are
# not authenticated. Please run `wrangler login`." and returns success. (Read
# off wrangler 4.131.2; the same trap in any "who am I" command that answers
# rather than fails.) So the exit status is worthless here and the TEXT is what
# has to be read: negative first, then positive, and anything else counts as
# not authenticated — guessing the other way means skipping the login and
# failing later at `secret put` with an error that names the wrong thing.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  AUTH="token"
  ok "auth: CLOUDFLARE_API_TOKEN from the environment  ${C_DIM}(no login needed)${C_RST}"
elif WHOAMI="$(wrangler whoami 2>&1)" \
     && ! printf '%s' "$WHOAMI" | grep -qi 'not authenticated' \
     && printf '%s' "$WHOAMI" | grep -qiE 'logged in|oauth token|account id'; then
  AUTH="oauth"
  ok "auth: already logged in  ${C_DIM}($(printf '%s' "$WHOAMI" | grep -m1 -oE '[^[:space:]]+@[^[:space:]]+' || echo 'wrangler login')${C_RST})"
  # `full` re-installs and re-puts the secret; it does NOT throw away a working
  # login. Re-authenticating is a deliberate act, and forcing it here would
  # break the flag in every non-interactive shell.
  [ "$FULL" -eq 1 ] && dim "full keeps this login — npx wrangler logout first to re-authenticate" || true
else
  [ -t 0 ] || die "no CLOUDFLARE_API_TOKEN and no interactive stdin — export one, or run this in a terminal"
  warn "not logged in — wrangler will print a URL; open it and paste the code back"
  dim  "a Codespace has no browser: the 'Failed to open a browser automatically' warning is expected"
  wrangler login || die "wrangler login failed"
  AUTH="oauth"
  ok "auth: logged in"
fi

# ── 3. the origin guard's secret ───────────────────────────────────────────
# env_first: the environment wins over .env, same precedence as every other
# reader in this repo (see deploy/cloudflare/SECRETS.md).
SECRET="$(env_first EDGE_SECRET || true)"
HAVE_REMOTE=0
wrangler secret list --env "$PROD_ENV" 2>/dev/null | grep -q 'EDGE_SECRET' && HAVE_REMOTE=1

if [ -z "$SECRET" ] && [ "$HAVE_REMOTE" -eq 0 ]; then
  warn "no EDGE_SECRET anywhere — \$EDGE_SECRET and $REPO_ROOT/.env are both empty"
  dim  "generate one:  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n'"
  dim  "then:          EDGE_SECRET=<value> ./.bin/worker.sh    (or paste it at the prompt below)"
  run_wrangler_secret() { wrangler secret put EDGE_SECRET --env "$PROD_ENV"; }
elif [ -n "$SECRET" ] && { [ "$HAVE_REMOTE" -eq 0 ] || [ "$FULL" -eq 1 ]; }; then
  info "wrangler secret put EDGE_SECRET --env $PROD_ENV  ${C_DIM}(${#SECRET} chars, from ${SECRET_SRC:-$REPO_ROOT/.env})${C_RST}"
  # Piped, never an argument: argv is world-readable in /proc on Linux.
  run_wrangler_secret() { printf '%s' "$SECRET" | wrangler secret put EDGE_SECRET --env "$PROD_ENV"; }
else
  ok "EDGE_SECRET already on $WORKER_NAME-$PROD_ENV — left alone  ${C_DIM}(full re-puts it)${C_RST}"
  run_wrangler_secret() { return 0; }
fi
run_wrangler_secret || die "could not set EDGE_SECRET on the $PROD_ENV environment"

# ── 4. deploy ──────────────────────────────────────────────────────────────
info "wrangler deploy --env $PROD_ENV"
wrangler deploy --env "$PROD_ENV" || die "wrangler deploy failed — nothing changed at the edge"
ok "deployed $WORKER_NAME-$PROD_ENV"

# ── 5. verify ──────────────────────────────────────────────────────────────
# /__edge/info reports whether the worker can SEE its secret — the one thing
# that cannot be checked by looking at a file, and the exact failure a secret
# put on the wrong environment produces.
if command -v curl >/dev/null 2>&1; then
  _info="$(curl -s -m 15 "https://$APP_HOST/__edge/info" 2>/dev/null)"
  case "$_info" in
    *'"edgeSecretConfigured":true'*)
      ok "$APP_HOST/__edge/info — edgeSecretConfigured: true"
      ;;
    *'"edgeSecretConfigured":false'*)
      warn "$APP_HOST/__edge/info — edgeSecretConfigured: FALSE"
      dim  "the deployed worker cannot see EDGE_SECRET; check: cd $(rel "$WORKER_DIR") && npx wrangler secret list --env $PROD_ENV"
      ;;
    "")
      warn "no answer from https://$APP_HOST/__edge/info — DNS or the deploy is still propagating"
      ;;
    *)
      dim  "unexpected /__edge/info body: $(printf '%s' "$_info" | head -c 160)"
      ;;
  esac
fi

# The same check the request that follows the deploy in the release notes, run
# from the repo root: the worker answers at the edge even when the origin is
# down, so a failure here names the hop.
echo
info "the edge chain  ${C_DIM}./.bin/test.sh worker${C_RST}"
if bash "$BIN_DIR/test.sh" worker; then
  ok "worker flow complete — $WORKER_NAME-$PROD_ENV live on https://$APP_HOST"
  dim "tail the live logs: ./.bin/worker.sh tail   (wrangler tail --env $PROD_ENV)"
else
  warn "deploy succeeded; the edge checks above are what failed"
  dim  "the worker answers /healthz on its own — a failure on / is the chain BEHIND it:"
  dim  "  ./.bin/setup.sh start   (or: boot / tunnel.sh deploy), then ./.bin/test.sh worker again"
  exit 1
fi
