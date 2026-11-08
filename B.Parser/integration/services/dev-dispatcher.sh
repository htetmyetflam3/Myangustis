#!/usr/bin/env bash
# Dev twin of myangustis-parser.socket — true wake-on-request in
# development, with no systemd daemon and no nodemon.
#
# systemd-socket-activate holds /tmp/myangustis-parser.sock. NO parser
# process exists while idle. The first connection execs the
# dispatcher (it receives the listening socket on fd 3, exactly as
# under systemd); the dispatcher exits after PARSER_IDLE_MS idle;
# this loop re-arms the socket for the next wake. Ctrl-C stops.
#
# Every wake is a fresh process running the current code, so edits
# take effect on the next request — no file watcher needed. (That is
# why nodemon is not used here: nodemon watches files, it cannot
# watch requests, and under it the dispatcher would run all day.)
#
# Usage:  ./dev-dispatcher.sh            (socket + client as usual)
#         PARSER_IDLE_MS=30000 ./dev-dispatcher.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOCKET="${PARSER_SOCKET:-/tmp/myangustis-parser.sock}"
IDLE_MS="${PARSER_IDLE_MS:-30000}"

# Dev only: clear a stale socket left by a crashed run.
rm -f "$SOCKET"
trap 'exit 0' INT TERM

echo "dev-dispatcher: holding $SOCKET (dispatcher wakes on request, idle-exit ${IDLE_MS}ms)"
while true; do
  systemd-socket-activate --setenv="PARSER_IDLE_MS=$IDLE_MS" -l "$SOCKET" \
    node "$SCRIPT_DIR/lazy-dispatcher.js"
  # Brief pause so a crashing dispatcher cannot spin the loop.
  sleep 0.3
done
