#!/usr/bin/env node



















import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import "../../index-path.js";

import { abs, FRONTEND_DIR } from "../../F.Site/Backend/file/paths.js";
import { GetOutputDir, resolvePath } from "../../Architecture/host/path.js";

const SITE = `http://127.0.0.1:${process.env.SITE_PORT || process.env.PORT || 3000}`;
const ENGINE = `http://127.0.0.1:${process.env.ENGINE_PORT || 9000}`;
const SPA = `http://127.0.0.1:${process.env.SPA_PORT || 5173}`;
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS || 30_000);

const C = process.stdout.isTTY
  ? { r: "\x1b[31m", g: "\x1b[32m", y: "\x1b[33m", d: "\x1b[2m", b: "\x1b[1m", x: "\x1b[0m" }
  : { r: "", g: "", y: "", d: "", b: "", x: "" };

let failures = 0;
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  const tag = ok ? `${C.g}PASS${C.x}` : `${C.r}FAIL${C.x}`;
  console.log(`${tag}  ${name}${detail ? ` ${C.d}(${detail})${C.x}` : ""}`);
  if (!ok) failures++;
}
const note = (msg) => console.log(`${C.y}SKIP${C.x}  ${msg}`);


async function reachable(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2_000), method: "GET" });
    return true;
  } catch {
    return false;
  }
}


const readEnvKey = (name) => process.env[name] || "";


const [siteUp, engineUp] = [await reachable(`${SITE}/csrf-token`), await reachable(`${ENGINE}/health`)];
if (!siteUp || !engineUp) {
  check("webs listening", false, `site:${siteUp ? "up" : "DOWN"} engine:${engineUp ? "up" : "DOWN"}`);
  console.log(`\n${C.d}start them: ./bootstrap.sh boot   (or: npm run dev + npm run dev:engine)${C.x}`);
  console.log(`${C.r}SOME FAILURES${C.x}`);
  process.exit(1);
}


const health = await fetch(`${ENGINE}/health`, { signal: AbortSignal.timeout(5_000) }).then((r) => r.json());
check("engine /health reports ok", health?.ok === true, `engine=${health?.engine} port=${health?.port}`);

const KEY = readEnvKey("ENGINE_KEY") || readEnvKey("FSM_KEY");
check("engine key resolvable from .env", !!KEY, KEY ? `${KEY.slice(0, 6)}…` : "FSM_KEY/ENGINE_KEY unset");




const ALLOWED = (readEnvKey("ENGINE_ALLOWED_ORIGINS") || "")
  .split(",").map((s) => s.trim().replace(/^https?:\/\//, "")).filter(Boolean);
const siteHost = new URL(SITE).host;
const originHost = ALLOWED.find((h) => h === siteHost)
  ?? ALLOWED.find((h) => h.endsWith(`:${new URL(SITE).port}`))
  ?? ALLOWED[0]
  ?? siteHost;
const ORIGIN = `http://${originHost}`;

const hash = crypto.randomUUID();
const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "linga-probe-"));
const probeFile = path.join(probeDir, "probe.txt");

fs.writeFileSync(probeFile, "ကျွန်တော် ဆန် စား တယ် ။\nမင်္ဂလာပါ ကမ္ဘာ ။\n", "utf8");

try {
  const t0 = Date.now();
  const proc = await fetch(`${ENGINE}/process`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",

      "X-API-Key": KEY,
      Origin: ORIGIN,
    },
    body: JSON.stringify({ srcPath: probeFile, hash }),
  });
  const body = await proc.json().catch(() => ({}));
  const gate = proc.status === 403 ? ` · gate rejected (key / caller IP / origin ${ORIGIN})` : "";
  check("engine POST /process → 200", proc.status === 200, `${Date.now() - t0}ms ${body.error || ""}${gate}`);
  check("engine returned syllable ids", Array.isArray(body.syllable) && body.syllable.length > 0, `${body.syllable?.length ?? 0} line(s)`);



  const outDir = resolvePath(GetOutputDir());
  const written = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter((f) => f.startsWith(`segmented_${hash}_`))
    : [];
  check("engine wrote segmented_<hash>_* to .output/txt", written.length >= 2, written.join(", ") || "nothing");
  const rawPos = written.find((f) => f.endsWith("raw_pos.txt"));
  if (rawPos) {
    const text = fs.readFileSync(path.join(outDir, rawPos), "utf8").trim();
    check("engine output is non-empty", text.length > 0, `${text.length} chars`);
  }
} catch (e) {
  check("engine POST /process", false, e.message);
} finally {
  fs.rmSync(probeDir, { recursive: true, force: true });
}


try {
  const res = await fetch(`${SITE}/api/submit`, {
    method: "POST",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "မင်္ဂလာပါ ကမ္ဘာ" }),
  });
  const body = await res.json().catch(() => ({}));
  check("site POST /api/submit → 202", res.status === 202, `${res.status} ${body.error || ""}`);
  check("site minted submitId + formId", !!body.submitId && !!body.formId, body.submitId || "none");
  check("site echoed the submitted text", (body.text || "").includes("မင်္ဂလာပါ"), `${(body.text || "").length} chars`);

  const bad = await fetch(`${SITE}/api/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("site rejects an empty submission (400)", bad.status === 400, String(bad.status));
} catch (e) {
  check("site /api/submit round trip", false, e.message);
}


const builtIndex = path.join(abs(FRONTEND_DIR), "index.html");
if (await reachable(SPA)) {
  const r = await fetch(SPA, { signal: AbortSignal.timeout(5_000) });
  const html = await r.text();
  check("spa dev server serves index.html", r.status === 200 && /<div id=|<app|@vite\/client/.test(html), `${r.status}, ${html.length} bytes on :${new URL(SPA).port}`);
} else if (fs.existsSync(builtIndex)) {
  const html = fs.readFileSync(builtIndex, "utf8");
  const served = await fetch(`${SITE}/`, { signal: AbortSignal.timeout(5_000) });
  check("built SPA served by the site web", served.status === 200 && html.includes("<"), `${html.length} bytes from frontend/`);
  note(`vite dev (:${new URL(SPA).port}) not running — the SPA is served from R_Site/Build/spa/frontend`);
} else {
  check("spa available (dev server or built output)", false, `no vite on :${new URL(SPA).port} and no ${path.relative(process.cwd(), builtIndex)} — run: npm run build`);
}


const passed = results.filter((r) => r.ok).length;
console.log(`\n${C.b}── probe: ${passed}/${results.length} checks passed ──${C.x}`);
console.log(`${C.d}   site ${SITE} · engine ${ENGINE} · spa ${SPA}${C.x}`);
if (failures) {
  console.log(`${C.r}SOME FAILURES${C.x}`);
  process.exit(1);
}
console.log(`${C.g}ALL PASS — three webs wired${C.x}`);
