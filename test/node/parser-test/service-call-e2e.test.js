import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildTriggerRequest } from "../../../B.Parser/integration/services/trigger-request.js";

// End-to-end: a service (scraper) caller parses a real PDF through the
// socket service boundary exactly as a service call does:
//
//   buildTriggerRequest(caller: "scraper")   queue -> trigger contract
//   -> lazy-client.js                        JSON over the unix socket
//   -> lazy-dispatcher.js                    caller routing (dispatchServices)
//   -> core/api/dispatcher.js                worker assignment
//   -> manager pool -> core/worker/converter.js (auto PDF/DOCX)
//   -> parsed pages come back in the response
//
// Nothing here calls parser internals directly.

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const dispatcherScript = path.join(repo, "B.Parser", "integration", "services", "lazy-dispatcher.js");
const clientScript = path.join(repo, "B.Parser", "integration", "services", "lazy-client.js");
const samplePdf = path.join(repo, "B.Parser/host", "Frontend", "frontend-bootstrap", "public", "samples", "sample.pdf");
const SOCKET_PATH = "/tmp/myangustis-parser.sock";

function qpdfEnv(dir) {
  // An explicitly configured qpdf (PRASER_QPDF_BIN) always wins. Production
  // runs a system qpdf. Where none exists, fall back to the copy-through
  // shim the other parser tests use: prepare steps copy input -> output
  // and the parser decodes the streams itself.
  if (process.env.PRASER_QPDF_BIN) return {};
  if (spawnSync("qpdf", ["--version"], { stdio: "ignore" }).status === 0) return {};
  const shim = path.join(dir, "qpdf");
  fs.writeFileSync(shim, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") process.exit(0);
fs.copyFileSync(args.at(-2), args.at(-1));
`);
  fs.chmodSync(shim, 0o755);
  return { PRASER_QPDF_BIN: shim };
}

function run(command, args, { env = {}, input = null, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timed out after ${timeoutMs}ms: ${command}\n${stderr}`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input !== null) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function startDispatcher(env) {
  const child = spawn(process.execPath, [dispatcherScript], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`dispatcher did not start: ${stderr}`)), 30000);
    child.stdout.on("data", (chunk) => {
      if (String(chunk).includes("Lazy dispatcher listening")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`dispatcher exited early (${code}): ${stderr}`));
    });
  });
  return child;
}

test("service caller (scraper) parses the shipped PDF end to end", { timeout: 300000 }, async () => {
  assert.ok(fs.existsSync(samplePdf), `sample PDF missing: ${samplePdf}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "service-e2e-"));
  const server = await startDispatcher(qpdfEnv(dir));
  try {
    const trigger = buildTriggerRequest({
      job: "extracting",
      caller: "scraper",
      key: "converter",
      output: "txt",
      method: "default",
      object: {
        path: samplePdf,
        filename: "sample.pdf",
        size: fs.statSync(samplePdf).size,
      },
    });
    // The service-caller profile on the trigger contract.
    assert.equal(trigger.caller, "scraper");
    assert.equal(trigger.worker, "serviceworker");
    assert.equal(trigger.limit, 3);
    assert.equal(trigger.key, "converter");
    assert.equal(trigger.output, "txt");

    const call = await run(process.execPath, [clientScript, JSON.stringify(trigger)], { timeoutMs: 240000 });
    assert.equal(call.code, 0, `lazy-client failed: ${call.stderr}`);
    const response = JSON.parse(call.stdout.trim().split("\n").at(-1));
    assert.equal(response.ok, true, `service call failed: ${call.stdout} ${call.stderr}`);

    const result = response.result;
    assert.ok(Number.isInteger(result.npages) && result.npages >= 1, "expected at least one parsed page");
    assert.ok(Array.isArray(result.pages) && result.pages.length >= 1, "expected page results");
    const text = result.pages.map((page) => page.text ?? "").join("\n");
    assert.ok(text.length > 0, "expected parsed text in the service response");
    assert.match(text, /[\u1000-\u109f]/u, "expected Myanmar text in the parsed output");
    assert.ok(result.counts && typeof result.counts === "object", "expected page category counts");
  } finally {
    server.kill("SIGTERM");
    await new Promise((resolve) => server.on("exit", resolve));
    fs.rmSync(SOCKET_PATH, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
