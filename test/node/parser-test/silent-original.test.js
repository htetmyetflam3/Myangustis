// Integration test: silent original-file saving for browser-parsed uploads.
// Stubs the DB request layer; exercises the real multer + incoming.js chain.
import express from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { createIncomingRouter } from "../../R_Site/Backend/gateway/api/incoming.js";
import { inputDirFor, ensurePraserDirs, RAW_TXT_DIR, ORIGINAL_DIR, QUARANTINE_DIR } from "../../R_Site/_file/paths.js";

ensurePraserDirs();

// Same multer config as index.js
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, inputDirFor(file.originalname)),
    filename: (req, file, cb) =>
      cb(null, `test-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`),
  }),
});

// DB stub — file flow must not depend on the database for this test
const requestStub = {
  checkQuota: async () => ({ allowed: true, remaining: 999 }),
  createUploadSession: async () => `form-${Date.now()}`,
  validateSubmission: async () => ({}),
  finalizeUpload: async () => ({}),
  incrementQuota: async () => ({}),
};

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use("/api/submit", createIncomingRouter({ upload, pool: {}, request: requestStub }));

const server = app.listen(3999, "127.0.0.1");
await new Promise((r) => server.once("listening", r));

async function post(file, text) {
  const fd = new FormData();
  fd.append("file", file);
  if (text !== undefined) fd.append("text", text);
  const res = await fetch("http://127.0.0.1:3999/api/submit", { method: "POST", body: fd });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const list = (d) => fs.readdirSync(d).filter((f) => f.startsWith("test-"));
const out = (d) => fs.readdirSync(d).filter((f) => f !== ".gitkeep");
// quarantine copies are named "<timestamp>_<originalname>" (no test- prefix)
const qcount = () => fs.readdirSync(QUARANTINE_DIR).length;

let failures = 0;
function check(name, cond, extra = "") {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

// ── Case A: docx parsed in browser (file + client text) ──
{
  const before = { q: qcount(), t: out(RAW_TXT_DIR).length, o: out(ORIGINAL_DIR).length };
  const r = await post(new File([new Uint8Array([1, 2, 3])], "letter.docx"), "မင်္ဂလာပါ browser-parsed docx text");
  check("A: docx+clientText → 202", r.status === 202);
  check("A: docx landed in input/docx", fs.readdirSync(path.join(QUARANTINE_DIR, "..", "input", "docx")).some((f) => f.startsWith("test-")));
  check("A: quarantine reference copy saved", qcount() > before.q);
  check("A: raw text saved (client text, no re-parse)", out(RAW_TXT_DIR).length > before.t);
  check("A: original copy saved to output/original", out(ORIGINAL_DIR).length > before.o);
  check("A: response returns the client text", (r.body.text || "").includes("browser-parsed"));
}

// ── Case B: txt parsed in browser (file + client text) ──
{
  const r = await post(new File(["တစ်ခုမဟုတ် client text"], "note.txt"), "client-side txt content");
  check("B: txt+clientText → 202", r.status === 202);
  check("B: client text used (not re-read)", (r.body.text || "") === "client-side txt content");
}

// ── Case C: txt WITHOUT client text → server-side parse (old .doc-style path) ──
{
  const r = await post(new File(["server side parse me"], "plain.txt"), undefined);
  check("C: txt no-text → 202 (server parsed)", r.status === 202 && r.body.text === "server side parse me");
}

// ── Case D: docx WITHOUT client text → clean error (server can't parse docx) ──
{
  const r = await post(new File([new Uint8Array([1])], "x.docx"), undefined);
  check("D: docx no-text → 400 with clear message", r.status === 400 && /mammoth/i.test(r.body.error || ""), r.body.error);
}

server.close();
console.log(failures === 0 ? "\nALL PASS — silent original saving works for browser-parsed uploads" : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
