#!/usr/bin/env bash
# FILE: .bin/kill.sh — bring the flow down, stage 3 then stage 2.
#
#   ./.bin/kill.sh          stop the tunnel, then the three webs
#   ./.bin/kill.sh full     ... then clean the runtime dirs and sweep the ports
#   ./.bin/kill.sh 4242     nothing to do with the flow: the builtin, untouched
#   ./.bin/kill.sh -9 %1    same — a signal still means a signal
#
# One script because one command, not two half-commands: the tunnel has to go
# first (it is what makes the webs reachable from outside) and stage 2's own
# `stop` would leave cloudflared pointing at a closed port. The aliases file
# maps `kill` here — an alias beats a builtin in bash, which is why anything
# that does not look like one of our words is handed straight back to the
# builtin below. Scripts do not inherit functions or aliases, so inside this
# file `kill` is the real thing; `builtin kill` is spelled out to be explicit.
set -uo pipefail

. "$(dirname "$0")/lib.sh"
cd "$REPO_ROOT" || exit 1

case "${1:-}" in
  ""|full|status|help|-h|--help) : ;;
  *)
    # A pid, a signal name, -9, %1 … — not ours. Pass it through verbatim.
    builtin kill "$@"
    exit $?
    ;;
esac

case "${1:-}" in
  help|-h|--help)
    awk '/^# FILE:/{on=1} /^set -u/{exit} on {sub(/^# ?/,""); print}' "$0"
    exit 0
    ;;
  status)
    exec bash "$LINGA_STATUS"
    ;;
esac

FULL=0
[ "${1:-}" = full ] && FULL=1

info "stopping stage 3 (tunnel), then stage 2 (the three webs)"
bash "$LINGA_TUNNEL" stop
bash "$LINGA_BOOTSTRAP" stop

if [ "$FULL" -eq 1 ]; then
  bash "$LINGA_BOOTSTRAP" clean
  # A port held by something the pid files do not know about (a vite started by
  # hand, a boot from another checkout) survives `stop` and blocks the next
  # `boot`. Targeted, never a pkill: only pids actually listening on the three
  # ports are signalled, and `full` is what opts into it.
  command -v ss >/dev/null 2>&1 || {
    dim "ss is unavailable — ports 3000/9000/5173 not swept for strays"
    exec bash "$LINGA_STATUS"
  }
  read -r _sp _ep _ap <<< "$(linga_ports)"
  for _p in "$_sp" "$_ep" "$_ap"; do
    port_busy "$_p" || continue
    _pids="$(ss -ltnpH "sport = :$_p" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u | tr '\n' ' ')"
    [ -n "$_pids" ] || { warn "port $_p is still listening but no pid was readable (need root?)"; continue; }
    for _pid in $_pids; do
      [ "$_pid" = "$$" ] && continue
      warn "port $_p still held by pid $_pid — TERM"
      builtin kill -TERM "$_pid" 2>/dev/null
    done
  done
fi

exec bash "$LINGA_STATUS"
