#!/bin/sh
# Rebuild box.wasm in two Node-only steps (engine.wasm, the QuickJS interpreter,
# is committed and reused; only payload + packaging run here):
#   1. build-payload.mjs  pack the four map modules + engine-api, inline mapData,
#                         AES-256-GCM seal; key goes to payload.key.txt (external)
#   2. tools/pack-box.mjs append linga.loader (keyless) + linga.payload sections
# Set LINGA_BOX_RAW=1 to pack the loader without javascript-obfuscator.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/build-payload.mjs"
node "$DIR/tools/pack-box.mjs"
echo "done: $DIR/box.wasm (key never embedded; see payload.key.txt)"
