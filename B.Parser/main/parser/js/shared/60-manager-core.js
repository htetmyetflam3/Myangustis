// Manager core (shared across site and local entries)
// Extracted from: B.Parser/main/parser/manager.js
// Contains: Manager class fields, constructor, worker slot management,
// #worker, #failLane, #submit, #outPathFor, close, run.
// Not wired into manager.js yet; file names only.

const EXTRACT_URL = new URL("./worker/extract.entry.js", import.meta.url);
const OCR_URL = new URL("./worker/ocr.entry.js", import.meta.url);

const OUTPUT_TYPES = new Set(["txt", "docx", "pdf"]);
const JOBS = new Set(["extracting", "ocr", "null"]);
const METHODS = new Set(["default", "manual", "null"]);
const SOURCE_ENCODINGS = new Set(["auto", "unicode", "zawgyi-one"]);

export { EXTRACT_URL, OCR_URL, OUTPUT_TYPES, JOBS, METHODS, SOURCE_ENCODINGS };
