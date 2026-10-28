














import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_RESULT } from "../_path.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const MASTER_ENC = path.join(HERE, "master.json.enc");
const CACHE_FILE = path.join(HERE, "master.json.cache");

const MAGIC = "MGR1";
const CACHE_MAGIC = "MGC1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function checkKey(hex) {
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("MASTER_JSON_KEY must be a 32-byte hex key");
  return key;
}

function loadKey() {
  const key = process.env.MASTER_JSON_KEY;
  if (!key) {
    const searched = ENV_RESULT.sources.length ? ENV_RESULT.sources.join(", ") : "no .env files found";
    throw new Error(`Missing required secret "MASTER_JSON_KEY". Checked process.env and ${searched}.`);
  }
  return checkKey(key);
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

let memoizedText;
let memoizedJson;
let memoizedSourceHash;
let memoizedKeyHash;

export function masterFingerprint() {
  return sha256(MASTER_ENC);
}

function rememberMaster(text, sourceHash, keyHash) {
  const parsed = JSON.parse(text);
  memoizedText = text;
  memoizedJson = parsed;
  memoizedSourceHash = sourceHash;
  memoizedKeyHash = keyHash;
  return text;
}

function writeCache(key, sourceHash, text) {
  const tmp = `${CACHE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, seal(CACHE_MAGIC, key, JSON.stringify({ src: sourceHash, text })));
  fs.renameSync(tmp, CACHE_FILE);
}

export function readMasterText() {
  const key = loadKey();
  const sourceHash = masterFingerprint();
  const keyHash = crypto.createHash("sha256").update(key).digest("hex");
  if (memoizedText !== undefined && memoizedSourceHash === sourceHash && memoizedKeyHash === keyHash) {
    return memoizedText;
  }
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const envelope = JSON.parse(openContainer(CACHE_MAGIC, key, CACHE_FILE));
      if (envelope.src === sourceHash && typeof envelope.text === "string") {
        return rememberMaster(envelope.text, sourceHash, keyHash);
      }
    } catch {
      // Wrong key (rotation), tampered or stale cache — rebuild below.
    }
  }
  const text = openContainer(MAGIC, key, MASTER_ENC);
  const parsed = JSON.parse(text);
  writeCache(key, sourceHash, text);
  memoizedText = text;
  memoizedJson = parsed;
  memoizedSourceHash = sourceHash;
  memoizedKeyHash = keyHash;
  return text;
}

export function readMasterJson() {
  readMasterText();
  // Each caller receives its own object, as it did when parsing on every call.
  return globalThis.structuredClone(memoizedJson);
}



function isMasterFile(file) {
  const enc = file.endsWith(".enc") ? file : `${file}.enc`;
  return path.resolve(enc) === MASTER_ENC;
}

export function readSecureText(file) {
  if (isMasterFile(file)) return readMasterText();
  const enc = file.endsWith(".enc") ? file : `${file}.enc`;
  if (fs.existsSync(enc)) return openContainer(MAGIC, loadKey(), enc);
  return fs.readFileSync(file, "utf8");
}

export function readSecureJson(file) {
  return isMasterFile(file) ? readMasterJson() : JSON.parse(readSecureText(file));
}
