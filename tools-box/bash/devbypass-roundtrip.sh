#!/usr/bin/env bash
# Round-trip test for the /api/submit chain with DEV_BYPASS_SESSION=true.
# Exercises: text submit · PDF upload (server-side PRASER) · DOCX upload
# (server-side PRASER, Zawgyi fixture) · cookie/X-Visitor-Token round trip ·
# engine raw pull · zero-DB assertion.
#
# Usage:  bash Tools/test/devbypass-roundtrip.sh [PORT]
# Requires: the Site server running with DEV_BYPASS_SESSION=true
#           (SKIP_BUILD=true PORT=$PORT DEV_BYPASS_SESSION=true node Site/index.js)
set -u
PORT="${1:-3210}"
BASE="http://127.0.0.1:$PORT"
# ROOT from .bin/lib.sh. The old "$(dirname $0)/../.." pointed OUTSIDE the
# repo once this script moved into .bin/.
. "$(dirname "$0")/lib.sh"
ROOT="$REPO_ROOT"
PDF="$ROOT/Site/Public/PRASER/Python/upload/input/pdf/test.pdf"
DOCX="$ROOT/Site/Public/PRASER/Python/upload/input/docx/zawgyi_fixture.docx"
KEY="$(grep '^FSM_KEY=' "$ROOT/.env" | cut -d= -f2)"

fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 (expected $2, got $3)"; fail=1; fi
}

echo "== 1) text submit =="
code=$(curl -s "$BASE/api/submit" -X POST -H 'Content-Type: application/json' \
  -d '{"text":"မင်္ဂလာပါ ကမ္ဘာ"}' -D /tmp/rt_h1.txt -o /tmp/rt_b1.json -w '%{http_code}')
check "text submit -> 202" 202 "$code"

echo "== 2) PDF upload (server-side PRASER) =="
code=$(curl -s "$BASE/api/submit" -X POST -F "file=@$PDF" \
  -D /tmp/rt_h2.txt -o /tmp/rt_b2.json -w '%{http_code}')
check "pdf submit -> 202" 202 "$code"

echo "== 3) DOCX upload (raw-Zawgyi fixture -> converted) =="
code=$(curl -s "$BASE/api/submit" -X POST -F "file=@$DOCX" \
  -D /tmp/rt_h3.txt -o /tmp/rt_b3.json -w '%{http_code}')
check "docx submit -> 202" 202 "$code"

echo "== 4) bodies are single plain content =="
node - "$fail" <<'EOF'
import fs from 'fs';
let bad = 0;
for (const f of ['/tmp/rt_b1.json', '/tmp/rt_b2.json', '/tmp/rt_b3.json']) {
  const { text } = JSON.parse(fs.readFileSync(f, 'utf8'));
  const html = /<[a-zA-Z/][^>]*>/.test(text);
  const banner = text.startsWith('#');
  const marker = text.includes('--- Page');
  if (!text?.length || html || banner || marker) { console.log(`FAIL  body shape ${f}`); bad = 1; }
  else console.log(`PASS  body shape ${f} (len=${text.length})`);
}
process.exit(bad);
EOF
[ $? -ne 0 ] && fail=1

echo "== 5) token signature round trip =="
tok1=$(grep -i '^x-visitor-token:' /tmp/rt_h1.txt | tr -d '\r' | awk '{print $2}')
cookie=$(grep -i '^set-cookie: userData=' /tmp/rt_h1.txt | sed 's/^[Ss]et-[Cc]ookie: //' | cut -d';' -f1)
code=$(curl -s "$BASE/api/submit" -X POST -H 'Content-Type: application/json' \
  -H "Cookie: $cookie" -d '{"text":"round trip"}' -D /tmp/rt_h4.txt -o /tmp/rt_b4.json -w '%{http_code}')
check "replay -> 202" 202 "$code"
tok2=$(grep -i '^x-visitor-token:' /tmp/rt_h4.txt | tr -d '\r' | awk '{print $2}')
check "X-Visitor-Token stable" "$tok1" "$tok2"

echo "== 6) engine raw pull =="
submit=$(node -e "console.log(JSON.parse(fs.readFileSync('/tmp/rt_b3.json','utf8')).submitId)" 2>/dev/null \
  || python3 -c "import json;print(json.load(open('/tmp/rt_b3.json'))['submitId'])")
code=$(curl -s "$BASE/api/hidden/raw/$submit" -H "X-API-Key: $KEY" -o /tmp/rt_raw.txt -w '%{http_code}')
check "raw pull -> 200" 200 "$code"
code=$(curl -s -o /dev/null "$BASE/api/hidden/raw/$submit" -H "X-API-Key: wrong" -w '%{http_code}')
check "bad key -> 403" 403 "$code"

