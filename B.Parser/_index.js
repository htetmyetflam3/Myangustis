/*
(Support 2) Shared support, no chain position - a one-line re-export shim.
This module re-exports the engine path helpers from index-path.js for importers that resolve them through B.Parser.
*/
export { JUNK_DIR, getEngineData, getLogen, getEngineNormalize } from '../index-path.js';
