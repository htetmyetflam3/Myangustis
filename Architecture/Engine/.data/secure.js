import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const MASTER_ENC = path.join(HERE, 'master.json.enc');
export const MASTER_KEY_FILE = path.join(HERE, 'master.key.txt');
const CACHE_FILE = path.join(HERE, 'master.json.cache');
const MASTER_MAGIC = 'MGR1';
const CACHE_MAGIC = 'MGC1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey() {
  let hex = (process.env.MASTER_JSON_KEY || '').trim();
  if (!hex) {
    try {
      hex = fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      throw new Error('MASTER_JSON_KEY or the tracked master.key.txt is required');
    }
  }
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error('The master key must be exactly 32 bytes in hexadecimal');
  }
  return Buffer.from(hex, 'hex');
}

function digest(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function openContainer(magic, key, bytes, source) {
  const headerBytes = 4 + IV_BYTES + TAG_BYTES;
  if (bytes.length < headerBytes || bytes.subarray(0, 4).toString('ascii') !== magic) {
    throw new Error(`Invalid ${magic} container: ${source}`);
  }
  const iv = bytes.subarray(4, 4 + IV_BYTES);
  const tag = bytes.subarray(4 + IV_BYTES, headerBytes);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(bytes.subarray(headerBytes)), decipher.final()]).toString('utf8');
}

function sealCache(key, text) {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from(CACHE_MAGIC, 'ascii'), iv, cipher.getAuthTag(), ciphertext]);
}

function writeCache(key, sourceHash, text) {
  const tmp = `${CACHE_FILE}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, sealCache(key, JSON.stringify({ src: sourceHash, text })), {
      mode: 0o600,
      flag: 'wx',
    });
    fs.renameSync(tmp, CACHE_FILE);
  } catch {
    // Caching is optional; a read-only or full disk must not block decryption.
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
  }
}

let memoizedText;
let memoizedJson;
let memoizedSourceHash;
let memoizedKeyHash;

function remember(text, sourceHash, keyHash) {
  memoizedJson = JSON.parse(text);
  memoizedText = text;
  memoizedSourceHash = sourceHash;
  memoizedKeyHash = keyHash;
  return text;
}

export function masterFingerprint() {
  return digest(fs.readFileSync(MASTER_ENC));
}

export function readMasterText() {
  const key = loadKey();
  const sealed = fs.readFileSync(MASTER_ENC);
  const sourceHash = digest(sealed);
  const keyHash = digest(key);
  if (memoizedText !== undefined && memoizedSourceHash === sourceHash && memoizedKeyHash === keyHash) {
    return memoizedText;
  }
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(openContainer(CACHE_MAGIC, key, fs.readFileSync(CACHE_FILE), CACHE_FILE));
      if (cached.src === sourceHash && typeof cached.text === 'string') {
        return remember(cached.text, sourceHash, keyHash);
      }
    } catch {
      // A stale or damaged encrypted cache is rebuilt from the master below.
    }
  }
  const text = openContainer(MASTER_MAGIC, key, sealed, MASTER_ENC);
  remember(text, sourceHash, keyHash);
  writeCache(key, sourceHash, text);
  return text;
}

export function readMasterJson() {
  readMasterText();
  return globalThis.structuredClone(memoizedJson);
}

export function readSecureText(file) {
  const name = file instanceof URL ? fileURLToPath(file) : file;
  if (typeof name !== 'string') throw new TypeError('Expected a file path');
  const encrypted = name.endsWith('.enc') ? name : `${name}.enc`;
  if (path.resolve(encrypted) === MASTER_ENC) return readMasterText();
  if (fs.existsSync(encrypted)) {
    return openContainer(MASTER_MAGIC, loadKey(), fs.readFileSync(encrypted), encrypted);
  }
  return fs.readFileSync(name, 'utf8');
}

export function readSecureJson(file) {
  const name = file instanceof URL ? fileURLToPath(file) : file;
  const encrypted = typeof name === 'string' && (name.endsWith('.enc') ? name : `${name}.enc`);
  return encrypted && path.resolve(encrypted) === MASTER_ENC
    ? readMasterJson()
    : JSON.parse(readSecureText(file));
}
