/*
(Support 11) Shared support, no chain position - the on-demand dispatcher server.
This module is the Unix-socket dispatcher. Under systemd socket activation (myangustis-parser.socket) no parser process exists until a connection arrives: systemd owns the socket, starts this service, and this process exits after an idle timeout. Started directly (or by lazy-parser.sh) it binds the socket itself. It validates the six trigger parameters and routes the job.
*/
// Lazy on-demand dispatcher server (Unix socket).
// Production wake-up is systemd socket activation: systemd holds the
// socket, this process is started per activation and auto-exits after
// the idle timeout, so no parser process sits around wasting memory.
// Direct start (lazy-parser.sh) still works: it binds the path itself.
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
const IDLE_TIMEOUT_MS = Number(process.env.PARSER_IDLE_MS ?? 300000); // 5 min default — auto-exit if no requests
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

// Two ways to get the listening socket:
//  1. systemd socket activation (the production socket path): systemd
//     owns SOCKET_PATH and hands the already-listening socket to this
//     process on fd 3 (LISTEN_FDS/LISTEN_PID). No parser process exists
//     until a connection arrives; after the idle timeout this process
//     exits and the next connection makes systemd start a fresh one.
//  2. Direct start (node lazy-dispatcher.js, or lazy-parser.sh): bind
//     the socket path ourselves, exactly as before.
// Under activation the socket file belongs to systemd — never unlink it.
const systemdActivated =
  Number(process.env.LISTEN_FDS ?? 0) >= 1 &&
  Number(process.env.LISTEN_PID ?? 0) === process.pid;

if (systemdActivated) {
  server.listen({ fd: 3 }, () => {
    process.stdout.write(`Lazy dispatcher socket-activated by systemd on ${SOCKET_PATH}\n`);
    resetIdleTimer();
  });
} else {
  // Clean up old socket before binding
  try { fs.unlinkSync(SOCKET_PATH); } catch {}

  server.listen(SOCKET_PATH, () => {
    process.stdout.write(`Lazy dispatcher listening on ${SOCKET_PATH}\n`);
    resetIdleTimer();
  });
}

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });
