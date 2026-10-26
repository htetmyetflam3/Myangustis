#!/usr/bin/env bash
# FILE: bootstrap.sh
# ── linga: setup + three webs + the automated test flow, in one command ───
#
# THE THREE WEBS (each is a server of its own, each gets its own watcher):
#   site    R_Site/index.js                     Express     :3000  nodemon.json
#   engine  R_Engine/init/api-server.js         FSMGR api   :9000  R_Engine/nodemon.json
#   build   R_Site/Build/spa (vite)             SPA builder frontend/  (:5173 with --spa-dev)
#
# WHY EVERY WEB IS STARTED FROM THE REPO ROOT
# Both path maps — R_Site/_file/paths.js and R_Engine/Bridge/path.js — hold
# RELATIVE constants and resolve them against process.cwd(). Start a web from
# its own folder and the paths double up: vite's root becomes
# R_Site/Build/R_Site/Build/spa and the SPA answers 404 while the dev server
# cheerfully reports "ready". Same for the static dir, the logs, every upload
# dir. So: cd here once, and let each nodemon config's "exec" carry the entry.
#
# WHY THE SPA IS BUILT RATHER THAN DEV-SERVED BY DEFAULT
# The SPA calls a relative API_BASE="/api" and R_Site/Build/spa/vite.config.js
# defines no dev proxy, so on :5173 those calls hit vite and die. The built
# copy in R_Site/Build/spa/frontend is what the site web serves — same origin,
# whole chain working. So the BUILD WEB is a supervised `vite build --watch`:
# it produces frontend/ and keeps it current, and SKIP_BUILD=true stays in
# nodemon.json so a backend edit restarts the server instead of re-running
# vite on every save. --no-build only skips the BLOCKING first build; the
# watcher still builds, so a skipped frontend build never leaves the site web
# with nothing to serve. Use --spa-dev to swap the watcher for vite's dev
# server (HMR on --spa-port, but no /api — see above).
#
# STAGE 2/3 OF THE LINEAR FLOW
#
#   stage 1   .bin/setup.sh                  deps · python · cloudflared
#   stage 2   .bin/bootstrap.sh boot         runtime .env · dirs · the three webs   ← this file
#   stage 3   deploy/cloudflare/tunnel/tunnel.sh deploy    public ingress
#
# The stages only ever run in that order, and this one says which it is and
# what comes next. `full` — a boolean word, the second argument, false by
# default — is how it carries on by itself: after the webs pass their health
# gate it hands off to stage 3 (tunnel.sh deploy) and returns. That implies
# --detach, because a foreground log stream can never reach a hand-off.
#
# Usage: ./.bin/bootstrap.sh [command] [options] [full]
#
# Commands
#   setup      install all three webs, create the runtime dirs, build the SPA
#   boot       boot the three webs under nodemon and stream their logs  [default]
#   build      the frontend asset web ON ITS OWN — no site, no engine, no tunnel
#                build start   start `vite build --watch` (detached)   [default action]
#                build once    one blocking build, no watcher
#                build stop    stop the watcher
#                build status  is it watching, and when was frontend/ last written
#                build logs    tail the build log (Ctrl-C stops the tail, not the build)
#   test       setup → boot → health gate → test flow → stop (exit code = verdict)
#   dev        setup → boot → run the test flow once → watch tests with nodemon
#   stop       stop webs started by this script
#   status     show what is listening on each port (with `full`: the tunnel too)
#   clean      stop webs, then drop the built SPA + the runtime scratch dirs
#
# The flag
#   full       after the webs are healthy, run the rest of the flow: stage 3,
#              `tunnel.sh deploy`. Implies --detach. Boolean; false by default.
#
# Options
#   --site-port N     site web port      (default 3000)
#   --engine-port N   engine web port    (default 9000)
#   --spa-port N      vite dev port      (default 5173)
#   --skip-install    trust the existing node_modules
#   --no-check        boot even when the import graph has a broken specifier;
#                     only the web owning that import fails, the rest start
#   --no-build        skip the blocking first build (the build web still builds)
#   --no-spa-watch    do not run `vite build --watch` as the build web; boot then
#                     refuses to come up if R_Site/Build/spa/frontend is missing
#   --spa-dev         also boot vite dev on --spa-port (HMR; no /api — see above)
#   --no-live         test flow without probing the live webs (offline only)
#   --strict          test flow also fails on unresolved imports in orphan modules
#   --detach          leave the webs running after this script exits
#   --reinstall       npm install even where node_modules already exists
#
# Notes
#   • nodemon only fills its config "env" for keys the shell has NOT set, so
#     `SKIP_BUILD=false ./.bin/bootstrap.sh boot` still wins over nodemon.json.
#   • Logs go to the site path map's own LOGS_DIR (R_Site/Praser/Python/logs),
#     pids beside them in logs/pids/ — both live under the gitignored logs dir.
#   • The webs run in their own session, so Ctrl-C here stops them via the
#     trap rather than by killing a process group this script does not own.
set -uo pipefail

# ── positions ──────────────────────────────────────────────────────────────
# REPO_ROOT comes from .bin/lib.sh, which finds it by searching upward for
# package.json rather than counting "../" hops. This script lives in .bin/,
# so the old "REPO_ROOT=$SCRIPT_DIR" resolved to .bin/ itself and every
# relative path below it was wrong.
. "$(dirname "$0")/lib.sh"
SCRIPT_DIR="$BIN_DIR"
cd "$REPO_ROOT" || exit 1

SITE_DIR="R_Site"
ENGINE_DIR="R_Engine"
BUILD_DIR="R_Site/Build"
TEST_DIR=".bin/node"
LOGS_DIR="$SITE_DIR/Praser/Python/logs"
PID_DIR="$LOGS_DIR/pids"
SITE_LOG="$LOGS_DIR/site.log"
ENGINE_LOG="$LOGS_DIR/engine.log"
SPA_LOG="$LOGS_DIR/spa.log"
SPA_BUILD_LOG="$LOGS_DIR/spa-build.log"

