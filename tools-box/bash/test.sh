#!/bin/sh
# ============================================================
# FILE: .bin/test.sh — one entry point for every check.
#
# Subcommands are plain words, no hyphens, no flags:
#
#   ./.bin/test.sh              the api + edge chain, in dependency order
#   ./.bin/test.sh imports      the boot graph resolves
#   ./.bin/test.sh local        the three webs answer on 127.0.0.1
#   ./.bin/test.sh frontend     the SPA is built and served
#   ./.bin/test.sh api          /api routes answer through the site web
#   ./.bin/test.sh tunnel       cloudflared is up and registered
#   ./.bin/test.sh cloudflareEdge   origin.devnovex.shop through the tunnel
#   ./.bin/test.sh worker       app.devnovex.shop through the worker
#   ./.bin/test.sh guard        the origin rejects unsigned direct hits
#   ./.bin/test.sh logs         tail every log
#
# Run this AFTER bootstrap.sh, as a separate step. It does not check .env:
# nodemon already crashes loudly on a missing COOKIE_SECRET, and a second
# pre-flight would just report the same thing earlier and less accurately.
#
# A leading path to the repo root is accepted and optional:
#   ./.bin/test.sh ../ frontend
#
# POSIX sh — busybox ash clean.
# ============================================================
set -u

