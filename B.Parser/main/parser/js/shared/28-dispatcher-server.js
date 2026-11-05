// Alive dispatcher service entry point.
// Runs as a long-running systemd service that Site and Python callers connect to.
// Accepts JSON on stdin/stdout: { caller: "site"|"local", filePath|object, method, identity? }
// Responds with { ok: true, result } or { ok: false, error }.
import { createServer } from "node:http";
import { dispatchSite, dispatchLocal } from "./27-dispatcher.js";

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

  const { caller, object, method, filePath, identity } = request;
  try {
    let result;
    if (caller === "site") {
      if (!filePath) throw new Error("site caller requires filePath");
      result = await dispatchSite({ filePath, method, identity });
    } else if (caller === "local") {
      if (!object) throw new Error("local caller requires object");
      result = await dispatchLocal({ object, method, identity });
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
