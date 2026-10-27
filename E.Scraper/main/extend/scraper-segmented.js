import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { BindEngine } from "../../_index.js";

const NODE_MAJOR = Number(process.versions.node.split(".", 1)[0]);
if (NODE_MAJOR < 22) {
  console.error(`[segment] Node.js 22+ is required; found ${process.version} at ${process.executable}.`);
  process.exit(1);
}

const SEP = "\u001d"; // GROUP SEPARATOR between documents, both directions

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

// The caller supplies the output identifier; the bridge returns the result.
async function segmentDocument(text) {
  const result = await BindEngine("scraper", { hash: randomUUID(), sourceText: text });
  if (!result.syllablePath) {
    throw new Error("engine scraper run produced no syllable output");
  }
  return result.syllable;
}

const input = await readStdin();
const outFile = process.argv[2];
if (!outFile) {
  console.error("usage: node scraper-segmented.js OUTPUT_FILE < input");
  process.exit(2);
}

const docs = input.split(SEP);
const out = [];
for (let i = 0; i < docs.length; i++) {
  const doc = docs[i];
  out.push(doc.trim() ? await segmentDocument(doc) : "");
}
fs.writeFileSync(outFile, out.join(SEP), "utf8");
