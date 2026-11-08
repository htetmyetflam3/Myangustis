/*
(Support 9) Shared support, no chain position - a long-running dispatcher service.
This module is the always-on service entry: Site and Python callers connect over HTTP/JSON, and requests are routed to the site or local dispatch without the service reading files itself.
*/
// Alive dispatcher service entry point.
// Runs as a long-running systemd service that Site and Python callers connect to.
// Accepts JSON on stdin/stdout: { caller: "site"|"local", object, method, identity? }
// Responds with { ok: true, result } or { ok: false, error }.
// Lazy loads heavy modules only on first request.
// The dispatcher does NOT read files — caller passes objects directly.
import { createServer } from "node:http";

let dispatchSite = null;
let dispatchLocal = null;

async function ensureLoaded() {
  if (!dispatchSite) {
    const mod = await import("../../core/api/dispatcher.js");
    dispatchSite = mod.dispatchSite;
    dispatchLocal = mod.dispatchLocal;
  }
}

const PORT = Number(process.env.PARSER_DISPATCHER_PORT || 8099);

function jsonResponse(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { ok: false, error: "POST only" });
  }
  let body = "";
  for await (const chunk of req) {
    body += chunk;
  }
  let request;
  try {
    request = JSON.parse(body);
  } catch {
    return jsonResponse(res, 400, { ok: false, error: "Invalid JSON" });
  }

  try {
    await ensureLoaded();
    const { caller, object, method, identity } = request;
    // `method` here names the job (extracting/ocr); the dispatcher takes a
    // job object plus the default mode. One shape, built here.
    const job = { job: method === "ocr" ? "ocr" : "extracting", method: "default" };
    let result;
    if (caller === "site") {
      if (!object) throw new Error("site caller requires object");
      result = await dispatchSite({ object, method: "default", identity, job });
    } else if (caller === "local") {
      if (!object) throw new Error("local caller requires object");
      result = await dispatchLocal({ object, method: "default", identity, job });
    } else {
      throw new Error(`Unknown caller: ${caller}`);
    }
    jsonResponse(res, 200, { ok: true, result });
  } catch (error) {
    jsonResponse(res, 500, { ok: false, error: error?.message ?? String(error) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  process.stdout.write(`Parser dispatcher listening on 0.0.0.0:${PORT}\n`);
});

process.on("SIGINT", () => server.close(() => process.exit(0)));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
