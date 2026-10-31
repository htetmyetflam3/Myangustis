#!/usr/bin/env node
// Separate JavaScript and Python parsers were planned and may be revisited;
// for now Python invokes the JavaScript Manager in this child process.
import fs from "node:fs/promises";
import { getOwnerKeyMatcher } from "../_path.js";
import { Manager } from "../main/parser/manager.js";

async function main() {
  const ownerRequest = process.argv[2] === "--owner-request";
  let input = "";
  let header = "";
  let ownerKey;
  let verified = false;
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    if (ownerRequest && !verified) {
      header += chunk;
      const end = header.indexOf("\n");
      if (end < 0) {
        if (header.length > 1_000_000) throw new Error("Manager request is too large");
        continue;
      }
      if (end > 1_000_000) throw new Error("Manager request is too large");
      try {
        ownerKey = JSON.parse(header.slice(0, end)).ownerKey;
      } catch {
        throw new Error("Invalid owner authorization");
      }
      const keyMatches = await getOwnerKeyMatcher();
      if (!keyMatches(ownerKey)) throw new Error("Invalid owner key");
      verified = true;
      input += header.slice(end + 1);
      header = "";
    } else {
      input += chunk;
      if (!ownerRequest && input.length > 1_000_000) throw new Error("Manager request is too large");
    }
  }
  if (ownerRequest && !verified) throw new Error("Missing owner authorization");
  if (process.argv[2] === "--verify-owner") {
    const keyMatches = await getOwnerKeyMatcher();
    if (!keyMatches(input)) throw new Error("Invalid owner key");
    return;
  }
  let request;
  try {
    request = JSON.parse(input);
  } catch {
    throw new Error("Invalid Manager request");
  }
  if (typeof request?.responsePath !== "string" || !request.responsePath) {
    throw new Error("Manager response path is required");
  }
  const manager = new Manager();
  try {
    const options = { ownerKey: ownerRequest ? ownerKey : request.ownerKey };
    const result = request.operation === "renderText"
      ? await manager.renderPlainText(request.job ?? {}, options)
      : await manager.dispatch(request.job ?? {}, request.caller ?? "site", options);
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