# ── knobs ──────────────────────────────────────────────────────────────────
# Exported because the webs read their own port from PORT (both index.js and
# api-server.js), and the live probe reads SITE_PORT/ENGINE_PORT/SPA_PORT —
# they must all agree, so the ports are decided here and passed down once.
export SITE_PORT="${SITE_PORT:-${PORT:-3000}}"
export ENGINE_PORT="${ENGINE_PORT:-9000}"
export SPA_PORT="${SPA_PORT:-5173}"
CMD="boot"
SKIP_INSTALL=0
SKIP_BUILD=0
SKIP_CHECK=0
SPA_DEV=0
# The build web runs `vite build --watch` by default: a frontend that is never
# built is a site web with no UI, so the build is supervised rather than
# optional. --no-spa-watch turns it off for the times you really do not want
# vite running at all (boot then refuses if the build output is missing).
SPA_WATCH=1
LIVE=1
STRICT=0
DETACH=0
REINSTALL=0
# `bootstrap.sh build <action>` — the asset web, alone. Anything else uses the
# command above it.
BUILD_CMD="start"
# The bare `full` word: stage 2 does not end the run, stage 3 does. Implies
# --detach, because a hand-off cannot happen behind a foreground log stream.
CHAIN=0
TAILERS=""

NODE_BIN="${NODE_BIN:-node}"
NPM_BIN="${NPM_BIN:-npm}"
# nodemon is a ROOT devDependency (one install, three configs); vite belongs to
# the build web, so it is addressed there rather than assumed to be hoisted.
NODEMON="./node_modules/.bin/nodemon"
VITE_BIN="$BUILD_DIR/node_modules/.bin/vite"

# ── output ─────────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_DIM=$'\033[2m'; C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YLW=$'\033[33m'
  C_BLU=$'\033[34m'; C_MAG=$'\033[35m'; C_BLD=$'\033[1m'; C_RST=$'\033[0m'
else
  C_DIM=""; C_RED=""; C_GRN=""; C_YLW=""; C_BLU=""; C_MAG=""; C_BLD=""; C_RST=""
fi
say()  { printf '%s\n' "${C_BLU}▸${C_RST} $*"; }
ok()   { printf '%s\n' "${C_GRN}✓${C_RST} $*"; }
warn() { printf '%s\n' "${C_YLW}!${C_RST} $*" >&2; }
die()  { printf '%s\n' "${C_RED}✗${C_RST} $*" >&2; exit 1; }
hint() { printf '%s\n' "  ${C_DIM}$*${C_RST}"; }
rel()  { printf '%s\n' "${1#"$REPO_ROOT"/}"; }

# ── args ───────────────────────────────────────────────────────────────────
need_val() { [ "$#" -ge 2 ] || die "${1} needs a value"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    # `build` takes an action word of its own, so it is matched before the
    # command list: `build stop` must not be read as the top-level `stop`.
    build)          CMD="build" ;;
    start|once|logs|log)
                    [ "${CMD:-}" = build ] || die "unknown argument: $1  (try: ./.bin/bootstrap.sh --help)"; BUILD_CMD="$1" ;;
    # `stop`/`status` are commands AND build actions — the command they follow
    # decides which one they are.
    stop|status)    if [ "${CMD:-}" = build ]; then BUILD_CMD="$1"; else CMD="$1"; fi ;;
    setup|boot|test|dev|clean) CMD="$1" ;;
    # the boolean flag: false by default, and the only bare word that is not a
    # command or a value
    full)           CHAIN=1 ;;
    --site-port)    need_val "$1" "$#"; SITE_PORT="$2"; shift ;;
    --engine-port)  need_val "$1" "$#"; ENGINE_PORT="$2"; shift ;;
    --spa-port)     need_val "$1" "$#"; SPA_PORT="$2"; shift ;;
    --skip-install) SKIP_INSTALL=1 ;;
    --no-check)     SKIP_CHECK=1 ;;
    --no-build)     SKIP_BUILD=1 ;;
    --no-spa-watch) SPA_WATCH=0 ;;
    --spa-dev)      SPA_DEV=1 ;;
    --no-live)      LIVE=0 ;;
    --strict)       STRICT=1 ;;
    --detach)       DETACH=1 ;;
    --reinstall)    REINSTALL=1 ;;
    # print the header block: every '#' line from the FILE: marker down to set -
    -h|--help)      awk '/^# FILE:/{on=1} /^set -/{exit} on {sub(/^# ?/,""); print}' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)              die "unknown argument: $1  (try: ./.bin/bootstrap.sh --help)" ;;
  esac
  shift
done

# `full` is honored where a hand-off makes sense. `test` and `dev` stop the
# webs when they finish, so chaining stage 3 onto them would publish a tunnel
# to a machine that is about to go quiet — say so instead of doing it.
if [ "$CHAIN" -eq 1 ]; then
  case "$CMD" in
    boot|setup) DETACH=1 ;;
    test|dev)
      warn "full is ignored for '$CMD': that flow stops the webs at the end"
      CHAIN=0
      ;;
  esac
fi

# ── helpers ────────────────────────────────────────────────────────────────
port_listeners() { # port → matching `ss` lines ("" if ss is unavailable)
  command -v ss >/dev/null 2>&1 || return 0
  ss -ltnp 2>/dev/null | awk -v p=":$1" 'index($4, p) { print }'
}
port_busy() { [ -n "$(port_listeners "$1")" ]; }

wait_for() { # url label timeout_secs [body_must_contain]
  # Accepts on HTTP 200 (+ the body check when asked). Two things this buys:
  # a listener that answers 500/404 is NOT "up" (a body-only check would call
  # an error page ready), and the per-try budget is generous because vite's
  # FIRST request compiles the SCSS entry and can take several seconds — a
  # 3s curl timeout turned a healthy dev server into a failed health gate.
  #
  # one assignment per line on purpose: `local a=1 b=$((a*2))` expands $a
  # BEFORE the builtin runs, so b never sees a (and set -u calls it unbound).
  local url="$1"
  local label="$2"
  local secs="${3:-60}"
  local want="${4:-}"
  local tries=$(( ${secs%%.*} * 2 ))
  local body="$LOGS_DIR/.health-probe"
  local i code
  [ "$tries" -gt 0 ] || tries=2
  for i in $(seq 1 "$tries"); do
    code="$(curl -s -m 10 -o "$body" -w '%{http_code}' "$url" 2>/dev/null)"
    if [ "$code" = "200" ] && { [ -z "$want" ] || grep -q -- "$want" "$body" 2>/dev/null; }; then
      rm -f "$body"
      ok "$label  ${C_DIM}$url${C_RST}"
      return 0
    fi
    sleep 0.5
  done
  rm -f "$body"
  warn "$label did not answer 200 within ${secs}s  ${C_DIM}$url (last: HTTP ${code:-none})${C_RST}"
  return 1
}

