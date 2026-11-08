/*
(Input chain - sits like Architecture/Engine/init/bridge.js) One door, two functions on a trigger.
BindInput is the only entry: a trigger comes in { path } (a file the caller owns) or { object } (bytes or a stream already in hand) - never both. A relative trigger path names a file saved by the host, so it is pointed at the host upload dir (<site runtime>/upload/input, per-kind subdir); an absolute path is an explicit location and is used as given. The trigger then lands in exactly one of two functions: fromPath points at the already-landed file (nothing is read into memory - the whole bytes are never held); fromObject lands a byte stream or loose bytes into a tmp file through the collector (Generator A -> collectA, the incremental tmp writer), and a path-carrying object resolves to its file the same way. Either way the landed file runs past the middle (prepare-middle.js): clean files pass untouched, encrypted/object-streamed PDFs are prepared by qpdf over the tmp, and the parsing chain entry receives the prepared file to seek in - qpdf's output is a tmp file too, never memory. One pre-determination: the first bytes are peeked before landing - a DOCX (PK) is passed on as the object itself (its runner reads the whole archive anyway, so a tmp would buy nothing); only PDFs take the tmp route. The stage generators sit in core/io/ (file-chunks.js, collect-whole.js) the way the segmentor stages sit in MonoSyllabism/generators/; the composition sits here. Routing and job decisions stay in dispatcher.js - this door only answers "where do the bytes live", and returns { path, size } (plus `filename` when the trigger named one, and `collected: true` when the file is a chain-owned tmp its consumer must delete). The dispatcher payload prefers inPath, so workers read the file themselves.
*/
import fs from "node:fs";
import path from "node:path";
import { PARSER_DIR } from "../../_path.js";
import { generatorA } from "../io/file-chunks.js";
import { collectA, collectBytes } from "../io/collect-whole.js";
import { prepareMiddle } from "../io/prepare-middle.js";

// Where the host saves uploaded files: <site runtime>/upload/input with
// a per-kind subdir (Backend/file/paths.js: INPUT_DIR, inputDirFor).
// A trigger path that is not absolute names a saved file, so it is
// pointed here - never at the process working directory. Absolute
// paths are explicit locations and pass through untouched.
// PARSER_INPUT_DIR (or the host's PARSER_RUNTIME_DIR) relocates it.
const INPUT_HOME = process.env.PARSER_INPUT_DIR
  ? path.resolve(process.env.PARSER_INPUT_DIR)
  : process.env.PARSER_RUNTIME_DIR
    ? path.join(path.resolve(process.env.PARSER_RUNTIME_DIR), "upload", "input")
    : path.join(PARSER_DIR, "host", "upload", "input");
const KIND_DIR = { txt: "txt", pdf: "pdf", docx: "docx", doc: "docx" };

function savedFilePath(name) {
  if (path.isAbsolute(name)) return name;
  const rel = path.normalize(name);
  const base = rel.includes(path.sep)
    ? path.join(INPUT_HOME, rel)
    : path.join(INPUT_HOME, KIND_DIR[rel.split(".").pop().toLowerCase()] ?? "", rel);
  const resolved = path.resolve(base);
  if (resolved !== INPUT_HOME && !resolved.startsWith(INPUT_HOME + path.sep)) {
    throw new TypeError("BindInput: file path escapes the host upload dir");
  }
  return resolved;
}

// The file-object for an already-landed file: point and measure,
// never read. Existence and file-ness are proven here.
function fileObject(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`BindInput: not a file: ${file}`);
  return { path: file, size: stat.size };
}

// Run landed items past the middle and shape the one object the
// dispatcher accepts: the prepared (or untouched) file, its size, and
// whether the chain owns it. `collected` is set when the returned file
// is a chain tmp - the collected landing, or qpdf's prepared output -
// and its consumer must delete it; a caller's own file is never marked.
async function preparedObject(items, { filename = null, collectedItem = false } = {}) {
  for await (const ready of prepareMiddle(items)) {
    return {
      path: ready.path,
      size: fs.statSync(ready.path).size,
      prepared: ready.prepared === true,
      ...((ready.prepared || collectedItem) ? { collected: true } : {}),
      ...(filename ? { filename } : {}),
    };
  }
  throw new TypeError("BindInput: prepare produced nothing");
}

// Trigger came with a file path: the bytes already live in that file,
// so the trigger simply points at it (through savedFilePath) - no
// collection, no memory - and the middle prepares it if it must.
async function fromPath(name) {
  const file = savedFilePath(name);
  fileObject(file); // prove existence before the middle sees it
  return preparedObject([{ path: file }]);
}

// Trigger came with an object. A path-carrying object resolves to its
// file like fromPath. A byte stream or loose bytes have no home yet,
// so they land in a tmp through the collector (marked collected: true
// - the consumer owns its deletion).
async function fromObject(object, nameHint = null) {
  const filename = (typeof object?.filename === "string" && object.filename) || nameHint || null;
  if (typeof object?.path === "string" && object.path && !(object instanceof Uint8Array)) {
    const file = savedFilePath(object.path);
    fileObject(file);
    return preparedObject([{ path: file }], { filename });
  }
  const source = object?.[Symbol.asyncIterator]
    ? object
    : object instanceof Uint8Array
      ? [object]
      : object?.bytes instanceof Uint8Array
        ? [object.bytes]
        : object?.data instanceof Uint8Array
          ? [object.data]
          : null;
  if (!source) {
    throw new TypeError("BindInput: object must be a byte stream, bytes, or a file path");
  }
  return objectByKind(source, filename);
}

// Pre-determination from the first bytes (the same magics the
// converter worker sniffs): "%PDF-" takes the tmp route past the
// middle; a zip container (PK - a DOCX) is passed on as the object
// itself, since its runner reads the whole archive in memory anyway.
// Anything else also takes the tmp route (image pages for OCR land
// there today). The peeked head chunks are handed back into whichever
// route is chosen - nothing is read twice, nothing is lost.
function kindFromHead(head) {
  if (head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) return "docx";
  return "other";
}

async function objectByKind(source, filename) {
  async function* asChunks() { yield* source; }
  const stream = asChunks();
  const iterator = stream[Symbol.asyncIterator]();
  const head = [];
  let headBytes = 0;
  while (headBytes < 4) {
    const next = await iterator.next();
    if (next.done) break;
    const buf = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    head.push(buf);
    headBytes += buf.length;
  }
  async function* rest() {
    yield* head;
    yield* stream;
  }
  if (kindFromHead(Buffer.concat(head)) === "docx") {
    const bytes = await collectBytes(rest());
    return { bytes, size: bytes.length, ...(filename ? { filename } : {}) };
  }
  return preparedObject(collectA(rest(), { nameHint: filename }), { filename, collectedItem: true });
}

/**
 * One entry for trigger input. Returns a promise for the input object:
 * { path, size } - the file the bytes live in, always. `collected: true`
 * marks a chain-owned tmp the consumer must delete after use.
 */
export function BindInput(trigger) {
  if (!trigger || typeof trigger !== "object" || Array.isArray(trigger)) {
    throw new TypeError("BindInput: a trigger object is required");
  }
  const path = trigger.path ?? trigger.inPath;
  const hasPath = typeof path === "string" && path.length > 0;
  const hasObject = trigger.object !== undefined && trigger.object !== null;
  if (hasPath && hasObject) {
    throw new TypeError("BindInput: supply a file path or an object, not both");
  }
  if (hasPath) return fromPath(path);
  if (hasObject) return fromObject(trigger.object, trigger.filename ?? null);
  throw new TypeError("BindInput: trigger must carry a file path or an object");
}
