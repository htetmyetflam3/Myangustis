/*import from _index js and wired  here
and load from ../parse.py
*/




import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const NODE_MAJOR = Number(process.versions.node.split(".", 1)[0]);
if (NODE_MAJOR < 22) {
  console.error(`[segment] Node.js 22+ is required; found ${process.version} at ${process.executable}.`);
  process.exit(1);
}

// Single engine door: repo-root Bridge facade -> Engine/index.js -> BindEngine.
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const { BindEngine, readFileContent, getDateTimeHash } = await import(
  url.pathToFileURL(path.join(REPO, "Bridge", "path.js")).href
);

const SEP = "\u001d"; // GROUP SEPARATOR between documents, both directions

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

// One BindEngine call per document. The hash only namespaces the output file
// against parallel runs; the index suffix keeps same-millisecond documents in
// one process from colliding. The engine returns the concrete syllable path,
// so the formatter output (toSyllableLine, applied inside the engine writer)
// is read straight back — no formatter import on this side.
async function segmentDocument(text, index) {
  const hash = `${getDateTimeHash()}_${index}`;
  const result = await BindEngine("scraper", { hash, sourceText: text });
  if (!result.syllablePath) {
    throw new Error("engine scraper run produced no syllable output");
  }
  return readFileContent(result.syllablePath);
}

const input = await readStdin();
const outFile = process.argv[2];
if (!outFile) {
  console.error("usage: node segment_bridge.mjs OUTPUT_FILE < input");
  process.exit(2);
}

const docs = input.split(SEP);
const out = [];
for (let i = 0; i < docs.length; i++) {
  const doc = docs[i];
  out.push(doc.trim() ? await segmentDocument(doc, i) : "");
}
fs.writeFileSync(outFile, out.join(SEP), "utf8");