follow_log() { # file label color — keeps three interleaved webs readable
  local file="$1" label="$2" color="$3"
  [ -f "$file" ] || : > "$file"
  # -n +1 so the file is shown from its first line, then followed live.
  ( tail -n +1 -F "$file" 2>/dev/null | sed -u "s|^|${color}${label}${C_RST} |" ) &
  TAILERS="$TAILERS $!"
}

wait_for_file() { # path label [secs] — a file, for the webs with no port
  local path="$1"
  local label="$2"
  local secs="${3:-90}"
  local tries=$((secs * 2)) # 0.5s apart
  local i
  for i in $(seq 1 "$tries"); do
    if [ -s "$path" ]; then
      ok "$label  ${C_DIM}$(rel "$path")${C_RST}"
      return 0
    fi
    sleep 0.5
  done
  warn "$label did not appear within ${secs}s  ${C_DIM}$path${C_RST}"
  return 1
}

start_web() { # name command log_file — new session, so it outlives this shell
  local name="$1" cmd="$2" log="$3" pid
  mkdir -p "$PID_DIR"
  : > "$log"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "cd '$REPO_ROOT' && exec $cmd" > "$log" 2>&1 < /dev/null &
  else
    bash -c "cd '$REPO_ROOT' && exec $cmd" > "$log" 2>&1 < /dev/null &
  fi
  pid=$!
  echo "$pid" > "$PID_DIR/$name.pid"
  say "$name → ${C_DIM}$(rel "$log")${C_RST} ${C_DIM}(pid $pid)${C_RST}"
}

stop_web() { # name — TERM its session, then KILL whatever ignored it
  local name="$1" pid
  pid="$(cat "$PID_DIR/$name.pid" 2>/dev/null)" || return 0
  [ -n "${pid:-}" ] || return 0
  if kill -0 "$pid" 2>/dev/null; then
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null
    local i
    for i in 1 2 3 4 5 6 7 8 9 10; do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.2
    done
    kill -0 "$pid" 2>/dev/null && { kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null; }
  fi
  rm -f "$PID_DIR/$name.pid"
}

stop_all() {
  local n
  # testwatch first: the watcher would otherwise spawn one more suite run
  # while the webs are going down.
  for n in testwatch site engine spa-build spa; do stop_web "$n"; done
  [ -n "$TAILERS" ] && { kill $TAILERS 2>/dev/null; TAILERS=""; }
  return 0
}

install_web() { # dir label
  local dir="$1" label="$2"
  [ -f "$dir/package.json" ] || { warn "$label: no $dir/package.json — skipped"; return 0; }
  if [ -d "$dir/node_modules" ] && [ "$REINSTALL" -eq 0 ]; then
    ok "$label deps present  ${C_DIM}$dir/node_modules${C_RST}"
    return 0
  fi
  say "installing $label  ${C_DIM}($dir/)${C_RST}"
  if (cd "$dir" && "$NPM_BIN" install --no-audit --no-fund >/dev/null 2>&1); then
    ok "$label deps installed"
    return 0
  fi
  # Native postinstall steps (better-sqlite3, sass-embedded) download node
  # headers; an offline or restricted sandbox cannot. The pure-JS deps still
  # land, which is everything the webs need to boot — so retry and be exact
  # about what was given up on rather than failing the whole bootstrap.
  warn "$label: install failed — retrying with --ignore-scripts (native modules skipped)"
  if (cd "$dir" && "$NPM_BIN" install --ignore-scripts --no-audit --no-fund >/dev/null 2>&1); then
    warn "$label: installed WITHOUT postinstall scripts — better-sqlite3/sass stay unusable until they can build"
  else
    (cd "$dir" && "$NPM_BIN" install --ignore-scripts --no-audit --no-fund 2>&1 | tail -12 >&2)
    die "$label: npm install failed in $dir/"
  fi
}

