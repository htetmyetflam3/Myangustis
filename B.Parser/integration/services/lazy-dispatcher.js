/*
(Support 11) Shared support, no chain position - the on-demand dispatcher server.
This module listens on a Unix socket, starts only when a caller requests it, validates the six trigger parameters, routes the job, and exits after an idle timeout.
*/
// Lazy on-demand dispatcher server.
// Listens on a Unix socket. Starts only when a caller requests it.
// Auto-exits after idle timeout so no process sits around wasting memory.
//
// Usage:
//   node lazy-dispatcher.js      # start server (runs until idle timeout)
//   echo '{"job":"ocr","caller":"public","limit":1,"worker":"publicworker","key":"ocr","output":"txt",...}' | node lazy-client.js
//
// Trigger contract: every request carries job/caller/limit/worker/key/
// output. The dispatcher validates the six, logs caller + a unique
// timestamp, then forwards the request to the parser as-is — limit, worker
// key, and output type included, nothing dropped.

import { createServer } from "node:net";
import fs from "node:fs";
import { normalizeTriggerRequest } from "./trigger-request.js";

const SOCKET_PATH = "/tmp/myangustis-parser.sock";
const IDLE_TIMEOUT_MS = 300000;   // 5 minutes — auto-exit if no requests
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds — max time per request

let routines = null;
let idleTimer = null;
let requestSeq = 0;

async function ensureLoaded() {
  if (!routines) {
    const mod = await import("../../core/api/dispatcher.js");
    routines = {
      public: mod.dispatchSite,
      owner: mod.dispatchLocal,
      scraper: mod.dispatchServices,
    };
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

async function handleRequest(request) {
  const trigger = normalizeTriggerRequest(request);
  // Log only who called and a unique timestamp — the request itself is
  // forwarded unchanged, so its limit/worker reach the worker.
  process.stdout.write(`${trigger.caller} ${Date.now()}-${++requestSeq}\n`);
  const routine = routines[trigger.caller];
  if (typeof routine !== "function") throw new Error(`Unknown caller: ${trigger.caller}`);
  // The trigger contract carries `job` as a plain string; the dispatcher
  // takes a job object. Convert once, here at the service boundary.
  return routine({
    ...request,
    job: { job: trigger.job, method: request.method ?? "default" },
  });
}

const server = createServer((socket) => {
  resetIdleTimer();
  let data = "";
  let handled = false;

  const finish = (text) => {
    if (handled) return;
    handled = true;
    clearTimeout(reqTimeout);
    let request;
    try { request = JSON.parse(text); } catch {
      jsonResponse(socket, { ok: false, error: "Invalid JSON" });
      return;
    }
    (async () => {
      try {
        await ensureLoaded();
        const result = await handleRequest(request);
        jsonResponse(socket, { ok: true, result });
      } catch (error) {
        jsonResponse(socket, { ok: false, error: error?.message ?? String(error) });
      }
    })();
  };

  const reqTimeout = setTimeout(() => {
    if (!handled) {
      handled = true;
      jsonResponse(socket, { ok: false, error: "Request timeout" });
    }
  }, REQUEST_TIMEOUT_MS);
  reqTimeout.unref?.();

  socket.on("data", (chunk) => {
    data += chunk.toString("utf8");
    const newlineIdx = data.indexOf("\n");
    if (newlineIdx >= 0) finish(data.slice(0, newlineIdx).trim());
  });
  socket.on("end", () => {
    if (!handled && data.trim()) finish(data.trim());
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
