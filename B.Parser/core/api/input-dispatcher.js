/*
(Input chain - the current dispatcher's input door) Hands every trigger the same byte stream, whichever shape it arrived in.
This module acquires a trigger's input and emits it as chunks for collect-whole.js: a file path (or an object carrying one) is read by the file reader (Generator A); an incoming byte stream is passed through untouched; bytes already in hand are emitted as a single chunk. Routing and job decisions stay in dispatcher.js - this module only answers "where do the bytes come from".
*/
import { generatorA } from "../io/file-chunks.js";
import { collectA } from "../io/collect-whole.js";

const asPath = (value) => (typeof value === "string" && value.length > 0 ? value : null);

// Emit the trigger's input as byte chunks, whatever shape it arrived in:
//   "path/to/file"            -> read by Generator A
//   { inPath }                -> read by Generator A
//   { object: <stream> }      -> the stream itself, chunk by chunk
//   { object: { bytes } }     -> the bytes as one chunk
//   { object: { path } }      -> read by Generator A (path-only object)
// Feed the result to collectA (collect-whole.js) for the whole bytes.
export async function* dispatchInput(input, options = {}) {
  const direct = asPath(input) ?? asPath(input?.inPath);
  if (direct) {
    yield* generatorA(direct, options);
    return;
  }
  const source = input?.object ?? input;
  if (source && typeof source[Symbol.asyncIterator] === "function") {
    yield* source;
    return;
  }
  const bytes = source instanceof Uint8Array ? source : (source?.bytes ?? source?.data);
  if (bytes instanceof Uint8Array) {
    yield bytes;
    return;
  }
  const objectPath = asPath(source?.path);
  if (objectPath) {
    yield* generatorA(objectPath, options);
    return;
  }
  throw new TypeError("dispatchInput: supply a file path, a byte stream, or bytes");
}

// The whole input as the object shape the dispatcher already accepts:
// { size, bytes }, plus `path` when one is known. This is the one-shot
// form of dispatchInput -> collectA for callers that need the object.
export async function readInputObject(input, options = {}) {
  let bytes;
  for await (const whole of collectA(dispatchInput(input, options))) {
    bytes = whole;
  }
  if (!bytes) throw new TypeError("readInputObject: no input bytes");
  const knownPath = asPath(input) ?? asPath(input?.inPath)
    ?? asPath(input?.object?.path) ?? asPath(input?.path);
  return knownPath ? { path: knownPath, size: bytes.length, bytes } : { size: bytes.length, bytes };
}