# ── setup ──────────────────────────────────────────────────────────────────
# ── .env ───────────────────────────────────────────────────────────────────
# Three groups, handled differently:
#
#   autogenerate  secrets — filled with fresh random hex on first run. There is
#                 no reason for a human to invent these, and COOKIE_SECRET /
#                 SESSION_SECRET under 32 chars make codec.js throw at import
#                 time, so the site web dies before it binds a port.
#   empty         credentials only the owner knows (the database). Left blank.
#   default       operational settings with a working value prefilled.
#
# Never overwrites an existing .env, and never touches a key that already has a
# value — safe to re-run.
gen_secret() {
  # 64 hex chars. od+tr keeps this working on busybox, where openssl may be absent.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
  else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

ensure_env() {
  _envf="$REPO_ROOT/.env"

  # Two groups of keys are written here. Everything else has to survive the
  # rewrite, because this file is regenerated on EVERY run:
  #
  #   DB_*        values only the owner knows; blank by default.
  #   edge block  TUNNEL_TOKEN · EDGE_SECRET · TUNNEL_PROTOCOL · TRUST_PROXY —
  #               deploy/cloudflare/SECRETS.md tells people to put these in
  #               .env, and this function used to drop every one of them on the
  #               next run. A hand-written tunnel block that silently vanishes
  #               is a working tunnel that stops working an hour later.
  #
  # A key that is set in the ENVIRONMENT (repo/Codespaces secrets) is not
  # copied in: the environment is the winning source everywhere, and duplicating
  # a rotating secret into a file is how the two drift apart. `env_first` in
  # .bin/lib.sh is that precedence, in one place.
  _keep_user=""; _keep_name=""; _keep_pass=""; _keep_host=""; _keep_pw=""; _keep_port=""
  _keep_edge=""; _edge_n=0
  if [ -f "$_envf" ]; then
    _keep_user="$(env_get DB_USER     "$_envf" 2>/dev/null || true)"
    _keep_name="$(env_get DB_NAME     "$_envf" 2>/dev/null || true)"
    _keep_pass="$(env_get DB_PASS     "$_envf" 2>/dev/null || true)"
    _keep_host="$(env_get DB_HOST     "$_envf" 2>/dev/null || true)"
    _keep_pw="$(env_get   DB_PASSWORD "$_envf" 2>/dev/null || true)"
    _keep_port="$(env_get DB_PORT     "$_envf" 2>/dev/null || true)"
    for _k in TUNNEL_TOKEN EDGE_SECRET TUNNEL_PROTOCOL TRUST_PROXY; do
      _v="$(env_get "$_k" "$_envf" 2>/dev/null || true)"
      [ -n "$_v" ] || continue
      _keep_edge="$_keep_edge$_k=$_v
"
      _edge_n=$((_edge_n + 1))
    done
  fi

  {
    printf '//INPUT_PATH=../../data/input\n\n'
    printf '# ──autogeneratelist ──\n'
    printf 'COOKIE_SECRET=%s\n'  "$(gen_secret)"
    printf 'SESSION_SECRET=%s\n' "$(gen_secret)"
    printf 'FSM_KEY=%s\n'        "$(gen_secret)"
    printf 'PRASER_KEY=%s\n'     "$(gen_secret)"
    printf '\n# ── empty list ──\n'
    printf 'DB_USER=%s\n'     "$_keep_user"
    printf 'DB_NAME=%s\n'     "$_keep_name"
    printf 'DB_PASS=%s\n'     "$_keep_pass"
    printf 'DB_HOST=%s\n'     "$_keep_host"
    printf 'DB_PASSWORD=%s\n' "$_keep_pw"
    printf 'DB_PORT=%s\n'     "$_keep_port"
    printf '\n# ──default list──\n'
    printf 'FSM_ENDPOINT=\n'
    printf 'NODE_ENV=production\n'
    printf 'DEV_BYPASS_IP=103.84.100.46\n'
    printf 'DEV_BYPASS_HEADER=true\n'
    printf 'DEV_BYPASS_QUOTA=true\n'
    printf 'DEV_BYPASS_SESSION=true\n'
    printf 'FREE_DAILY_QUOTA=3\n'
    printf 'ALLOW_AGENT_UPLOAD=false\n'
    printf '\n'
    printf 'ENGINE_TIMEOUT_MS=300000\n'
    printf 'ENGINE_ENDPOINT=\n'
    printf 'ENGINE_ALLOWED_ORIGINS=\n'
    if [ -n "$_keep_edge" ]; then
      printf '\n# ── edge block, carried over from the previous file ──\n'
      printf '%s' "$_keep_edge"
    fi
  } > "$_envf"
  chmod 600 "$_envf"

  if [ -n "$_keep_host$_keep_user$_keep_name" ]; then
    ok ".env regenerated — secrets fresh, DB_* carried over"
  else
    ok ".env regenerated (chmod 600) — secrets fresh, DB_* blank"
  fi
  [ "$_edge_n" -gt 0 ] &&
    ok ".env edge block kept ($_edge_n key(s): TUNNEL_TOKEN · EDGE_SECRET · TUNNEL_PROTOCOL · TRUST_PROXY)" || true
  [ -n "${TUNNEL_TOKEN:-}" ] &&
    info "TUNNEL_TOKEN is in the environment — the reader (env_first) prefers it; nothing written to .env" || true
  [ -n "${EDGE_SECRET:-}" ] &&
    info "EDGE_SECRET is in the environment — the guard reads that first; nothing written to .env" || true
}

do_setup() {
  say "${C_BLD}setup${C_RST}  ${C_DIM}$(pwd)${C_RST}"
  command -v "$NODE_BIN" >/dev/null 2>&1 || die "$NODE_BIN not found on PATH"
  command -v curl >/dev/null 2>&1 || warn "curl missing — health gates will not work"

  ensure_env

  if [ "$SKIP_INSTALL" -eq 1 ]; then
    warn "--skip-install: trusting the existing node_modules"
  else
    install_web "." "root toolchain (nodemon, eslint)"
    install_web "$SITE_DIR" "site web"
    install_web "$ENGINE_DIR" "engine web"
    install_web "$BUILD_DIR" "build web (vite)"
  fi
  [ -x "$NODEMON" ] || die "nodemon missing at $NODEMON — run: $NPM_BIN install (repo root)"
  [ -f "$SITE_DIR/.env" ] || warn "$SITE_DIR/.env missing — ports/secrets/bypasses come from .env"

  # The runtime dirs are the path maps' own business: ask them instead of
  # restating the list here (restating it is how a layout rename silently
  # strands a writer in a directory nobody creates).
  if "$NODE_BIN" --input-type=module -e '
    const { ensurePraserDirs } = await import("./R_Site/_file/paths.js");
    const { resetWorkspace }  = await import("./R_Engine/Bridge/path.js");
    ensurePraserDirs();
    resetWorkspace();
  ' 2>&1; then
    ok "runtime dirs ensured by the path maps (uploads · .output · .tree · logs)"
  else
    die "the path maps could not create the runtime dirs (is the import graph intact?)"
  fi
  mkdir -p "$LOGS_DIR" "$PID_DIR"

  # The test flow runs site-web modules from $TEST_DIR, which has no
  # package.json of its own. Link it to the site web's install so `import
  # "express"` in a test resolves to the SAME copy the server loads — never a
  # second, subtly-incompatible duplicate.
  #
  # The link target is relative to $TEST_DIR, so it must climb back out by as
  # many levels as $TEST_DIR is deep (.bin/node → ../..). Guard on the
  # directory existing: the old code assumed utility-tools/ was there and
  # printed success even when ln had just failed.
  if [ -d "$SITE_DIR/node_modules" ] && [ -d "$TEST_DIR" ] && [ ! -e "$TEST_DIR/node_modules" ]; then
    _up="$(printf '%s' "$TEST_DIR" | tr -cd '/' | sed 's|/|../|g')../"
    if ln -sfn "$_up$SITE_DIR/node_modules" "$TEST_DIR/node_modules" 2>/dev/null; then
      ok "$TEST_DIR/node_modules → $SITE_DIR/node_modules (tests resolve the site web's deps)"
    fi
  fi

  # The SPA build is never optional while the webs are up: --no-build only
  # skips THIS one-off pass, because do_boot keeps a supervised
  # `vite build --watch` running that produces the same output and then
  # refreshes it on every save. --no-spa-watch removes that safety net, so the
  # gate in do_boot turns a missing $BUILD_DIR/spa/frontend into a failure
  # instead of a site web that serves 404 on /.
  if [ ! -x "$VITE_BIN" ]; then
    [ "$SPA_WATCH" -eq 0 ] && [ ! -f "$BUILD_DIR/spa/frontend/index.html" ] &&
      die "no vite at $(rel "$VITE_BIN") and no built SPA — run: (cd $BUILD_DIR && $NPM_BIN install)"
    warn "$(rel "$VITE_BIN") missing — the SPA cannot be built; run: (cd $BUILD_DIR && $NPM_BIN install)"
  elif [ "$SKIP_BUILD" -eq 1 ]; then
    say "one-off SPA build skipped  ${C_DIM}--no-build · the build web (vite build --watch) builds it during boot${C_RST}"
    [ "$SPA_WATCH" -eq 0 ] && warn "--no-build --no-spa-watch: nothing will build the SPA — the site web serves $BUILD_DIR/spa/frontend as it stands"
  else
    say "building the SPA once  ${C_DIM}→ $BUILD_DIR/spa/frontend${C_RST}"
    if "$VITE_BIN" build --config "$BUILD_DIR/spa/vite.config.js" >/tmp/linga-spa-build.log 2>&1; then
      ok "SPA built — the site web serves it on :$SITE_PORT"
    else
      warn "vite build failed (the site web still boots; /api only):"
      tail -12 /tmp/linga-spa-build.log | sed 's/^/      /' >&2
    fi
  fi

  # An import that no longer resolves does not look like a path problem from
  # the outside — it looks like a server that will not start. Check the graph
  # before spawning anything.
  say "checking the import graph"
  if "$NODE_BIN" "$TEST_DIR/check-imports.mjs"; then
    ok "every relative import resolves"
  elif [ "$SKIP_CHECK" -eq 1 ]; then
    # --no-check: a broken import in ONE web should not stop the others. The
    # engine web's graph is separate from the site web's, so an engine-only
    # breakage still leaves :3000 perfectly bootable — which is what matters
    # when the site is the thing being exposed through the tunnel.
    warn "unresolved imports above — continuing anyway (--no-check)"
    warn "the web that owns the broken import will fail to start; the others are fine"
  else
    die "unresolved import on a boot graph — fix the paths above before booting (or pass --no-check)"
  fi
}

# ── boot ───────────────────────────────────────────────────────────────────
do_boot() {
  mkdir -p "$PID_DIR" "$LOGS_DIR"
  stop_all   # a previous --detach run must not double-book a port

  local spec port name
  for spec in "$SITE_PORT:site" "$ENGINE_PORT:engine"; do
    port="${spec%%:*}"; name="${spec##*:}"
    if port_busy "$port"; then
      printf '%s\n' "${C_RED}✗${C_RST} port $port ($name) is already taken:" >&2
      port_listeners "$port" | sed 's/^/      /' >&2
      hint "free it, or move this web: ./.bin/bootstrap.sh --${name}-port <other-port>"
      hint "if a previous run left it up: ./.bin/bootstrap.sh stop"
      exit 1
    fi
  done

  say "${C_BLD}2/3 boot${C_RST} — the three webs  ${C_DIM}(all from $(pwd): the path maps require it)${C_RST}"
  # remembered for `./.bin/bootstrap.sh status` from any other shell
  printf '%s %s %s\n' "$SITE_PORT" "$ENGINE_PORT" "$SPA_PORT" > "$PID_DIR/ports"

  # PORT is passed per web — both servers read it from the environment, and
  # dotenv never overrides an inherited value, so this wins over .env.
  # site: nodemon.json (exec + SKIP_BUILD live in the config)
  start_web site "env PORT=$SITE_PORT $NODEMON --config nodemon.json" "$SITE_LOG"
  # engine: its own watcher, so a grammar edit restarts :$ENGINE_PORT only
  start_web engine "env PORT=$ENGINE_PORT $NODEMON --config $ENGINE_DIR/nodemon.json" "$ENGINE_LOG"
  # build web: vite, supervised. Its default job is `build --watch`, which
  # produces R_Site/Build/spa/frontend and rebuilds it on every save — that is
  # why the site web may skip its own build (SKIP_BUILD=true in nodemon.json)
  # and why --no-build here still cannot leave the SPA unbuilt. --spa-dev adds
  # vite's dev server on $SPA_PORT for HMR (the built copy stays the one the
  # site serves, so /api keeps working).
  local build_watch=0   # 1 only when a `vite build --watch` is really running
  if [ "$SPA_WATCH" -eq 1 ]; then
    if [ ! -x "$VITE_BIN" ]; then
      # No vite means no rebuild: only fatal when there is also nothing to
      # serve, because then the site web is a 404 on /.
      [ -f "$BUILD_DIR/spa/frontend/index.html" ] ||
        die "the build web needs vite at $(rel "$VITE_BIN") and there is no built SPA — install it: (cd $BUILD_DIR && $NPM_BIN install)"
      warn "build web: no vite binary — serving the existing frontend/ without watching it"
    else
      start_web spa-build "$VITE_BIN build --watch --config $BUILD_DIR/spa/vite.config.js" "$SPA_BUILD_LOG"
      build_watch=1
    fi
  else
    : > "$SPA_BUILD_LOG"
    printf '%s\n' "build web: --no-spa-watch — $BUILD_DIR/spa/frontend is served as it stands" >> "$SPA_BUILD_LOG"
  fi
  if [ "$SPA_DEV" -eq 1 ]; then
    [ -x "$VITE_BIN" ] || die "--spa-dev needs vite: (cd $BUILD_DIR && $NPM_BIN install)"
    port_busy "$SPA_PORT" && die "port $SPA_PORT (vite dev) is already in use"
    start_web spa "$VITE_BIN --config $BUILD_DIR/spa/vite.config.js --port $SPA_PORT --host 0.0.0.0" "$SPA_LOG"
  else
    : > "$SPA_LOG"
    printf '%s\n' "vite dev: not running — the site web serves $BUILD_DIR/spa/frontend (add --spa-dev for HMR)" >> "$SPA_LOG"
  fi

  local failed=0
  wait_for "http://127.0.0.1:$ENGINE_PORT/health" "engine web up" 90 '"ok":true' || failed=1
  wait_for "http://127.0.0.1:$SITE_PORT/csrf-token" "site web up" 90 'csrfToken' || failed=1
  if [ "$SPA_DEV" -eq 1 ]; then
    wait_for "http://127.0.0.1:$SPA_PORT/" "vite dev up (HMR, no /api)" 90 'DOCTYPE' || failed=1
  fi
  # The build web has no port to probe, so its health is the file it writes —
  # waited for rather than assumed, because a skipped one-off build means this
  # process is the one doing the work.
  if [ "$build_watch" -eq 1 ]; then
    if ! wait_for_file "$BUILD_DIR/spa/frontend/index.html" "build web: SPA built by vite build --watch" 120; then
      hint "the site web has no UI to serve — see $(rel "$SPA_BUILD_LOG")"
      failed=1
    elif grep -q "error during build\|Build failed" "$SPA_BUILD_LOG" 2>/dev/null; then
      warn "build web: vite reported a failed build (the previous frontend is still served)"
      tail -12 "$SPA_BUILD_LOG" | sed 's/^/      /' >&2
      failed=1
    fi
  elif [ -f "$BUILD_DIR/spa/frontend/index.html" ]; then
    ok "build web idle  ${C_DIM}the site serves the existing $BUILD_DIR/spa/frontend${C_RST}"
  else
    warn "build web off and no built SPA — the site web will 404 on /"
    hint "drop --no-spa-watch so vite builds it, or run: $NPM_BIN run build"
    printf '%s\n' "--no-spa-watch with no frontend: nothing can serve /" >> "$SPA_BUILD_LOG"
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    echo >&2
    warn "a web failed its health gate — tail of each log:"
    local f
    for f in "$ENGINE_LOG" "$SITE_LOG" "$SPA_BUILD_LOG" "$SPA_LOG"; do
      [ -f "$f" ] || continue
      printf '%s\n' "${C_DIM}── $(rel "$f") ──${C_RST}" >&2
      tail -12 "$f" | sed 's/^/    /' >&2
    done
    stop_all
    exit 1
  fi

  echo
  printf '%s\n' "  ${C_BLD}site   ${C_RST} http://localhost:$SITE_PORT        ${C_DIM}R_Site/index.js · nodemon.json${C_RST}"
  printf '%s\n' "  ${C_BLD}engine ${C_RST} http://localhost:$ENGINE_PORT/health  ${C_DIM}$ENGINE_DIR/init/api-server.js · $ENGINE_DIR/nodemon.json${C_RST}"
  if [ "$SPA_WATCH" -eq 1 ]; then
    printf '%s\n' "  ${C_BLD}build  ${C_RST} ${C_DIM}vite build --watch → $BUILD_DIR/spa/frontend (no port; the site serves it)${C_RST}"
  else
    printf '%s\n' "  ${C_BLD}build  ${C_RST} ${C_DIM}off (--no-spa-watch) · the site serves $BUILD_DIR/spa/frontend as it stands${C_RST}"
  fi
  if [ "$SPA_DEV" -eq 1 ]; then
    printf '%s\n' "  ${C_BLD}       ${C_RST} http://localhost:$SPA_PORT         ${C_DIM}vite dev — HMR only; /api is not proxied${C_RST}"
    hint "${C_DIM}         (vite also rejects foreign Host headers: access it as localhost, or drop --spa-dev)${C_RST}"
  fi
  echo
}

# ── build web, on its own ──────────────────────────────────────────────────
# `bootstrap.sh build start` exists so that the shell's `assets` — the one
# command whose whole job is "frontend assets only" — has one implementation:
# the watched folder, the pid file, the log file and the stop path are the same
# ones `boot` uses, so `kill` and `boot` find this vite where they expect it.
build_running() {
  local pid
  pid="$(cat "$PID_DIR/spa-build.pid" 2>/dev/null)" || return 1
  [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null
}

build_status() {
  local pid
  if pid="$(cat "$PID_DIR/spa-build.pid" 2>/dev/null)" && kill -0 "$pid" 2>/dev/null; then
    ok "build web watching  ${C_DIM}vite build --watch · pid $pid${C_RST}"
  else
    warn "build web not running  ${C_DIM}start it: ./.bin/bootstrap.sh build start${C_RST}"
  fi
  if [ -f "$BUILD_DIR/spa/frontend/index.html" ]; then
    ok "frontend built  ${C_DIM}$(rel "$BUILD_DIR/spa/frontend") · $(date -r "$BUILD_DIR/spa/frontend/index.html" '+%H:%M:%S' 2>/dev/null || echo built)${C_RST}"
  else
    warn "no $(rel "$BUILD_DIR/spa/frontend") — the site web serves 404 on /"
  fi
}

do_build() { # start|once|stop|status
  local action="${1:-start}"
  mkdir -p "$PID_DIR" "$LOGS_DIR"
  # No do_setup here on purpose: this is the "only the frontend assets" path,
  # so it never installs, never touches .env and never probes an import graph.
  case "$action" in
    start)
      [ -x "$VITE_BIN" ] || die "no vite at $(rel "$VITE_BIN") — install the build web first: ./.bin/setup.sh"
      if build_running; then
        ok "already watching (pid $(cat "$PID_DIR/spa-build.pid")) — nothing to start"
        return 0
      fi
      start_web spa-build "$VITE_BIN build --watch --config $BUILD_DIR/spa/vite.config.js" "$SPA_BUILD_LOG"
      ok "frontend assets: $VITE_BIN build --watch → $(rel "$BUILD_DIR/spa/frontend")"
      hint "log: $(rel "$SPA_BUILD_LOG")  ·  stop: ./.bin/bootstrap.sh build stop"
      ;;
    once)
      [ -x "$VITE_BIN" ] || die "no vite at $(rel "$VITE_BIN") — install the build web first: ./.bin/setup.sh"
      say "one blocking build → $(rel "$BUILD_DIR/spa/frontend")"
      "$VITE_BIN" build --config "$BUILD_DIR/spa/vite.config.js" || die "vite build failed"
      ok "built"
      ;;
    stop)
      stop_web spa-build
      ok "build web stopped — the site still serves the frontend that is built"
      ;;
    status) build_status ;;
    logs|log)
      [ -f "$SPA_BUILD_LOG" ] || die "no build log yet at $(rel "$SPA_BUILD_LOG") — run: ./.bin/bootstrap.sh build start"
      hint "following $(rel "$SPA_BUILD_LOG") — Ctrl-C stops the tail, not the build"
      tail -n 40 -F "$SPA_BUILD_LOG"
      ;;
    *) die "unknown build action: $action  (start|once|stop|status)" ;;
  esac
}

