// Top-level service facade — the ONLY place outside Engine/ that knows where
// the engine lives. Every service (Scraper, Proofreading, Parser helpers)
// imports its engine calls from here; this file imports the shared engine
// entry and re-exports, so an engine reorg changes this one file only.
//
// The filename is kept as path.js for import stability: it was the old
// engine-shim path every service already referenced. It no longer defines
// filesystem layout — the engine owns its own paths behind Engine/index.js.
//
// Python-side services (crawler, mt) keep their own thin integration layer;
// the JS facade below is the single door for Node callers.
export {
  BindEngine,
  readFileContent,
  getDateTimeHash,
  hashKind,
  cacheInfo,
  configureWorkspace,
} from '../Engine/index.js';
