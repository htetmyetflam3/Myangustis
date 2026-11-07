#!/usr/bin/env bash
# Lazy parser wrapper — starts the dispatcher on demand, sends request,
# outputs response. Caller doesn't manage process lifecycle.
#
# Usage:
#   ./lazy-parser.sh '{"caller":"local","object":{...},"method":"extracting"}'
#   echo '{"caller":"local",...}' | ./lazy-parser.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOCKET="/tmp/myangustis-parser.sock"

# If socket server isn't running, start it lazily
if [ ! -S "$SOCKET" ]; then
  node "$SCRIPT_DIR/lazy-dispatcher.js" &
  # Wait for socket to appear (max 10 seconds)
  for i in $(seq 1 100); do
    [ -S "$SOCKET" ] && break
    sleep 0.1
  done
  if [ ! -S "$SOCKET" ]; then
    echo "Error: lazy dispatcher failed to start" >&2
    exit 1
  fi
fi

# Send request via socket client
if [ $# -gt 0 ]; then
  node "$SCRIPT_DIR/lazy-client.js" "$1"
else
  node "$SCRIPT_DIR/lazy-client.js"
fi
