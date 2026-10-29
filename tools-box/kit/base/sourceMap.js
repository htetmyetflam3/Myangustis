/**
 * Myanmar character mapping data.
 *
 * All mapping objects live in sourceMap.json so the data can be audited,
 * regenerated, and reused without editing executable code. This module only
 * turns the JSON arrays into Sets and exposes the JSON tables to consumers.
 */
// The builder reads the same encrypted master as the runtime. The WASM payload
// builder replaces this import and expression with the mapData section in-box.
import { readMasterJson } from "../master/secure.js";
const mapData = readMasterJson().mapData;

// Set-based tables used by normalize.js and the segmenter.
export const PUNCTUATION = new Set(mapData.PUNCTUATION);
export const Glue = new Set(mapData.Glue);
export const ENGLISH_DIGITS = new Set(mapData.ENGLISH_DIGITS);
export const BURMESE_DIGITS = new Set(mapData.BURMESE_DIGITS);
export const ALL_DIGITS = new Set([...ENGLISH_DIGITS, ...BURMESE_DIGITS]);

export const BLOCK_PUNCT = new Set(mapData.BLOCK_PUNCT);

// Structured mapping data is JSON data, not executable object literals.
const MMap = mapData.MMap;
const NewMap = mapData.NewMap;
const newClause = mapData.newClause;
const Priority = mapData.Priority;
const IMPOSTER = mapData.IMPOSTER;

export { MMap, NewMap, newClause, IMPOSTER, Priority };
