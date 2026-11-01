#!/usr/bin/env node
// Python invokes the JavaScript Manager; it is not a separate parser.
import fs from "node:fs/promises";
import { Manager } from "../main/parser/manager.js";
import { muteAdvisories } from "../../Architecture/host/advisory.js";

const MAX_REQUEST_BYTES = 1_000_000;

async function readRequest(localStream, requestPath) {
  if (localStream) {
    if (!requestPath) throw new Error("Local Manager request path is required");
    if ((await fs.stat(requestPath)).size > MAX_REQUEST_BYTES) throw new Error("Manager request is too large");
    return JSON.parse(await fs.readFile(requestPath, "utf8"));
  }
  let input = "";
  let size = 0;
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    size += Buffer.byteLength(chunk, "utf8");
    if (size > MAX_REQUEST_BYTES) throw new Error("Manager request is too large");
    input += chunk;
  }
  return JSON.parse(input);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--quiet")) muteAdvisories();
  const positional = args.filter((arg) => arg !== "--quiet");
  if (positional[0] === "--mute-only" && positional.length === 1) {
    if (!args.includes("--quiet")) muteAdvisories();
    return;
  }
  const localStream = positional[0] === "--local-stream";
  if (positional[0] && !localStream) throw new Error("Unsupported Manager request mode");
  let request;
  try {
    request = await readRequest(localStream, positional[1]);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Invalid Manager request");
    throw error;
  }
  if (typeof request?.responsePath !== "string" || !request.responsePath) {
    throw new Error("Manager response path is required");
  }
  const manager = new Manager();
  try {
    let result;
    if (localStream) {
      // Python supplies the file bytes on stdin; Manager pulls them as a stream.
      result = await manager.dispatchStream(process.stdin, request.job ?? {});
    } else if (request.operation === "renderText") {
      result = await manager.renderPlainText(request.job ?? {});
    } else if (request.operation === undefined || request.operation === "dispatch") {
      result = await manager.dispatch(request.job ?? {}, request.caller ?? "site");
    } else {
      throw new Error("Unsupported Manager operation");
    }
    await fs.writeFile(request.responsePath, JSON.stringify(result), { encoding: "utf8", mode: 0o600 });
  } finally {
    await manager.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(`Python Manager bridge: ${error?.message ?? String(error)}`);
  process.exitCode = 1;
}
