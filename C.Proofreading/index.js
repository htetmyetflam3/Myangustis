// Proofreading service entry — re-exports the engine calls this service's
// JS modules (main/mt, plugin/engine) need through the single top-level
// facade, so neither module reaches into Engine/ themselves.
//
// The core MT workflow is Python (main/mt, format); if that side ever needs a
// native entry it gets its own index.py alongside this file rather than a JS
// bridge through here.
export {
  BindEngine,
  readFileContent,
  getDateTimeHash,
  hashKind,
  cacheInfo,
  configureWorkspace,
} from '../Bridge/path.js';
export { tagProofreading } from '../Bridge/proofreading-tagger.mjs';
