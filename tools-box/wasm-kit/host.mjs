// Required WASM host (external-key design).
// The four map sources are never imported here. The linga.payload section is
// AES-256-GCM encrypted at rest; this host decrypts it with a key held OUTSIDE
// the box — PAYLOAD_KEY env, else ./payload.key.txt beside this file — and only
// then boots the engine on the plaintext pack. No Python, no bytenode: Node
// WebAssembly + node:wasi + node:crypto only.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { WASI } from "node:wasi";
import { isDeepStrictEqual } from "node:util";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY_FILE = path.join(HERE, "payload.key.txt");

function loadKey() {
  const fromEnv = (process.env.PAYLOAD_KEY || "").trim();
  const hex = fromEnv || (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8").trim() : "");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    throw new Error("PAYLOAD_KEY/payload.key.txt must hold a 32-byte hex key (64 chars)");
  }
  return key;
}

// container written by build-payload.mjs: iv(12) || ciphertext || tag(16)
function decryptPayload(section, key) {
  const iv = section.subarray(0, 12);
  const tag = section.subarray(section.length - 16);
  const ct = section.subarray(12, section.length - 16);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export class WasmBox {
  constructor(file = new URL("./box.wasm", import.meta.url), manifest = null) {
    if (!fs.existsSync(file)) {
      throw new Error("Required WASM box is missing. Run the wasm build; there is no JS/JSC fallback.");
    }
    const bytes = fs.readFileSync(file);
    // Optional pinning: only enforced when a build-info manifest is supplied.
    if (manifest && fs.existsSync(manifest)) {
      const info = JSON.parse(fs.readFileSync(manifest, "utf8"));
      if (info.box_sha256 && crypto.createHash("sha256").update(bytes).digest("hex") !== info.box_sha256) {
        throw new Error("WASM hash does not match build-info.json; rebuild. No fallback.");
      }
    }
    const module = new WebAssembly.Module(bytes);
    const loaderSections = WebAssembly.Module.customSections(module, "linga.loader");
    const payloadSections = WebAssembly.Module.customSections(module, "linga.payload");
    if (loaderSections.length !== 1 || payloadSections.length !== 1) {
      throw new Error("Invalid WASM box sections");
    }
    // Decrypt OUTSIDE the engine; the in-box loader only parses plaintext.
    const packBytes = decryptPayload(new Uint8Array(payloadSections[0]), loadKey());

    this.wasi = new WASI({ version: "preview1", args: [], env: {}, preopens: {}, returnOnExit: true });
    const instance = new WebAssembly.Instance(module, { wasi_snapshot_preview1: this.wasi.wasiImport });
    this.api = instance.exports;
    if (typeof this.api._start === "function") this.wasi.start(instance);
    else this.wasi.initialize(instance);
    for (const name of ["alloc", "boot", "run", "outPtr"]) {
      if (typeof this.api[name] !== "function") throw new Error(`WASM ABI is missing ${name}`);
    }
    this.encoder = new TextEncoder();
    this.decoder = new TextDecoder("utf-8", { fatal: true });
    const lb = new Uint8Array(loaderSections[0]);
    const status = this.api.boot(this.write(lb), lb.length, this.write(packBytes), packBytes.length);
    if (status !== 0) throw new Error(`WASM boot failed (${status}): ${this.error()}`);
    this.ptr = 0;
    this.capacity = 0;
  }

  write(bytes) {
    const ptr = this.api.alloc(Math.max(bytes.length, 1));
    if (!ptr) throw new Error("WASM allocation failed");
    new Uint8Array(this.api.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  }

  error() {
    const ptr = this.api.outPtr();
    if (!ptr) return "no error details";
    const bytes = new Uint8Array(
      this.api.memory.buffer,
      ptr,
      Math.min(1200, this.api.memory.buffer.byteLength - ptr),
    );
    const end = bytes.indexOf(0);
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end));
  }

  run(mode, text) {
    if (![0, 1, 2, 3].includes(mode)) throw new Error(`Unknown WASM mode ${mode}`);
    const bytes = this.encoder.encode(text);
    if (bytes.length > this.capacity) {
      this.capacity = Math.max(4096, bytes.length, this.capacity * 2);
      this.ptr = this.api.alloc(this.capacity);
      if (!this.ptr) throw new Error("WASM input allocation failed");
    }
    new Uint8Array(this.api.memory.buffer, this.ptr, bytes.length).set(bytes);
    const length = this.api.run(mode, this.ptr, bytes.length);
    if (length < 0) throw new Error(`WASM call failed (${length}): ${this.error()}`);
    return this.decoder.decode(new Uint8Array(this.api.memory.buffer, this.api.outPtr(), length));
  }

  call(method, ...args) {
    if (["normalize", "mapperNormalize", "myNormalize"].includes(method)) {
      if (typeof args[0] !== "string") throw new TypeError(`${method} requires a string`);
      args[0] = args[0].normalize("NFC"); // same NFC boundary as before
    }
    return JSON.parse(this.run(3, JSON.stringify({ method, args })));
  }
}

let sharedBox;
export function getBox() {
  return (sharedBox ??= new WasmBox());
}

export function assertMapData(mapData) {
  if (!mapData?.MMap || !mapData?.NewMap) throw new Error("Master is missing mapData");
  const actual = getBox().call("tables");
  const sets = new Set(["PUNCTUATION", "Glue", "ENGLISH_DIGITS", "BURMESE_DIGITS", "BLOCK_PUNCT"]);
  for (const [key, value] of Object.entries(mapData)) {
    const left = sets.has(key) ? new Set(actual[key]) : actual[key];
    const right = sets.has(key) ? new Set(value) : value;
    if (!isDeepStrictEqual(left, right)) {
      throw new Error(`Master mapData.${key} differs from the built WASM. Rebuild; no fallback.`);
    }
  }
}
