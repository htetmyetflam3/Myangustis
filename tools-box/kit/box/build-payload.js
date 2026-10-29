#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMasterJson } from '../master/secure.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const BASE = path.join(HERE, '../base');
const KEY_FILE = path.join(REPO, 'Architecture/Engine/MonoSyllabism/map/payload.key.txt');
const OUTPUT = path.join(HERE, 'payload.bin');

export function buildPack() {
  const mapData = readMasterJson().mapData;
  if (!mapData || typeof mapData !== 'object') throw new Error('The master has no mapData');
  const pack = Object.fromEntries(['function.js', 'normalize.js', 'sourceMap.js', 'sourceMapper.js']
    .map((name) => [name, fs.readFileSync(path.join(BASE, name), 'utf8')]));
  pack['engine-api.js'] = fs.readFileSync(path.join(HERE, 'engine-api.js'), 'utf8');

  const injection = /import\s*\{\s*readMasterJson\s*\}\s*from\s*["']\.\.\/master\/secure\.js["'];\s*const mapData = readMasterJson\(\)\.mapData;/;
  if (!injection.test(pack['sourceMap.js'])) throw new Error('The sourceMap mapData injection point is missing');
  pack['sourceMap.js'] = pack['sourceMap.js'].replace(injection, () => `const mapData = ${JSON.stringify(mapData)};`);

  for (const [name, source] of Object.entries(pack)) {
    const imports = source.matchAll(/(?:^|\n)\s*import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']/g);
    for (const match of imports) {
      const dependency = match[1];
      const basename = path.posix.basename(dependency);
      if (!dependency.startsWith('./') || !Object.hasOwn(pack, basename)) {
        throw new Error(`${name} imports an unavailable WASM module: ${dependency}`);
      }
    }
  }
  return pack;
}

export function sealPack(pack, key) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('Payload key must be 32 bytes');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(pack), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { plain, sealed: Buffer.concat([iv, ciphertext, cipher.getAuthTag()]) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hex = (process.env.PAYLOAD_KEY || fs.readFileSync(KEY_FILE, 'utf8')).trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('Payload key must be 32 bytes in hexadecimal');
  const pack = buildPack();
  const { sealed } = sealPack(pack, Buffer.from(hex, 'hex'));
  fs.writeFileSync(OUTPUT, sealed, { mode: 0o600 });
  console.log(`[payload] encrypted ${Object.keys(pack).length} modules to ${path.relative(REPO, OUTPUT)}`);
}
