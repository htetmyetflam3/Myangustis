#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const DATA = path.join(REPO, 'Architecture/Engine/.data');
const ENCRYPTED = path.join(DATA, 'master.json.enc');
const KEY_FILE = path.join(DATA, 'master.key.txt');
const LOADER = path.join(DATA, 'secure.js');
const args = process.argv.slice(2);
const rotate = args.includes('--new-key');
const sourceIndex = args.indexOf('--source');
const source = sourceIndex < 0 ? path.join(HERE, 'master.json') : path.resolve(args[sourceIndex + 1] || '');
const accepted = new Set(['--new-key', '--source']);
for (let i = 0; i < args.length; i += 1) {
  if (!accepted.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  if (args[i] === '--source') {
    if (!args[i + 1]) throw new Error('--source requires a path');
    i += 1;
  }
}
if (!fs.existsSync(LOADER)) throw new Error(`The master loader is missing: ${LOADER}`);

const plaintext = fs.readFileSync(source);
JSON.parse(plaintext.toString('utf8'));
let keyHex;
if (!rotate && fs.existsSync(KEY_FILE)) {
  keyHex = fs.readFileSync(KEY_FILE, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('The tracked master key is invalid');
} else {
  keyHex = crypto.randomBytes(32).toString('hex');
}
const environmentKey = (process.env.MASTER_JSON_KEY || '').trim();
if (environmentKey && environmentKey.toLowerCase() !== keyHex.toLowerCase()) {
  throw new Error('MASTER_JSON_KEY differs from the tracked key; unset or update it before sealing');
}
const key = Buffer.from(keyHex, 'hex');
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const tag = cipher.getAuthTag();
const sealed = Buffer.concat([Buffer.from('MGR1', 'ascii'), iv, tag, encrypted]);

// Decryption is part of sealing: do not replace either file unless the exact
// original bytes can be recovered with the selected key.
const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
decipher.setAuthTag(tag);
const recovered = Buffer.concat([decipher.update(encrypted), decipher.final()]);
if (!recovered.equals(plaintext)) throw new Error('The encrypted master did not round-trip');

fs.mkdirSync(DATA, { recursive: true });
const nonce = `${process.pid}.${crypto.randomBytes(6).toString('hex')}`;
const keyTemp = `${KEY_FILE}.${nonce}.tmp`;
const encTemp = `${ENCRYPTED}.${nonce}.tmp`;
const oldKey = fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE) : null;
let keyReplaced = false;
try {
  fs.writeFileSync(keyTemp, `${keyHex}\n`, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(encTemp, sealed, { mode: 0o600, flag: 'wx' });
  fs.renameSync(keyTemp, KEY_FILE);
  keyReplaced = true;
  fs.renameSync(encTemp, ENCRYPTED);
} catch (error) {
  if (keyReplaced) {
    if (oldKey) fs.writeFileSync(KEY_FILE, oldKey, { mode: 0o600 });
    else fs.rmSync(KEY_FILE, { force: true });
  }
  throw error;
} finally {
  fs.rmSync(keyTemp, { force: true });
  fs.rmSync(encTemp, { force: true });
}
console.log(`[master] encrypted and decrypted ${plaintext.length} source bytes`);
console.log(`[master] ciphertext: ${path.relative(REPO, ENCRYPTED)}`);
console.log(`[master] key: ${path.relative(REPO, KEY_FILE)} (tracked by owner request)`);
console.log(`[master] loader: ${path.relative(REPO, LOADER)}`);
