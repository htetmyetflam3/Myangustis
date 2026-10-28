










import { OutputFile, joinPath } from "../_path.js";
import { readFileContent } from "../MonoSyllabism/utilities/stream.js";
import { toPositions } from "../MonoSyllabism/utilities/formatter.js";







const SAFE_TOKEN_RE = /^[A-Za-z0-9._-]{1,128}$/;


export function hashKind(hash) {
  if (typeof hash !== "string" || !hash) return false;
  if (hash === "." || hash === ".." || hash.includes("..")) return false;
  return SAFE_TOKEN_RE.test(hash);
}


export async function invokeWithHash(hash) {
  const file = joinPath(OutputFile(), `segmented_${hash}_raw_pos.txt`);
  return readFileContent(file);
}


export async function invokeSyllableWithHash(hash) {
  const file = joinPath(OutputFile(), `segmented_${hash}_syllable.txt`);
  const text = await readFileContent(file);
  return text
    .split("\n")
    .map(toPositions)
    .filter((entry) => entry !== null);
}
