// Engine shared entry — the SINGLE door every external service imports.
//
// New engine shape: callers (Scraper, Proofreading, host web, root Bridge)
// never reach into architecture/ themselves. They import this file and call
// BindEngine(signature, payload) — the WASM-shaped boundary that owns routine
// selection, the hash guard and the web slot queue.
//
//   BindEngine('scraper',      { hash, sourceText | inputPath })  path B syllables
//   BindEngine('proofreading', { hash, sourceText | inputPath })  path A tagger
//   BindEngine('site',         { hash, sourceText | inputPath })  path A, /job worker
//   BindEngine('public',       { hash, sourceText | inputPath })  path B, tokenizer API
//
// Supporting exports are the minimum a caller needs around one call:
//   readFileContent  engine stream reader for the result path BindEngine returns
//   getDateTimeHash  internal-hash minter for callers with no id of their own
//   hashKind         output-id shape guard (flat filename token only)
//   cacheInfo        built-in prebuilt-tree manifest view (verifies on read)
//   configureWorkspace  retarget the mutable workspace for an offline run
export { BindEngine } from './architecture/bridge/bind-engine.js';
export { readFileContent } from './architecture/MonoSyllabism/utilities/stream.js';
export { getDateTimeHash } from './architecture/bridge/logen.js';
export { hashKind } from './architecture/init/initS.js';
export { cacheInfo } from './architecture/MonoSyllabism/main/grapheme/cache-integrity.js';
export { configureWorkspace } from './architecture/bridge/path.js';
