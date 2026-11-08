/*
(Support 10) Shared support, no chain position - client of the lazy dispatcher (Support 11).
This module sends one JSON request to the dispatcher's Unix socket and prints the answer. The six trigger parameters are forwarded exactly as given.
*/
// Lazy dispatcher client — sends a JSON request to the Unix socket server.
// Usage:
//   node lazy-client.js '{"job":"ocr","caller":"public","limit":1,"worker":"publicworker","key":"ocr","output":"txt","object":{...},"method":"default"}'
//   echo '{"job":"ocr","caller":"public","limit":1,"worker":"publicworker","key":"ocr","output":"txt",...}' | node lazy-client.js
//
// The six trigger params (job/caller/limit/worker/key/output) are validated
// here and forwarded as-is — the client never drops or rewrites the limit,
// the worker key, or the output type.

import { createConnection } from "node:net";
import { normalizeTriggerRequest } from "./trigger-request.js";

const SOCKET_PATH = "/tmp/myangustis-parser.sock";

const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const stdinText = Buffer.concat(input).toString("utf8").trim();
const argText = process.argv.slice(2).join(" ");
const requestText = stdinText || argText;

if (!requestText) {
  process.stderr.write("Usage: node lazy-client.js '<json-request>'\n");
  process.exit(1);
}

let request;
try { request = normalizeTriggerRequest(JSON.parse(requestText)); } catch (error) {
  process.stderr.write(`${error?.message ?? "Invalid JSON request"}\n`);
  process.exit(1);
}

const socket = createConnection(SOCKET_PATH, () => {
  socket.write(JSON.stringify(request) + "\n");
  // Don't call end() — server ends the socket after responding
});

let response = "";
socket.on("data", (chunk) => { response += chunk; });
socket.on("end", () => {
  // Exit only once the response has drained: parse results can be far
  // larger than a pipe buffer, and process.exit() would truncate them.
  process.stdout.write(response.trim() + "\n", () => process.exit(0));
});
socket.on("error", (error) => {
  process.stderr.write(`Cannot connect to lazy dispatcher: ${error.message}\n`);
  process.stderr.write("Start it with: node lazy-dispatcher.js\n");
  process.exit(1);
});
