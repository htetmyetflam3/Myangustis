#!/usr/bin/env bash
# FILE: .bin/status.sh — where the three stages stand.
#
#   ./.bin/status.sh              the table
#   ./.bin/status.sh --commands   the table plus the list of commands
#
# This is the one place that knows how to read the state of the flow, so the
# aliases (`commands`, and setup.sh's `status` word) point here rather than
# each printing their own version of it.
#
# Nothing here needs a running shell: it reads the pid files stage 2 writes
# (R_Site/Praser/Python/logs/pids) and probes the ports.
set -uo pipefail

. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 1

FRONTEND="$REPO_ROOT/R_Site/Build/spa/frontend/index.html"

read -r SITE_PORT ENGINE_PORT SPA_PORT <<< "$(linga_ports)"

table() {
  printf '%s\n' "${C_GRN}stage              state${C_RST}"
  if port_busy "$SITE_PORT"; then
    printf '  1-2 site    :%s  %slive%s\n' "$SITE_PORT" "$C_GRN" "$C_RST"
  else
    printf '  1-2 site    :%s  %sdown%s\n' "$SITE_PORT" "$C_RED" "$C_RST"
  fi
  if port_busy "$ENGINE_PORT"; then
    printf '  1-2 engine  :%s  %slive%s\n' "$ENGINE_PORT" "$C_GRN" "$C_RST"
  else
    printf '  1-2 engine  :%s  %sdown%s\n' "$ENGINE_PORT" "$C_RED" "$C_RST"
  fi

  _bpid="$(cat "$REPO_ROOT/R_Site/Praser/Python/logs/pids/spa-build.pid" 2>/dev/null)"
  if [ -n "${_bpid:-}" ] && kill -0 "$_bpid" 2>/dev/null; then
    _bstate="${C_GRN}watching${C_RST} ${C_DIM}vite build --watch, pid $_bpid${C_RST}"
  else
    _bstate="${C_DIM}not watching (assets)${C_RST}"
  fi
  if [ -f "$FRONTEND" ]; then
    printf '  2   build        %s  %sfrontend/ built%s\n' "$_bstate" "$C_DIM" "$C_RST"
  else
    printf '  2   build        %s  %sfrontend/ MISSING — the site serves a 404 on /%s\n' \
      "$_bstate" "$C_RED" "$C_RST"
  fi

  _tpid="$(cat "$REPO_ROOT/R_Site/Praser/Python/logs/pids/tunnel.pid" 2>/dev/null)"
  if [ -n "${_tpid:-}" ] && kill -0 "$_tpid" 2>/dev/null; then
    printf '  3   tunnel       %slive%s %scloudflared pid %s%s\n' \
      "$C_GRN" "$C_RST" "$C_DIM" "$_tpid" "$C_RST"
  else
    printf '  3   tunnel       %sdown%s %s(tunnel.sh deploy)%s\n' \
      "$C_RED" "$C_RST" "$C_DIM" "$C_RST"
  fi
}

commands() {
  printf '%s\n' \
    "${C_GRN}the linear flow${C_RST}   ${C_DIM}1/3 setup.sh → 2/3 bootstrap.sh (site :$SITE_PORT · engine :$ENGINE_PORT · build) → 3/3 tunnel.sh${C_RST}" \
    '' \
    "  ${C_GRN}setup_flow${C_RST} [full]       the whole flow, 1 → 2 → 3  ${C_DIM}(./.bin/setup.sh start)${C_RST}" \
    "  ${C_GRN}setup${C_RST}                   stage 2's setup: install the three webs, ensure dirs, build the SPA" \
    "  ${C_GRN}boot${C_RST} [full]             stages 2 → 3, detached  ${C_DIM}(boot full: chains the tunnel too)${C_RST}" \
    "  ${C_GRN}dev${C_RST}                     setup → boot → test flow → watch tests  ${C_DIM}(Ctrl-C stops all)${C_RST}" \
    "  ${C_GRN}assets${C_RST}                  frontend only — vite build --watch, detached" \
    "  ${C_GRN}stop${C_RST}                    the three webs  ${C_DIM}·${C_RST}  ${C_GRN}kill${C_RST}: the tunnel first  ${C_DIM}(kill 4242 → builtin)${C_RST}" \
    "  ${C_GRN}pull${C_RST} [full]             git pull, then chmod +x the .bin scripts" \
    "  ${C_GRN}push${C_RST}                    ./.bin/git.sh — stage all, bump the version, record in .commit" \
    '' \
    "  ${C_GRN}test · test_live · test_watch${C_RST}   the suite · + the running webs · on every save" \
    "  ${C_GRN}check_imports · lint · lint_fix${C_RST}   the import guard, then eslint (there is no typecheck)" \
    "  ${C_GRN}build · preview_spa · dev_spa${C_RST}   the SPA, one web, or vite dev — see .bashrc for the rest" \
    "  ${C_GRN}tunnel_deploy · tunnel_status${C_RST}   stage 3  ${C_DIM}·${C_RST}  ${C_GRN}worker_flow${C_RST}: install → secret → deploy" \
    "  ${C_GRN}pworking · Gr · commands${C_RST}   push working · cd the repo · this list" \
    '' \
    "${C_DIM}the aliases live in the repo-root .bashrc — npm run shell:install sources it from ~/.bashrc. full: second argument, boolean, false by default.${C_RST}" \
    "${C_DIM}without the aliases, every line above is the script it names${C_RST}"
}
case "${1:-}" in
  --commands|-c|commands|list|help|-h|--help) commands ;;
esac
table