# ── the hand-off to stage 3 ────────────────────────────────────────────────
# Reached only through `full`. It does not assume anything about the tunnel:
# tunnel.sh deploy does its own preflight and is idempotent, so a connector
# that is already up is reported rather than restarted.
chain_tunnel() {
  [ -f "$LINGA_TUNNEL" ] || { warn "no tunnel script at $LINGA_TUNNEL — stage 3 skipped"; return 1; }
  echo
  say "${C_BLD}3/3 tunnel${C_RST} — handing off to $(rel "$LINGA_TUNNEL") deploy"
  if bash "$LINGA_TUNNEL" deploy; then
    return 0
  fi
  warn "stage 3 failed — the three webs are up and untouched"
  hint "fix what it printed, then: ./deploy/cloudflare/tunnel/tunnel.sh deploy"
  return 1
}

# The end of a `full` run: what is listening, and how to stop all of it without
# remembering which script owns which process.
flow_done() {
  echo
  printf '%s\n' "  ${C_BLD}site   ${C_RST} http://localhost:$SITE_PORT"
  printf '%s\n' "  ${C_BLD}engine ${C_RST} http://localhost:$ENGINE_PORT/health"
  printf '%s\n' "  ${C_BLD}build  ${C_RST} vite build --watch → $(rel "$BUILD_DIR/spa/frontend")"
  printf '%s\n' "  ${C_BLD}tunnel ${C_RST} ./deploy/cloudflare/tunnel/tunnel.sh status"
  echo
  hint "stop everything: kill   ·   state: setup status   ·   again from scratch: setup_flow full"
}

