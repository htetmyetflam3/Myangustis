/*
(new/service) Service activation, in front of the door.
systemd owns the listening socket and no parser process exists while
idle: the first connection wakes this service (the socket hands the
already-listening socket over on fd 3), requests are served, and the
process exits itself after the idle window. Two functions:
  serveService - the woken side: serve InitInput to whoever connects
  callService  - the calling side: connect (which wakes the service),
                 send the payload, read the answer
Wire protocol, deliberately simple: one JSON header line
({ filename?, caller? }), then the raw payload bytes; the caller
half-closes to end the payload. One JSON line answers:
{ ok: true, result } or { ok: false, error }.
Nothing is held whole on either side: the woken side streams the
socket into the door as it arrives, the calling side streams its
payload out the same way.
Pair with myangustis-new.socket / myangustis-new.service in this dir;
enable ONLY the socket, never the service.
*/
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InitInput } from "../init.js";

export const SOCKET_PATH = process.env.PARSER_SOCKET_PATH || "/tmp/myangustis-new-parser.sock";
const IDLE_MS = Number(process.env.PARSER_IDLE_MS ?? 300_000);

// The fd systemd hands over on socket activation (first passed fd = 3),
// or null when this process was started some other way.
export function activatedFd() {
  const fds = Number(process.env.LISTEN_FDS ?? 0);
  const pid = Number(process.env.LISTEN_PID ?? 0);
  return fds > 0 && (pid === 0 || pid === process.pid) ? 3 : null;
}

function serializable(result) {
  if (!result || typeof result !== "object") return result;
  const { object, ...rest } = result;
  return object === undefined ? rest : { ...rest, streamed: true };
}

// --- function 1: the woken side --------------------------------------------
export async function serveService(handler = InitInput, { idleMs = IDLE_MS } = {}) {
  let idleTimer = null;
  const armIdle = () => {
    if (!Number.isFinite(idleMs) || idleMs <= 0) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 1_000).unref();
    }, idleMs);
    idleTimer.unref();
  };
  // allowHalfOpen: the caller half-closes to end the payload, and the
  // answer is written after async work - the socket must stay writable.
  const server = net.createServer({ allowHalfOpen: true }, (socket) => {
    armIdle();
    (async () => {
      try {
        // Read the header line off the stream, then hand the REST of
        // the socket to the door as a live chunk generator - the
        // payload is never gathered into one buffer.
        // destroyOnReturn false: a stream async iterator destroys its
        // socket on completion by default, which would kill the
        // writable side before the answer can be written.
        const iterator = typeof socket.iterator === "function"
          ? socket.iterator({ destroyOnReturn: false })
          : socket[Symbol.asyncIterator]();
        let pending = Buffer.alloc(0);
        let header = null;
        let leftover = null;
        while (header === null) {
          const { done, value } = await iterator.next();
          if (done) throw new TypeError("service: header line missing");
          pending = pending.length ? Buffer.concat([pending, value]) : value;
          if (pending.length > 64 * 1024) throw new TypeError("service: header line too long");
          const nl = pending.indexOf(0x0a);
          if (nl !== -1) {
            header = JSON.parse(pending.subarray(0, nl).toString("utf8"));
            leftover = pending.subarray(nl + 1);
          }
        }
        async function* payload() {
          if (leftover?.length) yield leftover;
          let step;
          while (!(step = await iterator.next()).done) yield step.value;
        }
        const result = await handler(
          { object: payload(), filename: header.filename ?? null },
          header.caller ?? "service",
        );
        socket.end(JSON.stringify({ ok: true, result: serializable(result) }) + "\n");
      } catch (err) {
        socket.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }) + "\n");
      } finally {
        armIdle();
      }
    })().catch(() => {});
  });
  const fd = activatedFd();
  if (fd !== null) {
    server.listen({ fd }, () => console.log("parser service: woken by systemd socket activation"));
  } else {
    server.listen(SOCKET_PATH, () => console.log("parser service: listening on " + SOCKET_PATH));
  }
  armIdle();
  return server;
}

// --- function 2: the calling side ------------------------------------------
// Connect - which is what makes systemd start the service - send the
// payload, and read the one-line answer.
export function callService(trigger, { socketPath = SOCKET_PATH, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("service: timed out waiting for the parser service"));
    }, timeoutMs);
    const chunks = [];
    socket.on("connect", async () => {
      try {
        const header = JSON.stringify({ filename: trigger.filename ?? null, caller: trigger.caller ?? "service" });
        socket.write(header + "\n");
        if (trigger.object instanceof Uint8Array) {
          socket.write(trigger.object);
        } else if (trigger.object && typeof trigger.object[Symbol.asyncIterator] === "function") {
          for await (const chunk of trigger.object) socket.write(chunk);
        }
        socket.end();
      } catch (err) {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      }
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      clearTimeout(timer);
      try {
        const reply = JSON.parse(Buffer.concat(chunks).toString("utf8").trim());
        if (!reply.ok) reject(new Error("service: " + (reply.error || "parser service failed")));
        else resolve(reply.result);
      } catch (err) {
        reject(err);
      }
    });
    socket.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// Run directly (the .service does exactly this): serve until idle-exit.
const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  serveService().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
