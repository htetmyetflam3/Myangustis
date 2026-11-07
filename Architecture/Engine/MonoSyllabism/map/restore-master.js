








import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { getEngineData } from "../../_path.js";
const { readMasterText } = await getEngineData();

const HERE = path.dirname(fileURLToPath(import.meta.url));

const ENGINE_ROOT = path.resolve(HERE, "..", "..");
const TARGET = path.join(ENGINE_ROOT, "knowledge", "isTreasure", "master.json");

if (fs.existsSync(TARGET)) {
  console.log(`[restore-master] already present: ${TARGET}`);
  process.exit(0);
}
const text = readMasterText();
JSON.parse(text);
fs.mkdirSync(path.dirname(TARGET), { recursive: true });
fs.writeFileSync(TARGET, text, "utf8");
console.log(`[restore-master] ${TARGET} restored from the sealed master (${text.length} chars)`);
