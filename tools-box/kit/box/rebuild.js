#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMasterText } from '../master/secure.js';
import { buildPack, sealPack } from './build-payload.js';
import { packBox, stripBundledSections } from './pack-box.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RUNTIME = path.join(REPO, 'Architecture/Engine/MonoSyllabism/map');
const BOX = path.join(RUNTIME, 'box.wasm');
const KEY_FILE = path.join(RUNTIME, 'payload.key.txt');
const LOCAL_BOX = path.join(HERE, 'box.wasm');
const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--new-key')) throw new Error('Only --new-key is supported');
if (process.env.LINGA_BOX_RAW) throw new Error('Unset LINGA_BOX_RAW to build the obfuscated loader');
const rotate = args.includes('--new-key');
const keyHex = rotate ? crypto.randomBytes(32).toString('hex') : fs.readFileSync(KEY_FILE, 'utf8').trim();
if (!/^[0-9a-f]{64}$/i.test(keyHex)) throw new Error('Payload key must be 32 bytes in hexadecimal');
const environmentKey = (process.env.PAYLOAD_KEY || '').trim();
if (environmentKey && environmentKey.toLowerCase() !== keyHex.toLowerCase()) {
  throw new Error('PAYLOAD_KEY differs from the tracked key; unset or update it before rebuilding');
}
const key = Buffer.from(keyHex, 'hex');
const oldBox = fs.readFileSync(BOX);
const engine = stripBundledSections(oldBox);
const pack = buildPack();
const { plain, sealed } = sealPack(pack, key);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'myangustis-box-'));

function atomicWrite(destination, data, mode) {
  const tmp = `${destination}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(tmp, data, { mode, flag: 'wx' });
    fs.renameSync(tmp, destination);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

try {
  const payloadPath = path.join(stage, 'payload.bin');
  const stagedBox = path.join(stage, 'box.wasm');
  fs.writeFileSync(payloadPath, sealed, { mode: 0o600 });
  const info = packBox({ enginePath: BOX, payloadPath, outPath: stagedBox });
  const result = fs.readFileSync(stagedBox);
  if (!stripBundledSections(result).equals(engine)) throw new Error('The interpreter changed during packaging');
  const module = new WebAssembly.Module(result);
  const loaders = WebAssembly.Module.customSections(module, 'linga.loader');
  const payloads = WebAssembly.Module.customSections(module, 'linga.payload');
  if (loaders.length !== 1 || payloads.length !== 1) throw new Error('The box has unexpected custom sections');
  const payload = Buffer.from(payloads[0]);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  decipher.setAuthTag(payload.subarray(-16));
  const recovered = Buffer.concat([decipher.update(payload.subarray(12, -16)), decipher.final()]);
  if (!recovered.equals(plain)) throw new Error('The WASM payload did not round-trip');

  const outputs = [
    [KEY_FILE, Buffer.from(`${keyHex}\n`), 0o600],
    [BOX, result, 0o644],
    [LOCAL_BOX, result, 0o644],
  ];
  const before = new Map(outputs.map(([file]) => [file, fs.existsSync(file)
    ? { bytes: fs.readFileSync(file), mode: fs.statSync(file).mode & 0o777 }
    : null]));
  const replaced = [];
  try {
    for (const [file, bytes, mode] of outputs) {
      atomicWrite(file, bytes, mode);
      replaced.push(file);
    }
  } catch (error) {
    for (const file of replaced.reverse()) {
      const previous = before.get(file);
      if (previous) atomicWrite(file, previous.bytes, previous.mode);
      else fs.rmSync(file, { force: true });
    }
    throw error;
  }
  const sourceHash = crypto.createHash('sha256').update(readMasterText(), 'utf8').digest('hex');
  const boxHash = crypto.createHash('sha256').update(result).digest('hex');
  console.log(`[box] rebuilt ${Object.keys(pack).length} modules with an obfuscated loader`);
  console.log(`[box] interpreter reused: ${info.engineBytes} bytes`);
  console.log(`[box] authenticated payload round-trip: ${sealed.length} bytes`);
  console.log(`[box] master SHA-256: ${sourceHash}`);
  console.log(`[box] SHA-256: ${boxHash}`);
  console.log(`[box] key: ${path.relative(REPO, KEY_FILE)} (tracked by owner request)`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
