// step 3: payload = encrypt( pack( base/ entry logic + knowledge ) )
// External-key design: the AES-256-GCM key is mandatory and reused. Resolve
// PAYLOAD_KEY from the process/.env beside this script, then the fallback
// .cache/payload.key.txt, then the tracked payload.key.txt in git. It is
// NEVER written into loader.mjs or box.wasm, and this script never mints an
// unretrievable replacement key. Container: iv(12) || ciphertext || tag(16).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const HERE = import.meta.dirname;
const BASE = path.join(HERE, "base");
const KNOWLEDGE = path.join(HERE, "master.json");
const KEY_FILE = path.join(HERE, "payload.key.txt");
const CACHE_KEY_FILE = path.join(HERE, ".cache", "payload.key.txt");
const ENV_FILE = path.join(HERE, ".env");

function keyFromEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return "";
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    if (t.slice(0, eq).trim() === "PAYLOAD_KEY") return t.slice(eq + 1).trim();
  }
  return "";
}

function keyFromHex(hex, label) {
  const text = String(hex || "").trim();
  if (!/^[0-9a-f]{64}$/i.test(text)) {
    throw new Error(`${label} must hold a 32-byte hex key (64 chars)`);
  }
  return Buffer.from(text, "hex");
}

function loadKey() {
  const fromEnv = (process.env.PAYLOAD_KEY || "").trim() || keyFromEnvFile();
  if (fromEnv) return keyFromHex(fromEnv, "PAYLOAD_KEY (.env/process env)");
  for (const [label, file] of [
    [".cache/payload.key.txt", CACHE_KEY_FILE],
    ["payload.key.txt (tracked)", KEY_FILE],
  ]) {
    if (fs.existsSync(file)) return keyFromHex(fs.readFileSync(file, "utf8"), label);
  }
  throw new Error(
    "PAYLOAD_KEY is mandatory: set it in .env or place .cache/payload.key.txt " +
      "or the tracked payload.key.txt beside build-payload.mjs",
  );
}

export function buildPack() {
  const pack = {};
  let inlined = 0;
  const inlineSection = (_, name) => {
    const section = JSON.parse(fs.readFileSync(KNOWLEDGE, "utf8"))[name];
    if (section === undefined) throw new Error(`missing "${name}" in ${KNOWLEDGE}`);
    inlined++;
    return `const ${name} = ${JSON.stringify(section)};`;
  };
  // disk function.js is served in-box under the name every import expects
  for (const [disk, key] of [
    ["function.js", "_function.js"],
    ["normalize.js", "normalize.js"],
    ["sourceMap.js", "sourceMap.js"],
    ["sourceMapper.js", "sourceMapper.js"],
  ]) {
    let src = fs.readFileSync(path.join(BASE, disk), "utf8");
    // inline the mapData section of master.json where the JSON import was
    src = src.replace(
      /import\s+(\w+)\s+from\s+["'][^"']*master\.json["']\s+with\s*\{[^}]*\}\s*;/g,
      inlineSection,
    );
    // base/ files are bundle sources, not valid standalone ESM: drop duplicate
    // re-exports of names already declared with `export const`.
    const constNames = new Set([...src.matchAll(/export\s+const\s+(\w+)/g)].map((m) => m[1]));
    src = src.replace(/export\s*\{([^}]*)\}\s*;/g, (whole, list) => {
      const keep = list
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((n) => !constNames.has(n.split(/\s+as\s+/)[0].trim()));
      return keep.length ? `export { ${keep.join(", ")} };` : "";
    });
    pack[key] = src;
  }
  pack["engine-api.js"] = fs.readFileSync(path.join(HERE, "engine-api.mjs"), "utf8");
  if (!inlined) throw new Error(`no master.json import found in ${BASE}`);
  return pack;
}

export function encryptPack(pack, key = loadKey()) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(pack), "utf8"), c.final()]);
  return Uint8Array.from(Buffer.concat([iv, ct, c.getAuthTag()]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const key = loadKey();
  const payload = encryptPack(buildPack(), key);
  fs.writeFileSync(path.join(HERE, "payload.bin"), payload);
  console.log(
    `payload.bin: ${payload.length} bytes; key in ${path.basename(KEY_FILE)} ` +
      `(${key.toString("hex").slice(0, 8)}…, external — not in loader/box)`,
  );
}
