// Map build utility — regenerate the readable knowledge JSON build input from
// the single sealed master, which now lives at the repo root next to secure.js
// (the only loader; it owns the .env key and the sealed cache).
//
// The readable output (architecture/knowledge/isTreasure/master.json) is a
// LOCAL build input: gitignored, never shipped.
//
// Run when rebuilding the map payload on a machine:
//   node Engine/architecture/MonoSyllabism/map/restore-master.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readMasterText } from "../../../../.data/secure.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// map/ -> MonoSyllabism/ -> architecture/ (the engine root path.js anchors)
const ENGINE_ROOT = path.resolve(HERE, "..", "..");
const TARGET = path.join(ENGINE_ROOT, "knowledge", "isTreasure", "master.json");

if (fs.existsSync(TARGET)) {
  console.log(`[restore-master] already present: ${TARGET}`);
  process.exit(0);
}
const text = readMasterText(); // root secure.js: decrypts source, reuses cache
JSON.parse(text); // sanity: the container must hold valid JSON
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, text, "utf8");
console.log(`[restore-master] ${TARGET} restored from the sealed master (${text.length} chars)`);
