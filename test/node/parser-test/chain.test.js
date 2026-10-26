import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let tempDir;
let output = "";

async function waitForSite() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`site exited before health check:\n${output}`);
    }
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`site did not become healthy:\n${output}`);
}

async function browserSession() {
  const response = await fetch(`${BASE}/csrf-token`, {
    headers: { "user-agent": "LingaPreproductionTest/1.0" },
  });
  assert.equal(response.status, 200);
  const { csrfToken } = await response.json();
  assert.match(csrfToken, /^[A-Za-z0-9_-]{43}$/);
  const setCookies = response.headers.getSetCookie();
  assert.ok(setCookies.some((value) => /^userData=.*HttpOnly/i.test(value)));
  const cookie = setCookies
    .map((value) => value.split(";", 1)[0])
    .join("; ");
  return { csrfToken, cookie };
}

function uploadIntent(uploadName, overrides = {}) {
  return {
    v: 1,
    task: "conversion",
    originalName: "sample.pdf",
    uploadName,
    inputFormat: "pdf",
    outputFormat: "txt",
    content: "text",
    job: "extracting",
    method: "default",
    clickedAt: new Date().toISOString(),
    detector: {
      name: "pdf.js",
      pages: 100,
      textPages: 100,
      imagePages: 0,
      myanmarChars: 1,
      myanmarLetters: 1,
      imageBytes: 0,
      textBytes: 1,
      confirmed: true,
    },
    ...overrides,
  };
}

function timestampedName(stem = "sample") {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `${stamp}__${stem}.pdf`;
}

before(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "linga-site-chain-"));
  child = spawn(process.execPath, ["index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MODE: "production",
      PORT: String(PORT),
      HOST: "127.0.0.1",
      DB_FILE: path.join(tempDir, "site.db"),
      PARSER_RUNTIME_DIR: path.join(tempDir, "runtime"),
      COOKIE_SECRET: "chain-cookie-secret-at-least-32-characters",
      SESSION_SECRET: "chain-session-secret-at-least-32-characters",
      TRUST_PROXY: "",
      EDGE_SECRET: "",
      REQUIRE_MM_COUNTRY: "false",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  await waitForSite();
});

after(async () => {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

test("preproduction health reports parser-only topology", async () => {
  const response = await fetch(`${BASE}/healthz`);
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.parser, "ready");
  assert.equal(health.engine, "not-wired");
  assert.equal(health.cloudflare, "not-wired");
});

test("serves both built frontends", async () => {
  const bootstrap = await fetch(`${BASE}/`);
  assert.equal(bootstrap.status, 200);
  const csp = bootstrap.headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
  assert.match(await bootstrap.text(), /AKKHARA/);

  const react = await fetch(`${BASE}/react/`);
  assert.equal(react.status, 200);
  assert.match(await react.text(), /AKKHARA/);
});

test("production CSRF + cookie chain accepts a Site-only text submit", async () => {
  const tokenResponse = await fetch(`${BASE}/csrf-token`, {
    headers: { "user-agent": "LingaPreproductionTest/1.0" },
  });
  assert.equal(tokenResponse.status, 200);
  const { csrfToken } = await tokenResponse.json();
  const setCookies = tokenResponse.headers.getSetCookie();
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  assert.match(cookie, /userData=/);
  assert.match(cookie, /csrf_token=/);

  const response = await fetch(`${BASE}/api/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "LingaPreproductionTest/1.0",
      "x-csrf-token": csrfToken,
      cookie,
    },
    body: JSON.stringify({ text: "မြန်မာစာ parser preproduction test" }),
  });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.equal(body.status, "READY");
  assert.ok(body.formId);
  assert.ok(body.submitId);
  assert.equal(Object.hasOwn(body, "engine"), false);
});

test("real multipart PDF reaches parser artifact and authenticated download", async () => {
  const { csrfToken, cookie } = await browserSession();
  const uploadName = timestampedName();
  const source = await fs.readFile(
    path.join(process.cwd(), "frontend/frontend-bootstrap/public/samples/sample.pdf"),
  );
  const form = new FormData();
  form.append("file", new File([source], uploadName, { type: "application/pdf" }));
  form.append("metadata", JSON.stringify(uploadIntent(uploadName)));

  const response = await fetch(`${BASE}/api/submit`, {
    method: "POST",
    headers: {
      "user-agent": "LingaPreproductionTest/1.0",
      "x-csrf-token": csrfToken,
      cookie,
    },
    body: form,
  });
  assert.equal(response.status, 202, `${await response.clone().text()}\n${output}`);
  const body = await response.json();
  assert.equal(body.status, "READY");
  assert.equal(body.processing.state, "READY");
  assert.match(body.processing.downloadUrl, /^\/api\/submit\/file\//);
  assert.equal(Object.hasOwn(body, "text"), false);

  const download = await fetch(`${BASE}${body.processing.downloadUrl}`, {
    headers: {
      "user-agent": "LingaPreproductionTest/1.0",
      "x-csrf-token": csrfToken,
      cookie,
    },
  });
  assert.equal(download.status, 200, `${await download.clone().text()}\n${output}`);
  assert.match(download.headers.get("content-disposition") || "", /\.txt/);
  const artifact = await download.text();
  assert.match(artifact, /Chapter/);
  assert.ok(artifact.length > 80_000);

  const other = await browserSession();
  const forbidden = await fetch(`${BASE}${body.processing.downloadUrl}`, {
    headers: {
      "user-agent": "LingaPreproductionTest/1.0",
      "x-csrf-token": other.csrfToken,
      cookie: other.cookie,
    },
  });
  assert.equal(forbidden.status, 403);

  const runtime = path.join(tempDir, "runtime");
  const quarantine = await fs.readdir(path.join(runtime, "upload", "quarantine"));
  const input = [
    ...(await fs.readdir(path.join(runtime, "upload", "input", "pdf"))),
    ...(await fs.readdir(path.join(runtime, "upload", "input", "docx"))),
  ];
  const originals = await fs.readdir(path.join(runtime, ".output", "original"));
  assert.deepEqual(quarantine, []);
  assert.deepEqual(input, []);
  assert.equal(originals.length, 1);
});

test("multipart signature mismatch is rejected and temporary bytes are removed", async () => {
  const { csrfToken, cookie } = await browserSession();
  const uploadName = timestampedName("fake");
  const form = new FormData();
  form.append("file", new File(["not a pdf"], uploadName, { type: "application/pdf" }));
  form.append("metadata", JSON.stringify(uploadIntent(uploadName, {
    originalName: "fake.pdf",
    detector: {
      ...uploadIntent(uploadName).detector,
      pages: 0,
      textPages: 0,
    },
  })));

  const response = await fetch(`${BASE}/api/submit`, {
    method: "POST",
    headers: {
      "user-agent": "LingaPreproductionTest/1.0",
      "x-csrf-token": csrfToken,
      cookie,
    },
    body: form,
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /signature|truncated/i);
  const input = await fs.readdir(path.join(tempDir, "runtime", "upload", "input", "pdf"));
  const quarantine = await fs.readdir(path.join(tempDir, "runtime", "upload", "quarantine"));
  assert.deepEqual(input, []);
  assert.deepEqual(quarantine, []);
});
