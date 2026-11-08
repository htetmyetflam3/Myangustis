/*
(Input chain - sits like Architecture/Engine/init/bridge.js) One door, two functions on a trigger.
BindInput is the only entry: a trigger comes in { path } (a file the caller owns) or { object } (bytes or a stream already in hand) - never both. A relative trigger path names a file saved by the host, so it is pointed at the host upload dir (<site runtime>/upload/input, per-kind subdir) before reading; an absolute path is an explicit location and is used as given. The trigger then lands in exactly one of two functions: fromPath reads the file through the reader chain (Generator A -> collectA); fromObject passes the incoming object to the same collector. The stage generators sit in core/io/ (file-chunks.js, collect-whole.js) the way the segmentor stages sit in MonoSyllabism/generators/; the composition sits here, one line per chain. Routing and job decisions stay in dispatcher.js - this door only answers "where do the bytes come from", and returns the { path?, size, bytes } object the dispatcher already accepts.
*/
import path from "node:path";
import { PARSER_DIR } from "../../_path.js";
import { generatorA } from "../io/file-chunks.js";
import { collectA } from "../io/collect-whole.js";

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

// Trigger came with a file path: read it through the reader chain.
// A relative path names a file the host saved, so it is pointed at the
// host upload dir first (savedFilePath); the object reports the file
// actually read.
async function fromPath(name) {
  const file = savedFilePath(name);
  for await (const bytes of collectA(generatorA(file))) {
    return { path: file, size: bytes.length, bytes };
  }
  throw new TypeError("BindInput: no bytes read from path");
}

// Trigger came with an object: a byte stream passes to the collector
// untouched, bytes in hand go as one chunk, a path-only object is read
// through the reader chain.
async function fromObject(object) {
  const source = object?.[Symbol.asyncIterator]
    ? object
    : object instanceof Uint8Array
      ? [object]
      : object?.bytes instanceof Uint8Array
        ? [object.bytes]
        : object?.data instanceof Uint8Array
          ? [object.data]
          : typeof object?.path === "string" && object.path
            ? generatorA(savedFilePath(object.path))
            : null;
  if (!source) {
    throw new TypeError("BindInput: object must be a byte stream, bytes, or a file path");
  }
  for await (const bytes of collectA(source)) {
    return typeof object?.path === "string" && object.path
      ? { path: savedFilePath(object.path), size: bytes.length, bytes }
      : { size: bytes.length, bytes };
  }
  throw new TypeError("BindInput: no bytes read from object");
}

/**
 * One entry for trigger input. Returns a promise for the input object:
 * { path, size, bytes } when a path is known, { size, bytes } otherwise.
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
  if (hasObject) return fromObject(trigger.object);
  throw new TypeError("BindInput: trigger must carry a file path or an object");
}
