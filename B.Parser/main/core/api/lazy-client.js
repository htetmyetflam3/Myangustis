// Lazy dispatcher client — sends a JSON request to the Unix socket server.
// Usage:
//   node lazy-client.js '{"caller":"local","object":{...},"method":"extracting"}'
//   echo '{"caller":"local",...}' | node lazy-client.js

import { createConnection } from "node:net";

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
try { request = JSON.parse(requestText); } catch {
  process.stderr.write("Invalid JSON request\n");
  process.exit(1);
}

const socket = createConnection(SOCKET_PATH, () => {
  socket.write(JSON.stringify(request) + "\n");
  // Don't call end() — server ends the socket after responding
});

let response = "";
socket.on("data", (chunk) => { response += chunk; });
socket.on("end", () => {
  process.stdout.write(response.trim() + "\n");
  process.exit(0);
});
socket.on("error", (error) => {
  process.stderr.write(`Cannot connect to lazy dispatcher: ${error.message}\n`);
  process.stderr.write("Start it with: node lazy-dispatcher.js\n");
  process.exit(1);
});
