// step 3: payload = encrypt( pack( obfuscate( base/ bundle ) ) )
// Owner's design (see tools/pack-box.js): the bundle is obfuscated first,
// then sealed — the shipped payload never contains readable JS or a
// readable JSON. External-key design: the AES-256-GCM key is minted/reused
// in payload.key.txt next to this script (and overridable via PAYLOAD_KEY).
// It is NEVER written into loader.mjs or into box.wasm.
// Container: iv(12) || ciphertext || tag(16).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { obfuscateLoader } from "./tools/obfuscate-loader.mjs";

const HERE = import.meta.dirname;
const BASE = path.join(HERE, "base");
const KNOWLEDGE = path.join(HERE, "master.json");
const KEY_FILE = path.join(HERE, "payload.key.txt");

function loadKey() {
  const fromEnv = (process.env.PAYLOAD_KEY || "").trim();
  const hex = fromEnv || (fs.existsSync(KEY_FILE) ? fs.readFileSync(KEY_FILE, "utf8").trim() : "");
  if (hex && /^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, "hex");
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString("hex") + "\n", "utf8");
  return key;
}

// The pack is the flat module map the shim resolves ('./normalize.js',
// './function.js', ...). Sources on disk live under base/ and import each
// other as './x.js' already, except engine-api.js, which points into
// './base/' from the kit root and is flattened here.
export function buildPack() {
  const master = JSON.parse(fs.readFileSync(KNOWLEDGE, "utf8"));
  if (master.mapData === undefined) {
    throw new Error(`missing "mapData" in ${KNOWLEDGE} — decrypt the current master.json.enc first`);
  }
  const pack = {};
  let inlined = 0;
  for (const disk of ["function.js", "normalize.js", "sourceMap.js", "sourceMapper.js"]) {
    let src = fs.readFileSync(path.join(BASE, disk), "utf8");
    // Host-only helper: support.js lives outside the box (the shim stubs
    // in-box logging), so its import and init call never ship.
    src = src.replace(/import\s*\{\s*debugLogInit\s*\}\s*from\s*["']\.\.\/support\.js["'];?/g, "");
    src = src.replace(/^\s*debugLogInit\(\);\s*$/gm, "");
    // Inline the mapData section of master.json where the JSON import was:
    // the sealed bundle carries the data as code, never as a readable file.
    src = src.replace(
      /import\s+mapData\s+from\s+["'][^"']+["']\s+with\s*\{[^}]*\}\s*;/g,
      () => {
        inlined++;
        return `const mapData = ${JSON.stringify(master.mapData)};`;
      },
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
    pack[disk] = obfuscateLoader(src);
  }
  let api = fs.readFileSync(path.join(HERE, "engine-api.js"), "utf8");
  api = api.replace(/(from\s*["'])\.\/base\//g, "$1./");
  pack["engine-api.js"] = obfuscateLoader(api);
  if (!inlined) throw new Error(`no mapData import found in ${BASE}/sourceMap.js`);
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
