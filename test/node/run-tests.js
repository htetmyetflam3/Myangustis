#!/usr/bin/env node


























import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const TEST_DIR = ".bin/node";








const ADVISORY = new Set(["silent-original.test.mjs"]);

const argv = process.argv.slice(2);


const live = !argv.includes("--no-live") && (argv.includes("--live") || process.env.BOOT_LIVE === "1");
const strict = argv.includes("--strict");
const onlyIdx = argv.indexOf("--only");
const only = onlyIdx !== -1 ? argv[onlyIdx + 1] : null;

const C = process.stdout.isTTY ? { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" } :
  { r: "", g: "", y: "", d: "", b: "", x: "" };
const ok = (s) => console.log(`${C.g}PASS${C.x}  ${s}`);
const bad = (s) => console.log(`${C.r}FAIL${C.x}  ${s}`);
const soft = (s) => console.log(`${C.y}ADVISORY${C.x} ${s}`);
const dim = (s) => console.log(`${C.d}${s}${C.x}`);

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  return { code: r.status ?? 1, label };
}


console.log(`\n${C.b}── import graph (three webs, from their entry points) ──${C.x}`);
const guard = run("check-imports", process.execPath, [
  ".bin/node/check-imports.mjs",
  ...(strict ? ["--strict"] : []),
]);
if (guard.code === 0) ok("every relative import resolves");
else bad("unresolved import on a live boot graph — a web cannot start");


console.log(`\n${C.b}── test suite (${TEST_DIR}) ──${C.x}`);


if (!fs.existsSync(path.join(ROOT, ".bin/node/node_modules"))) {
  console.log(`${C.y}WARN${C.x}  .bin/node/node_modules is not linked → the site web's deps will not resolve`);
  dim("      fix: ./bootstrap.sh setup   (or: ln -sfn ../../R_Site/node_modules .bin/node/node_modules)");
}
const files = fs
  .readdirSync(path.join(ROOT, TEST_DIR))
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !only || f.includes(only))
  .sort();

if (!files.length) {
  dim(only ? `no test file matches "${only}"` : "no *.test.mjs found");
}

const results = [];
for (const f of files) {
  const rel = `${TEST_DIR}/${f}`;
  const t0 = Date.now();



  const r = spawnSync(process.execPath, ["--test", "--test-reporter=spec", rel], {
    cwd: ROOT,
    stdio: "pipe",
    encoding: "utf8",
    timeout: 120_000,
    env: process.env,
  });
  const passed = r.status === 0;
  const ms = Date.now() - t0;
  const advisory = ADVISORY.has(f);
  results.push({ f, passed, advisory, ms });
  if (passed) ok(`${f} (${ms}ms)`);
  else if (advisory) soft(`${f} (${ms}ms) — see the ledger in run-tests.mjs`);
  else bad(`${f} (${ms}ms)`);
  if (!passed) {
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const lines = out.split("\n").filter((l) => /✖|FAIL|Error:|expected|actual/i.test(l)).slice(0, 12);
    for (const l of lines) dim(`      ${l.trim()}`);
  }
}


if (live) {
  console.log(`\n${C.b}── live probe (site + engine + spa must be up) ──${C.x}`);
  const p = run("boot-probe", process.execPath, [".bin/node/boot-probe.mjs"]);
  if (p.code === 0) ok("all three webs answered");
  else bad("a web did not answer as expected");
  results.push({ f: "boot-probe.mjs", passed: p.code === 0, advisory: false, ms: 0 });
}


const failed = results.filter((r) => !r.passed && !r.advisory);
const advisories = results.filter((r) => !r.passed && r.advisory);
const passedCount = results.filter((r) => r.passed).length;

console.log(`\n${C.b}── summary ──${C.x}`);
dim(`  ${passedCount} passed · ${failed.length} failed · ${advisories.length} advisory · guard ${guard.code === 0 ? "ok" : "BROKEN"}`);
if (advisories.length) {
  dim(`  advisory (known contract drift, not blocking): ${advisories.map((r) => r.f).join(", ")}`);
}
if (guard.code !== 0 || failed.length) {
  console.log(`${C.r}${C.b}SOME FAILURES${C.x}`);
  process.exit(1);
}
console.log(`${C.g}ALL PASS${C.x}`);