echo "== 7) Site -> Private engine bridge (file submissions) =="
# Requires the engine api-server running: PORT=9000 node Private/monoSyllabism/api-server.js
node - <<'EOF'
import fs from 'fs';
let bad = 0;
for (const [name, f] of [['PDF', '/tmp/rt_b2.json'], ['DOCX', '/tmp/rt_b3.json']]) {
  const d = JSON.parse(fs.readFileSync(f, 'utf8'));
  const e = d.engine || {};
  if (!e.connected) { console.log(`FAIL  ${name} engine push (${e.error || 'no engine block'})`); bad = 1; continue; }
  if (e.engineHash !== d.submitId) { console.log(`FAIL  ${name} engineHash != submitId`); bad = 1; }
  else console.log(`PASS  ${name} engine push, hash==submitId (${e.syllableCount} lines)`);
  if (name === 'DOCX') {
    if (e.docxPath && fs.existsSync(e.docxPath)) console.log(`PASS  DOCX result rewritten -> ${e.docxPath}`);
    else { console.log('FAIL  DOCX result not rewritten'); bad = 1; }
  }
}
process.exit(bad);
EOF
[ $? -ne 0 ] && fail=1

echo "== 8) engine-initiated handshake: engine presents, praser responds with text =="
KEY="$KEY" DOCX="$DOCX" node - <<'EOF'
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
const ENGINE = 'http://127.0.0.1:9000';
const PRASER = process.env.PRASER_ENDPOINT || 'http://127.0.0.1:5055';
const KEY = process.env.KEY;        // FSM_KEY — hidden-side routes only
const DOCX = process.env.DOCX;      // small raw-Zawgyi fixture
const checks = [];
function check(name, ok, extra = '') {
  checks.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' (' + extra + ')' : ''}`);
}
const sid = () => crypto.randomUUID();
const H = 'x'.repeat(32);
const id0 = sid();

// a real praser job: forward the fixture binary (multipart) to the service
async function preview() {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(DOCX)]), path.basename(DOCX));
  const r = await fetch(`${PRASER}/api/preview`, { method: 'POST', body: fd });
  const j = await r.json();
  check('praser /api/preview -> job + content', r.status === 200 && !!j.job_id && !!j.content);
  return j;
}
const bindMeta = (id) => ({
  submitId: id, filename: `${id}.docx`, userId: 'u-1', sessionId: H, formId: 'f-1',
});
async function bind(jobId, meta) {
  return fetch(`${PRASER}/api/engine/bind`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, metadata: meta }) });
}
async function collect(meta) {
  return fetch(`${PRASER}/api/engine/collect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta) });
}
async function fsm(id, meta) {
  return fetch(`${ENGINE}/fsm`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': KEY },
    body: JSON.stringify({ ...meta, status: 'pending', submitId: id }) });
}
async function result(id) {
  return fetch(`${ENGINE}/result/${id}`, { headers: { 'X-API-Key': KEY } });
}

// 1-3) job + one-shot binding
const j1 = await preview();
let r = await bind(j1.job_id, bindMeta(id0));
check('bind identity onto job', r.status === 200, String(r.status));
r = await bind(j1.job_id, bindMeta(id0));
check('second bind refused (one-shot)', r.status === 403, String(r.status));

// 4-5) the ENGINE-initiated handshake: deliver (keyed) -> engine presents
//      to the praser -> praser RESPONDS WITH THE TEXT -> engine processes
r = await fsm(id0, bindMeta(id0));
check('hidden delivery (keyed /fsm)', r.status === 200, String(r.status));
let done = null;
for (let i = 0; i < 60; i++) {
  const rr = await result(id0);
  const jj = await rr.json();
  if (jj.done || jj.error) { done = jj; break; }
  await new Promise((res) => setTimeout(res, 500));
}
check('engine collected + processed (hash==submitId)',
  done?.done === true && done.engineHash === id0, JSON.stringify(done?.engineHash ?? done));

// 6) collect with an UNKNOWN id -> 404 (not ready, nothing echoed)
r = await collect(bindMeta(sid()));
check('collect unknown id -> 404 (engine keeps waiting)', r.status === 404, String(r.status));