# Resolve through a symlink: ./test.sh at the repo root points here, and $0 is
# then the symlink path, whose dirname holds no lib.sh.
_self="$0"
while [ -L "$_self" ]; do
  _link="$(readlink "$_self")"
  case "$_link" in
    /*) _self="$_link" ;;
    *)  _self="$(dirname "$_self")/$_link" ;;
  esac
done
. "$(CDPATH= cd -- "$(dirname -- "$_self")" && pwd)/lib.sh"
cd "$REPO_ROOT" || exit 1

# The site web reads PORT from the environment, and bootstrap.sh records what
# it actually used. Prefer that file over the 3000 default: a boot that landed
# on 3002 (port already busy) otherwise looks like a dead server.
SITE_PORT="${SITE_PORT:-3000}"
_portf="$REPO_ROOT/R_Site/Praser/Python/logs/pids/ports"
if [ -f "$_portf" ]; then
  _p="$(awk 'NR==1{print $1}' "$_portf" 2>/dev/null)"
  [ -n "${_p:-}" ] && SITE_PORT="$_p"
fi
ENGINE_PORT="${ENGINE_PORT:-9000}"
if [ -f "$_portf" ]; then
  _p="$(awk 'NR==1{print $2}' "$_portf" 2>/dev/null)"
  [ -n "${_p:-}" ] && ENGINE_PORT="$_p"
fi
PRASER_PORT="${PRASER_PORT:-5055}"
ORIGIN_HOST="${ORIGIN_HOST:-origin.devnovex.shop}"
APP_HOST="${APP_HOST:-app.devnovex.shop}"
LOGS="$REPO_ROOT/R_Site/Praser/Python/logs"

PASS=0
FAIL=0
SKIP=0

pass() { PASS=$((PASS + 1)); printf '%s  PASS%s  %s\n' "$C_GRN" "$C_RST" "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '%s  FAIL%s  %s\n' "$C_RED" "$C_RST" "$*"; }
skip() { SKIP=$((SKIP + 1)); printf '%s  SKIP%s  %s\n' "$C_YEL" "$C_RST" "$*"; }
head_() { printf '\n%s▸ %s%s\n' "$C_CYN" "$*" "$C_RST"; }

# code <url> [extra curl args] — prints the HTTP status, 000 on no answer.
code() { url="$1"; shift; curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$@" "$url" 2>/dev/null; }
body() { url="$1"; shift; curl -s --max-time 12 "$@" "$url" 2>/dev/null; }

# expect <label> <actual> <wanted...>  — any one of the wanted codes passes.
expect() {
  _label="$1"; _got="$2"; shift 2
  for _w in "$@"; do
    if [ "$_got" = "$_w" ]; then pass "$_label ($_got)"; return 0; fi
  done
  fail "$_label — got $_got, wanted $*"
  return 1
}

# ── imports ─────────────────────────────────────────────────
t_imports() {
  head_ "imports"
  if node .bin/node/check-imports.mjs >/tmp/lt-imports 2>&1; then
    pass "$(tail -1 /tmp/lt-imports | sed 's/^\[imports\] //')"
  else
    fail "unresolved imports:"
    grep '✗' /tmp/lt-imports | head -8 | sed 's/^/        /'
  fi
}

# ── local webs ──────────────────────────────────────────────
t_local() {
  head_ "local webs"
  expect "site :$SITE_PORT /healthz" "$(code "http://127.0.0.1:$SITE_PORT/healthz")" 200
  c="$(code "http://127.0.0.1:$ENGINE_PORT/health")"
  [ "$c" = "000" ] && skip "engine :$ENGINE_PORT not up (only needed when the engine hostname is published)" \
                   || expect "engine :$ENGINE_PORT /health" "$c" 200
  c="$(code "http://127.0.0.1:$PRASER_PORT/health")"
  [ "$c" = "000" ] && skip "praser :$PRASER_PORT not up (pdf/docx parsing unavailable)" \
                   || expect "praser :$PRASER_PORT /health" "$c" 200
}

# ── frontend ────────────────────────────────────────────────
t_frontend() {
  head_ "frontend"
  f="R_Site/Build/spa/frontend/index.html"
  if [ -f "$f" ]; then pass "SPA built ($(wc -c <"$f" | tr -d ' ') bytes)"; else
    fail "$f missing — the site web serves 404 on /"; fi

  c="$(code "http://127.0.0.1:$SITE_PORT/")"
  case "$c" in
    200) pass "site serves / (200)" ;;
    403) pass "site serves / behind the edge guard (403 — expected when EDGE_SECRET is set)" ;;
    000) fail "site not answering on :$SITE_PORT" ;;
    *)   fail "site / returned $c" ;;
  esac

  if [ -f "$f" ]; then
    grep -q '<div id="root"\|<div id="app"' "$f" && pass "SPA mount point present" \
      || skip "no #root/#app in index.html (may be fine)"
  fi
}

# ── api ─────────────────────────────────────────────────────
t_api() {
  head_ "api"
  expect "/csrf-token" "$(code "http://127.0.0.1:$SITE_PORT/csrf-token")" 200 403
  expect "/healthz is guard exempt" "$(code "http://127.0.0.1:$SITE_PORT/healthz")" 200

  h="$(body "http://127.0.0.1:$SITE_PORT/healthz")"
  case "$h" in
    *'"ok":true'*) pass "healthz reports ok" ;;
    "")            fail "healthz returned nothing" ;;
    *)             skip "healthz body: $(printf '%s' "$h" | head -c 100)" ;;
  esac
  printf '        %s\n' "$(printf '%s' "$h" | head -c 200)"
}

# ── tunnel ──────────────────────────────────────────────────
t_tunnel() {
  head_ "tunnel"
  # Precedence matters: `A || B && C` parses as `(A || B) && C`, so the
  # earlier one-liner reported "not running" whenever the pid file was absent
  # even though pgrep had just found the process. Group them explicitly.
  _alive=0
  if pgrep -f 'cloudflared.*tunnel' >/dev/null 2>&1; then
    _alive=1
  elif [ -f "$LOGS/pids/tunnel.pid" ]; then
    kill -0 "$(cat "$LOGS/pids/tunnel.pid" 2>/dev/null)" 2>/dev/null && _alive=1
  fi
  [ "$_alive" -eq 1 ] && pass "cloudflared process alive" \
                      || fail "cloudflared not running — ./deploy/cloudflare/tunnel/tunnel.sh deploy"

  if [ -f "$LOGS/tunnel.log" ]; then
    # Count the LAST run only. The log is appended to across restarts, so a
    # raw grep -c reports every connection ever made (32 after a few boots)
    # rather than the 2-4 this connector currently holds.
    # Count only the connections from the CURRENT connector run: take
    # everything after the last startup banner. The log is appended across
    # restarts, so counting the whole file reports every connection ever made.
    #
    # `grep -c` prints 0 AND exits 1 when there is no match, so `|| echo 0`
    # appended a second zero and produced "0\n0" -> "[: Illegal number".
    # Let grep own the value and normalise with awk instead.
    n="$(awk '/Starting tunnel/{buf=""} {buf=buf $0 "\n"} END{printf "%s", buf}' \
          "$LOGS/tunnel.log" 2>/dev/null |
         grep -c 'Registered tunnel connection')" || n=0
    n="$(printf '%s' "$n" | tr -dc '0-9')"
    [ -n "$n" ] || n=0
    if [ "$n" -gt 0 ]; then
      pass "$n edge connection(s) registered this run"
    else
      fail "no 'Registered tunnel connection' since the last start"
    fi
    if grep -q 'failed to dial to edge' "$LOGS/tunnel.log" 2>/dev/null; then
      fail "tunnel.log has dial failures (UDP/7844 blocked? try TUNNEL_PROTOCOL=http2)"
    fi
  else
    skip "no tunnel.log yet"
  fi
}

# ── cloudflareEdge ──────────────────────────────────────────
t_cloudflareEdge() {
  head_ "cloudflareEdge  ($ORIGIN_HOST)"
  c="$(code "https://$ORIGIN_HOST/healthz")"
  case "$c" in
    200) pass "healthz through the tunnel (200) — tunnel AND origin are up"
         printf '        %s\n' "$(body "https://$ORIGIN_HOST/healthz" | head -c 200)" ;;
    502) fail "502 — tunnel is up but the origin is down or ingress points at the wrong port" ;;
    530|1033) fail "$c — no Public Hostname on this tunnel (add it in Zero Trust → Networks → Tunnels)" ;;
    000) fail "no answer — DNS, or this network cannot reach Cloudflare" ;;
    *)   fail "unexpected $c" ;;
  esac

  # / is NOT guard exempt: a 403 here is the guard doing its job.
  c="$(code "https://$ORIGIN_HOST/")"
  case "$c" in
    403) pass "/ returns 403 — the guard rejects unsigned direct hits (correct)" ;;
    200) fail "/ returns 200 — EDGE_SECRET is not set, the worker can be bypassed" ;;
    502) skip "/ 502 (origin down — fix healthz first)" ;;
    *)   skip "/ returned $c" ;;
  esac
}

# ── worker ──────────────────────────────────────────────────
t_worker() {
  head_ "worker  ($APP_HOST)"
  c="$(code "https://$APP_HOST/healthz")"
  case "$c" in
    200) pass "worker answers /healthz (edge-only, works with the origin down)" ;;
    000) fail "no answer — worker not deployed? ./.bin/worker.sh  (or: cd deploy/cloudflare/worker && npx wrangler deploy --env production)" ;;
    *)   fail "got $c" ;;
  esac

  c="$(code "https://$APP_HOST/__edge/info")"
  [ "$c" = "200" ] && { pass "/__edge/info"; printf '        %s\n' "$(body "https://$APP_HOST/__edge/info" | head -c 220)"; } \
                   || skip "/__edge/info returned $c"

  expect "/ through the worker" "$(code "https://$APP_HOST/")" 200 404
}

# ── guard ───────────────────────────────────────────────────
t_guard() {
  head_ "guard"
  # env_first: the environment wins over .env, which is how a Codespace with
  # repo secrets set sees it (there is no line for it in the file there).
  s="$(env_first EDGE_SECRET)"
  if [ -z "$s" ]; then fail "EDGE_SECRET not set (checked \$EDGE_SECRET and .env) — the guard is disabled"; return; fi
  pass "EDGE_SECRET present (${#s} chars)"

  hdr="$(env_first EDGE_SECRET_HEADER)"; hdr="${hdr:-x-edge-secret}"
  expect "unsigned / is rejected"      "$(code "http://127.0.0.1:$SITE_PORT/")" 403
  expect "signed / is accepted"        "$(code "http://127.0.0.1:$SITE_PORT/" -H "$hdr: $s")" 200 404
  expect "/healthz stays open"         "$(code "http://127.0.0.1:$SITE_PORT/healthz")" 200
}

# ── logs ────────────────────────────────────────────────────
t_logs() {
  head_ "logs"
  for f in site engine spa-build spa tunnel; do
    p="$LOGS/$f.log"
    [ -f "$p" ] || continue
    printf '\n%s── %s ──%s\n' "$C_DIM" "$f" "$C_RST"
    tail -12 "$p" | sed 's/^/    /'
  done
}


# ── dispatch ────────────────────────────────────────────────
cmd="${1:-all}"

case "$cmd" in
  imports)         t_imports ;;
  local)           t_local ;;
  frontend|front)  t_frontend ;;
  api)             t_api ;;
  tunnel)          t_tunnel ;;
  cloudflareEdge|edge) t_cloudflareEdge ;;
  worker)          t_worker ;;
  guard)           t_guard ;;
  logs)            t_logs; exit 0 ;;
  all)
    t_local; t_api; t_frontend; t_tunnel; t_cloudflareEdge
    ;;
  *)
    die "unknown: $cmd  (imports local api frontend tunnel cloudflareEdge worker guard logs all)"
    ;;
esac

printf '\n%s%s passed%s  %s%s failed%s  %s%s skipped%s\n' \
  "$C_GRN" "$PASS" "$C_RST" "$C_RED" "$FAIL" "$C_RST" "$C_YEL" "$SKIP" "$C_RST"
[ "$FAIL" -eq 0 ]