# ── test flow ──────────────────────────────────────────────────────────────
run_tests() {
  local args=()
  [ "$LIVE" -eq 1 ] && args+=("--live")
  [ "$STRICT" -eq 1 ] && args+=("--strict")
  echo
  local desc="import graph · $TEST_DIR/*.test.mjs"
  [ "$LIVE" -eq 1 ] && desc="$desc · live probe" || desc="$desc · webs not probed (--no-live)"
  say "${C_BLD}test flow${C_RST}  ${C_DIM}$desc${C_RST}"
  BOOT_LIVE="$LIVE" "$NODE_BIN" "$TEST_DIR/run-tests.mjs" "${args[@]}"
}

# ── commands ───────────────────────────────────────────────────────────────
case "$CMD" in
  setup)
    do_setup
    if [ "$CHAIN" -eq 1 ]; then
      do_boot
      rc=0
      chain_tunnel || rc=1
      flow_done
      exit "$rc"
    fi
    echo
    ok "setup complete — next: ./.bin/bootstrap.sh boot   (the three webs)"
    hint "or carry on in one go: ./.bin/bootstrap.sh boot --detach full"
    ;;

  build)
    # `build start full` = one blocking build first, so the watcher's first
    # cycle is not the thing you are waiting on. `full` is the second argument,
    # exactly as it is everywhere else.
    if [ "$CHAIN" -eq 1 ] && [ "$BUILD_CMD" = "start" ]; then
      do_build once
    fi
    do_build "$BUILD_CMD"
    ;;

  boot)
    do_setup
    do_boot
    if [ "$CHAIN" -eq 1 ]; then
      # The webs are up either way; the exit code says whether stage 3 finished
      # the flow, so a script that calls this can tell a partial success.
      rc=0
      chain_tunnel || rc=1
      flow_done
      exit "$rc"
    fi
    if [ "$DETACH" -eq 1 ]; then
      ok "webs left running (--detach) · logs: $(rel "$LOGS_DIR")/ · stop: ./.bin/bootstrap.sh stop"
      hint "next: 3/3 tunnel — ./deploy/cloudflare/tunnel/tunnel.sh deploy   (or: ./.bin/bootstrap.sh boot --detach full)"
      hint "aliases: boot · kill · assets · pull   (type: commands — npm run shell:install)"
      exit 0
    fi
    trap 'echo; say "stopping the three webs"; stop_all; exit 0' INT TERM
    say "streaming logs — Ctrl-C stops all three webs"
    hint "nodemon watches both: save a backend file and its web restarts"
    if [ "$SPA_WATCH" -eq 1 ]; then
      hint "the build web watches $BUILD_DIR/spa — a markup/SCSS save rebuilds frontend/"
    else
      hint "the SPA is not being rebuilt (--no-spa-watch); $NPM_BIN run build does it by hand"
    fi
    follow_log "$ENGINE_LOG" "[engine]" "$C_GRN"
    follow_log "$SITE_LOG"  "[site]  " "$C_BLU"
    if [ "$SPA_WATCH" -eq 1 ]; then
      follow_log "$SPA_BUILD_LOG" "[build] " "$C_MAG"
    fi
    if [ "$SPA_DEV" -eq 1 ]; then
      follow_log "$SPA_LOG" "[spa]   " "$C_YLW"
    fi
    # bare `wait`, not a sleep loop: a signal interrupts wait, so the trap
    # fires immediately instead of up to a second later.
    wait
    stop_all
    ;;

  test)
    # CI-shaped: one pass, exit code is the verdict, nothing left running.
    do_setup
    do_boot
    rc=0
    run_tests || rc=1
    echo
    stop_all
    if [ "$rc" -eq 0 ]; then
      ok "test flow green — webs stopped"
    else
      die "test flow FAILED — webs stopped"
    fi
    ;;

  dev)
    do_setup
    do_boot
    echo
    # No separate first pass: nodemon runs its "exec" once on start, so the
    # suite + live probe already fire the moment the webs are up — running
    # run_tests here too would just print the same flow twice.
    say "${C_BLD}watch mode${C_RST} — ${C_MAG}nodemon${C_RST} runs the test flow now and on every save"
    hint "a backend edit restarts its web AND re-runs the suite"
    hint "re-run on demand: touch a watched file · or run the suite directly: $NPM_BIN test"
    hint "Ctrl-C stops the watcher and the three webs together"
    # The watcher runs as a backgrounded child so a TERM sent to THIS shell can
    # reach it: bash defers traps until the foreground child exits, which for a
    # watcher is never. `wait` is interruptible, so the trap fires at once.
    # --no-stdin because a background job must not try to read the tty for `rs`
    # (SIGTTIN would stop it); interactive `rs` lives in `npm run test:watch`.
    WATCH_PID=""
    BOOT_LIVE="$LIVE" "$NODEMON" --no-stdin --config nodemon.test.json &
    WATCH_PID=$!
    echo "$WATCH_PID" > "$PID_DIR/testwatch.pid"
    trap 'say "stopping the watcher and the three webs"; kill -TERM "${WATCH_PID:-0}" 2>/dev/null; stop_all; exit 0' INT TERM
    wait "$WATCH_PID"; wrc=$?
    stop_all
    # 0 = it was told to stop, >128 = signalled: both are the expected end.
    [ "$wrc" -eq 0 ] || [ "$wrc" -gt 128 ] || die "the test watcher exited (status $wrc) — the webs are stopped; run $NPM_BIN run test:watch to see why"
    ;;

  stop)
    stop_all
    ok "stopped (logs kept in $(rel "$LOGS_DIR")/)"
    # Only worth saying when it is true: stage 2 owns the webs, not the
    # connector, so a tunnel left running is the usual surprise — but when the
    # stop came from .bin/kill.sh the tunnel is already down, and then the same
    # sentence would be a lie.
    _tpid="$(cat "$PID_DIR/tunnel.pid" 2>/dev/null)"
    if [ -n "${_tpid:-}" ] && kill -0 "$_tpid" 2>/dev/null; then
      hint "the tunnel is still up (cloudflared pid $_tpid) — the shell's 'kill' stops both"
    fi
    ;;

  status)
    # `status` from a second shell has no idea which ports the running boot was
    # given on its command line, so boot records them beside the pids.
    sp="$SITE_PORT"; ep="$ENGINE_PORT"; ap="$SPA_PORT"; src="(from the flags)"
    if [ -f "$PID_DIR/ports" ]; then
      read -r r_sp r_ep r_ap < "$PID_DIR/ports" 2>/dev/null
      [ -n "${r_sp:-}" ] && sp="$r_sp"
      [ -n "${r_ep:-}" ] && ep="$r_ep"
      [ -n "${r_ap:-}" ] && ap="$r_ap"
      src="(from the last boot)"
    fi
    printf '%s\n' "${C_BLD}web     port   state${C_RST}   ${C_DIM}${src}${C_RST}"
    for spec in "site:$sp:/csrf-token" "engine:$ep:/health" "spa-dev:$ap:/"; do
      name="${spec%%:*}"; rest="${spec#*:}"; port="${rest%%:*}"; path="${rest#*:}"
      url="http://127.0.0.1:$port$path"
      if port_busy "$port"; then state="${C_GRN}listening${C_RST}"
      elif curl -s -m 2 -o /dev/null "$url" 2>/dev/null; then state="${C_GRN}answering${C_RST}"
      else state="${C_RED}down${C_RST}"; fi
      printf '%s\n' "  ${C_BLD}${name}${C_RST}  ${port}  ${state}  ${C_DIM}${url}${C_RST}"
    done
    # The build web owns no port: it is a watcher, so it is reported by its
    # process and its output file instead.
    bpid="$(cat "$PID_DIR/spa-build.pid" 2>/dev/null)"
    if [ -n "${bpid:-}" ] && kill -0 "$bpid" 2>/dev/null; then
      bstate="${C_GRN}watching${C_RST}  ${C_DIM}pid $bpid · vite build --watch${C_RST}"
    else
      bstate="${C_RED}not running${C_RST}  ${C_DIM}./.bin/bootstrap.sh boot starts it${C_RST}"
    fi
    if [ -f "$BUILD_DIR/spa/frontend/index.html" ]; then
      bstate="$bstate  ${C_DIM}frontend $(date -r "$BUILD_DIR/spa/frontend/index.html" '+%H:%M:%S' 2>/dev/null || echo built)${C_RST}"
    else
      bstate="$bstate  ${C_RED}· no $BUILD_DIR/spa/frontend${C_RST}"
    fi
    printf '%s\n' "  ${C_BLD}build${C_RST}    —     ${bstate}"
    # stage 3 has its own report and its own log; `full` is what asks for it,
    # so a plain `status` stays a statement about THIS stage.
    if [ "$CHAIN" -eq 1 ] && [ -f "$LINGA_TUNNEL" ]; then
      echo
      bash "$LINGA_TUNNEL" status
    fi
    ;;

  clean)
    stop_all
    say "dropping build output + runtime scratch (all gitignored; ./.bin/bootstrap.sh rebuilds them)"
    rm -rf "$BUILD_DIR/spa/frontend" "$ENGINE_DIR/.output" "$ENGINE_DIR/.tree" \
           "$ENGINE_DIR/input" "$LOGS_DIR"
    ok "clean"
    ;;

  *) die "unknown command: $CMD  (try: ./.bin/bootstrap.sh --help)" ;;
esac
