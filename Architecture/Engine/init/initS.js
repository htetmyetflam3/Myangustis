/* initS.js — hash validation + output read-back for the engine core.
 *
 * Self-contained inside architecture: it only reaches the engine's own path
 * contract, stream reader and formatter. Nothing above Engine is imported.
 *
 * The hash is not parsed for meaning by the segmentor — its job is to keep
 * parallel runs from colliding on segmented_<hash>_* output names. hashKind()
 * therefore accepts the real id shapes the callers use (engine datetime hash,
 * UUID submit id from the Site, 32-hex session key) while refusing anything
 * that could escape the output directory.
 */
import { OutputFile, joinPath } from "../bridge/path.js";
import { readFileContent } from "../MonoSyllabism/utilities/stream.js";
import { toPositions } from "../MonoSyllabism/utilities/formatter.js";

// The id shapes callers actually use — kept as documentation of the contract:
//   YYYYMMDD_HHMMSS_mmm  engine datetime hash (getDateTimeHash)
//   8-4-4-4-12 hex       crypto.randomUUID() Site submit id
//   32 hex               session key
// Every one of them is a flat filename token, so the single SAFE_TOKEN_RE
// below accepts them all while refusing separators / path traversal.
const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** True when `hash` is a usable, namespace-safe output id. */
export function hashKind(hash) {
  if (typeof hash !== "string" || !hash) return false;
  if (hash === "." || hash === ".." || hash.includes("..")) return false;
  return SAFE_TOKEN_RE.test(hash);
}

/** Read the POS-tagged output for a hash: segmented_<hash>_raw_pos.txt. */
export async function invokeWithHash(hash) {
  const file = joinPath(OutputFile(), `segmented_${hash}_raw_pos.txt`);
  return readFileContent(file);
}

/** Read the syllable output for a hash as positional maps (Burmese only). */
export async function invokeSyllableWithHash(hash) {
  const file = joinPath(OutputFile(), `segmented_${hash}_syllable.txt`);
  const text = await readFileContent(file);
  return text
    .split("\n")
    .map(toPositions)
    .filter((entry) => entry !== null);
}