// 7) tampered presentation burns the binding (no chaining)
const j2 = await preview();
const id2 = sid();
await bind(j2.job_id, bindMeta(id2));
r = await collect({ ...bindMeta(id2), userId: 'intruder' });
check('tampered presentation -> 403 (binding burned)', r.status === 403, String(r.status));
r = await collect(bindMeta(id2)); // now the honest metadata finds nothing
check('honest presentation after burn -> 404 (no retry)', r.status === 404, String(r.status));

// 8) /result is keyed
r = await fetch(`${ENGINE}/result/${id0}`);
check('engine /result without key -> 403', r.status === 403, String(r.status));

process.exit(checks.every(Boolean) ? 0 : 1);
EOF
[ $? -ne 0 ] && fail=1


echo "== 9) engine handshake gate: the KEY guards hidden -> engine (/fsm) =="
KEYV="$(grep '^FSM_KEY=' "$ROOT/.env" | cut -d= -f2)"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

# /health stays open (liveness, no key)
check "engine /health open (no key)" 200 "$(code http://127.0.0.1:9000/health)"

# /fsm: no key -> 403
check "engine /fsm: no key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -d '{}')"

# /fsm: wrong key -> 403
check "engine /fsm: wrong key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H 'X-API-Key: wrong-key' -d '{}')"

# /fsm: right key, evil origin -> 403
check "engine /fsm: foreign origin -> 403" 403 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -H 'Origin: https://evil.example' -d '{}')"

# /fsm: right key, allowed origin (localhost:3000) -> GATE PASSES (400 = body validation, not 403)
check "engine /fsm: localhost:3000 origin passes gate" 400 "$(code -X POST http://127.0.0.1:9000/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -H 'Origin: http://localhost:3000' -d '{}')"

# /process is keyed now (engine-local srcPath only)
check "engine /process without key -> 403" 403 "$(code -X POST http://127.0.0.1:9000/process -H 'Content-Type: application/json' -d '{"srcPath":"/etc/hostname"}')"

# caller-IP gate: second engine instance whose allowlist EXCLUDES loopback
PORT=9005 ENGINE_ALLOWED_IPS=10.0.0.99 node "$ROOT/Private/monoSyllabism/api-server.js" >/tmp/eng9005.log 2>&1 &
EPID=$!
for i in 1 2 3 4 5 6; do curl -s -o /dev/null http://127.0.0.1:9005/health && break; sleep 0.5; done
check "engine /fsm: caller ip not allow-listed -> 403" 403 "$(code -X POST http://127.0.0.1:9005/fsm -H 'Content-Type: application/json' -H "X-API-Key: $KEYV" -d '{}')"
kill "$EPID" 2>/dev/null

echo "== 10) zip-bomb guard: the praser refuses decompression bombs =="
BOMB="$ROOT/Site/Public/PRASER/Python/.output/bomb.docx"
python3 - "$BOMB" <<'PYBOMB'
import sys, zipfile
# ~512 MB of zeros in a ~500 KB docx — built in constant memory
with zipfile.ZipFile(sys.argv[1], "w", zipfile.ZIP_DEFLATED) as z:
    with z.open("word/document.xml", "w") as f:
        chunk = b"\x00" * (1 << 20)
        for _ in range(512):
            f.write(chunk)
PYBOMB
code=$(curl -s -o /tmp/rt_bomb.json -w '%{http_code}' -X POST "${PRASER_ENDPOINT:-http://127.0.0.1:5055}/api/preview" -F "file=@$BOMB;filename=bomb.docx")
if [ "$code" = "400" ] && grep -qi "bomb\|cap" /tmp/rt_bomb.json; then
  check "praser refuses zip-bomb docx (512MB bomb)" 400 "$code"
else
  check "praser refuses zip-bomb docx (512MB bomb)" 400 "got $code: $(head -c 120 /tmp/rt_bomb.json)"
fi
check "praser still healthy after bomb" 200 "$(curl -s -o /dev/null -w '%{http_code}' ${PRASER_ENDPOINT:-http://127.0.0.1:5055}/health)"
rm -f "$BOMB"

PRASER_KEYV="$(grep '^PRASER_KEY=' "$ROOT/.env" | cut -d= -f2)"
check "praser machine-boundary: non-machine source refused" 403 "$(curl -s --interface 169.254.0.21 -o /dev/null -w '%{http_code}' http://127.0.0.1:5055/health)"
check "praser machine-boundary: key holder accepted" 200 "$(curl -s --interface 169.254.0.21 -H "X-Praser-Key: $PRASER_KEYV" -o /dev/null -w '%{http_code}' http://127.0.0.1:5055/health)"

[ "$fail" = 0 ] && echo "ALL PASS" || echo "SOME FAILURES"
exit "$fail"
