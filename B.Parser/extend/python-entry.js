#!/usr/bin/env node
// Separate JavaScript and Python parsers were planned and may be revisited;
// for now Python invokes the JavaScript Manager in this child process.
import fs from "node:fs/promises";
import { Manager } from "../main/parser/manager.js";

async function main() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 1_000_000) throw new Error("Manager request is too large");
  }
  const request = JSON.parse(input);
  if (typeof request.responsePath !== "string" || !request.responsePath) {
    throw new Error("Manager response path is required");
  }
  const manager = new Manager();
  try {
    const result = request.operation === "renderText"
      ? await manager.renderPlainText(request.job ?? {})
      : await manager.dispatch(request.job ?? {}, request.caller ?? "site");
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
