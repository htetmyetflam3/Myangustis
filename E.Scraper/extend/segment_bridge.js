// Syllable-segmentor bridge: stdin (documents separated by U+001D) ->
// OUTPUT FILE argv[2] (segmented documents separated by U+001D).
//
// New engine shape: this script holds NO engine internals. It imports the
// single boundary through the top-level Bridge facade and makes one call per
// document — BindEngine('scraper', { hash, sourceText }) — which runs the
// syllable-only path B (no tagger, no rule engine) over the in-memory text
// via the engine's readFromApi() head, writes segmented_<hash>_syllable.txt
// with the engine's own stream writer, and returns its path. The file is read
// back with the engine's stream reader. No Engine/Bridge shims, no deep
// imports, no temp staging files.
//
// The result goes to a file, not stdout, because the Engine's logger prints
// its badges to stdout and must stay untouched; stdout/stderr stay diagnostic.
//
// Run by text_collect.py exactly once per download run: the whole collected
// text of the run is flushed through a single process in one stream. The
// precomputed syllable tree ships inside the Engine (architecture/.cache-tree)
// and is loaded as-is — nothing is rebuilt here.
//
// Runtime requirement: Node.js 22+ (the systemd preflight enforces this too).
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
