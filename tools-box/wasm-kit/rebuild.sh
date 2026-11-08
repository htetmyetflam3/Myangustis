#!/bin/sh
# Rebuild box.wasm in two Node-only steps (engine.wasm, the QuickJS interpreter,
# is committed and reused; only payload + packaging run here):
#   1. build-payload.js  pack the four map modules + engine-api, inline mapData,
#                        obfuscate the bundle, AES-256-GCM seal; key goes to
#                        payload.key.txt (external)
#   2. tools/pack-box.js append linga.loader (obfuscated) + linga.payload sections
# There is no raw/unobfuscated lane: bundle and loader always ship obfuscated.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/build-payload.js"
node "$DIR/tools/pack-box.js"
echo "done: $DIR/box.wasm (key never embedded; see payload.key.txt)"
