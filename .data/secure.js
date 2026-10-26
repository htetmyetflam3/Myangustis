// secure.js — the ONLY loader for the sealed master.
//
// Everything in this one module; no helper module exists for any of it:
//   1. key      process.env.MASTER_JSON_KEY, else the .env file sitting next
//               to this loader (repo root). The loader reads .env itself.
//   2. source   master.json.enc beside this file — MGR1 container,
//               [4-byte magic][12-byte IV][16-byte GCM tag][AES-256-GCM body].
//   3. cache    master.json.cache beside this file. It is a SEALED cache
//               (MGC1 container, same key), never a readable plain JSON.
//               On load the cache is reused when the source .enc is unchanged
//               (sha256 envelope); a rotated key or a changed source fails
//               verification and transparently rebuilds it.
//
// Python callers reach this same file through `node --input-type=module`,
// so JS and Python share one on-disk cache.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MASTER_ENC = path.join(HERE, "master.json.enc");
const ENV_FILE = path.join(HERE, ".env");
const CACHE_FILE = path.join(HERE, "master.json.cache");

const MAGIC = "MGR1"; // sealed source
const CACHE_MAGIC = "MGC1"; // sealed cache
const IV_BYTES = 12;
const TAG_BYTES = 16;

function checkKey(hex) {
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("MASTER_JSON_KEY must be a 32-byte hex key");
  return key;
}

function loadKey() {
  const fromEnv = (process.env.MASTER_JSON_KEY || "").trim();
  if (fromEnv) return checkKey(fromEnv);
  if (!fs.existsSync(ENV_FILE)) {
    throw new Error(`missing key: set MASTER_JSON_KEY or create ${ENV_FILE}`);
  }
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/u)) {
    const match = line.match(/^\s*MASTER_JSON_KEY\s*=\s*(.*?)\s*$/u);
    if (match) return checkKey(match[1].replace(/^["']|["']$/gu, ""));
  }
  throw new Error("MASTER_JSON_KEY not found in the environment or in .env");
}

function seal(magic, key, plaintext) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from(magic, "ascii"), iv, cipher.getAuthTag(), body]);
}

function openContainer(magic, key, file) {
  const buf = fs.readFileSync(file);
  if (
    buf.length < 4 + IV_BYTES + TAG_BYTES ||
    buf.subarray(0, 4).toString("ascii") !== magic
  ) {
    throw new Error(`invalid ${magic} container: ${file}`);
  }
  const iv = buf.subarray(4, 4 + IV_BYTES);
  const tag = buf.subarray(4 + IV_BYTES, 4 + IV_BYTES + TAG_BYTES);
  const body = buf.subarray(4 + IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

let memoizedText; // in-process memo on top of the on-disk cache

function writeCache(key, sourceHash, text) {
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, seal(CACHE_MAGIC, key, JSON.stringify({ src: sourceHash, text })));
  fs.renameSync(tmp, CACHE_FILE);
}

export function readMasterText() {
  if (memoizedText !== undefined) return memoizedText;
  const key = loadKey();
  const sourceHash = sha256(MASTER_ENC);
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const envelope = JSON.parse(openContainer(CACHE_MAGIC, key, CACHE_FILE));
      if (envelope.src === sourceHash && typeof envelope.text === "string") {
        memoizedText = envelope.text;
        return memoizedText;
      }
    } catch {
      // Wrong key (rotation), tampered or stale cache — rebuild below.
    }
  }
  const text = openContainer(MAGIC, key, MASTER_ENC);
  JSON.parse(text); // sanity: the source must hold valid JSON
  writeCache(key, sourceHash, text);
  memoizedText = text;
  return memoizedText;
}

export function readMasterJson() {
  return JSON.parse(readMasterText());
}

// Generic sealed-file reader for explicit dictionary overrides and build
// tooling: a plain file is read as-is, and an encrypted twin wins when present.
export function readSecureText(file) {
  const enc = file.endsWith(".enc") ? file : `${file}.enc`;
  if (fs.existsSync(enc)) return openContainer(MAGIC, loadKey(), enc);
  return fs.readFileSync(file, "utf8");
}

export function readSecureJson(file) {
  return JSON.parse(readSecureText(file));
}
