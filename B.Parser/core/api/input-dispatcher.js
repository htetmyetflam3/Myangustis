/*
(Input chain - sits like Architecture/Engine/init/bridge.js) One door, two functions on a trigger.
BindInput is the only entry: a trigger comes in { path } (a file the caller owns) or { object } (bytes or a stream already in hand) - never both. The trigger then lands in exactly one of two functions: fromPath reads the file through the reader chain (Generator A -> collectA); fromObject passes the incoming object to the same collector. The stage generators sit in core/io/ (file-chunks.js, collect-whole.js) the way the segmentor stages sit in MonoSyllabism/generators/; the composition sits here, one line per chain. Routing and job decisions stay in dispatcher.js - this door only answers "where do the bytes come from", and returns the { path?, size, bytes } object the dispatcher already accepts.
*/
import { generatorA } from "../io/file-chunks.js";
import { collectA } from "../io/collect-whole.js";

// Trigger came with a file path: read it through the reader chain.
async function fromPath(path) {
  for await (const bytes of collectA(generatorA(path))) {
    return { path, size: bytes.length, bytes };
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
            ? generatorA(object.path)
            : null;
  if (!source) {
    throw new TypeError("BindInput: object must be a byte stream, bytes, or a file path");
  }
  for await (const bytes of collectA(source)) {
    return typeof object?.path === "string" && object.path
      ? { path: object.path, size: bytes.length, bytes }
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
