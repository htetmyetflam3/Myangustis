// Append an obfuscated bootstrap and AES-GCM payload as WASM custom sections.
// The payload key remains in the separately tracked runtime sidecar.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscateLoader } from './obfuscate-loader.js';

const BOX_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(BOX_DIR, '..');
const LOCAL_ENGINE = path.join(BOX_DIR, 'engine.wasm');
const RUNTIME_BOX = path.resolve(ROOT, '../../Architecture/Engine/MonoSyllabism/map/box.wasm');
const LOADER = path.join(ROOT, 'master/loader.js');
const PAYLOAD = path.join(BOX_DIR, 'payload.bin');
const OUT = path.join(BOX_DIR, 'box.wasm');
const WASM_HEADER = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]);

function uleb128(n) {
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) throw new Error('Invalid WASM section length');
  const bytes = [];
  do {
    let byte = n & 0x7f;
    n = Math.floor(n / 128);
    if (n) byte |= 0x80;
    bytes.push(byte);
  } while (n);
  return Buffer.from(bytes);
}

function readUleb(bytes, offset) {
  let value = 0;
  for (let index = 0; index < 5; index += 1) {
    if (offset + index >= bytes.length) throw new Error('Truncated WASM section');
    const byte = bytes[offset + index];
    value += (byte & 0x7f) * (2 ** (7 * index));
    if ((byte & 0x80) === 0) {
      if (value > 0xffffffff) throw new Error('Invalid WASM section length');
      return { value, next: offset + index + 1 };
    }
  }
  throw new Error('Invalid WASM section length');
}

// A tracked runtime box already contains the QuickJS interpreter. Reuse it
// without duplicating prior linga sections or requiring a native compiler.
export function stripBundledSections(bytes) {
  if (!bytes.subarray(0, 8).equals(WASM_HEADER)) throw new Error('Invalid WASM interpreter header');
  const chunks = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset < bytes.length) {
    const start = offset;
    const id = bytes[offset++];
    const size = readUleb(bytes, offset);
    offset = size.next;
    const end = offset + size.value;
    if (end > bytes.length) throw new Error('Truncated WASM section');
    let bundled = false;
    if (id === 0) {
      const nameLength = readUleb(bytes, offset);
      const nameEnd = nameLength.next + nameLength.value;
      if (nameEnd > end) throw new Error('Invalid WASM custom section name');
      const name = bytes.subarray(nameLength.next, nameEnd).toString('utf8');
      bundled = name === 'linga.loader' || name === 'linga.payload';
    }
    if (!bundled) chunks.push(bytes.subarray(start, end));
    offset = end;
  }
  return Buffer.concat(chunks);
}

function customSection(name, data) {
  const nameBytes = Buffer.from(name, 'utf8');
  const contents = Buffer.concat([uleb128(nameBytes.length), nameBytes, data]);
  return Buffer.concat([Buffer.from([0]), uleb128(contents.length), contents]);
}

export function packBox({
  enginePath = fs.existsSync(LOCAL_ENGINE) ? LOCAL_ENGINE : RUNTIME_BOX,
  loaderPath = LOADER,
  payloadPath = PAYLOAD,
  outPath = OUT,
} = {}) {
  const engine = stripBundledSections(fs.readFileSync(enginePath));
  const loaderSource = fs.readFileSync(loaderPath, 'utf8');
  if (/^\s*import\s/m.test(loaderSource)) throw new Error('The in-box loader must be self-contained');
  const loader = Buffer.from(process.env.LINGA_BOX_RAW ? loaderSource : obfuscateLoader(loaderSource), 'utf8');
  const payload = fs.readFileSync(payloadPath);
  const box = Buffer.concat([
    engine,
    customSection('linga.loader', loader),
    customSection('linga.payload', payload),
  ]);
  fs.writeFileSync(outPath, box);
  return { out: outPath, engineBytes: engine.length, loaderBytes: loader.length, payloadBytes: payload.length, boxBytes: box.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const input of [LOADER, PAYLOAD]) {
    if (!fs.existsSync(input)) throw new Error(`Missing ${input}; generate the payload first`);
  }
  console.log(packBox());
}
