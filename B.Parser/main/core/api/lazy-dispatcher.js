// Lazy on-demand dispatcher server.
// Listens on a Unix socket. Starts only when a caller requests it.
// Auto-exits after idle timeout so no process sits around wasting memory.
//
// Usage:
//   node lazy-dispatcher.js      # start server (runs until idle timeout)
//   echo '{"caller":"local",...}' | node lazy-client.js   # send request
//
// Or use lazy-parser.sh wrapper which handles start + request in one call.

import { createServer } from "node:net";
import fs from "node:fs";
import path from "node:path";

const SOCKET_PATH = "/tmp/myangustis-parser.sock";
const IDLE_TIMEOUT_MS = 300000;   // 5 minutes — auto-exit if no requests
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds — max time per request

let dispatchSite = null;
let dispatchLocal = null;
let idleTimer = null;

async function ensureLoaded() {
  if (!dispatchSite) {
    const mod = await import("./dispatcher.js");
    dispatchSite = mod.dispatchSite;
    dispatchLocal = mod.dispatchLocal;
  }
}

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    process.stdout.write("Lazy dispatcher: idle timeout, exiting\n");
    server.close();
    process.exit(0);
  }, IDLE_TIMEOUT_MS);
  idleTimer.unref?.();
}

function safeEnd(socket) {
  try { if (!socket.destroyed) socket.end(); } catch {}
}

function jsonResponse(socket, body) {
  const payload = JSON.stringify(body) + "\n";
  try {
    if (!socket.destroyed && socket.writable) socket.write(payload);
  } catch {}
  safeEnd(socket);
}

const server = createServer((socket) => {
  resetIdleTimer();
  let data = "";
  let handled = false;

  const reqTimeout = setTimeout(() => {
    if (!handled) {
      handled = true;
      jsonResponse(socket, { ok: false, error: "Request timeout" });
    }
  }, REQUEST_TIMEOUT_MS);
  reqTimeout.unref?.();

  socket.on("data", (chunk) => {
    data += chunk.toString("utf8");
    // Try to parse as soon as we have complete JSON (newline-delimited)
    const newlineIdx = data.indexOf("\n");
    if (newlineIdx >= 0 && !handled) {
      handled = true;
      clearTimeout(reqTimeout);
      const jsonText = data.slice(0, newlineIdx).trim();
      let request;
      try { request = JSON.parse(jsonText); } catch {
        jsonResponse(socket, { ok: false, error: "Invalid JSON" });
        return;
      }
      (async () => {
        try {
          await ensureLoaded();
          const { caller, object, method, identity, job } = request;
          let result;
          if (caller === "site") {
            result = await dispatchSite({ object, method, identity, job });
          } else if (caller === "local") {
            result = await dispatchLocal({ object, method, identity, job });
          } else {
            throw new Error(`Unknown caller: ${caller}`);
          }
          jsonResponse(socket, { ok: true, result });
        } catch (error) {
          jsonResponse(socket, { ok: false, error: error?.message ?? String(error) });
        }
      })();
    }
  });
  socket.on("end", () => {
    // If we haven't handled yet (no newline), try one last parse
    if (!handled && data.trim()) {
      handled = true;
      clearTimeout(reqTimeout);
      let request;
      try { request = JSON.parse(data.trim()); } catch {
        jsonResponse(socket, { ok: false, error: "Invalid JSON" });
        return;
      }
      (async () => {
        try {
          await ensureLoaded();
          const { caller, object, method, identity, job } = request;
          let result;
          if (caller === "site") {
            result = await dispatchSite({ object, method, identity, job });
          } else if (caller === "local") {
            result = await dispatchLocal({ object, method, identity, job });
          } else {
            throw new Error(`Unknown caller: ${caller}`);
          }
          jsonResponse(socket, { ok: true, result });
        } catch (error) {
          jsonResponse(socket, { ok: false, error: error?.message ?? String(error) });
        }
      })();
    }
  });
  socket.on("error", () => { /* socket already closed */ });
});

// Clean up old socket before binding
try { fs.unlinkSync(SOCKET_PATH); } catch {}

server.listen(SOCKET_PATH, () => {
  process.stdout.write(`Lazy dispatcher listening on ${SOCKET_PATH}\n`);
  resetIdleTimer();
});

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
