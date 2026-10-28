// Engine Bridge internals — routine selection for the sole public entry
// BindEngine in ./bind-engine.js.
//
// This module deliberately exports NO callable entry of its own: callers
// import BindEngine (the WASM-shaped single entry) and the signature string
// decides everything here. Reaching around BindEngine into these handlers
// corrupts the boundary design.
//
// Caller routing — the signature BindEngine receives selects the routine:
//
//   'public'       -> path B, syllable-only segmenting
//   'scraper'      -> path B, syllable-only segmenting
//   'site'         -> path A, bridge() full tagger/kernel (the /job worker)
//   'proofreading' -> path A, bridge() two-file form
//   'debugger'     -> path A, bridgeDebug() five-file debug form
//
// The engine routines live in ../init/bridge.js:
//   path B  bridgeSyllable()  normalize -> runSegmentor -> syllable writer.
//           No POS tagger, no rule kernel — the tokenizer API only segments.
//   path A  bridge()          fullstopHolder -> runTagger -> runRuleEngine
//           (pass-through kernel), dual syllable/raw_pos writers.
//           bridgeDebug()     the same chain incl. the same kernel, plus the
//           runIdMapper observability stage: five hardcoded outputs
//           (syllable, raw_pos, ids, id_mapper, id_merged) for the debugger
//           caller only — a rare-event mapping safety net, never a daily run.
//
// Payload: file-based callers (the web worker) pass { hash, inputPath } and
// the segmentor generator is assembled here exactly as runMain does. An
// in-process caller may instead pass a ready `seg` generator. BindEngine
// requires the external caller to supply its hash.
//
// Throws are plain strings, quiet by contract: BindEngine owns the boundary
// and the express layer turns them into refusal responses.

import { readAndPrepare, readFromApi } from "../MonoSyllabism/generators/input.js";
import { runSegmentor } from "../MonoSyllabism/main/phoneme/lexer.js";

const ENGINE_BRIDGE = "../init/bridge.js";

// File -> segmentor generator, the same three-step kick runMain uses
// (input read -> normalize -> segmentor). A prebuilt seg passes straight
// through so in-process callers keep their own assembly. An in-memory API
// body (sourceText string) takes the readFromApi() memory head — no temp
// file and no fs read before the engine's own output writer.
function resolveSeg(fields = {}) {
  if (fields.seg) return fields.seg;
  if (typeof fields.sourceText === "string" && fields.sourceText.length > 0) {
    return runSegmentor(readFromApi(fields.sourceText));
  }
  if (typeof fields.inputPath !== "string" || !fields.inputPath) {
    throw "bridge: inputPath or sourceText is required when no seg generator is supplied";
  }
  return runSegmentor(readAndPrepare(fields.inputPath));
}

// The writer's flush cadence is sized from the input: a file path is stat'd,
// an in-memory API source passes its byte count (getFlushLines accepts both).
function inputRef(fields = {}) {
  if (fields.inputPath) return fields.inputPath;
  if (typeof fields.sourceText === "string") {
    return Buffer.byteLength(fields.sourceText, "utf8");
  }
  return undefined;
}

/* ── Path B: syllable-only — the tagger and kernel are never built ── */
async function pathBSyllable(fields = {}) {
  const { bridgeSyllable, receiveCallerHash } = await import(ENGINE_BRIDGE);
  const sessionHash = receiveCallerHash(fields.hash);
  const seg = resolveSeg(fields);
  return bridgeSyllable(seg, { syllable: true }, sessionHash, inputRef(fields));
}

/* ── Path A: full tagger/kernel, dual syllable + raw_pos writers ── */
async function pathAFull(fields = {}) {
  const { bridge, receiveCallerHash } = await import(ENGINE_BRIDGE);
  const sessionHash = receiveCallerHash(fields.hash);
  const seg = resolveSeg(fields);
  return bridge(seg, { syllable: true, rawPos: true }, sessionHash, inputRef(fields));
}

/* ── Path A debug: five hardcoded observability outputs, same kernel ── */
async function pathADebug(fields = {}) {
  const { bridgeDebug, receiveCallerHash } = await import(ENGINE_BRIDGE);
  const sessionHash = receiveCallerHash(fields.hash);
  const seg = resolveSeg(fields);
  return bridgeDebug(seg, null, sessionHash, inputRef(fields));
}

// Workspace setup and output read-back belong to the bridge, not its callers.
// The engine writer/session and workspace are process-global. Keep each run's
// setup, pipeline and read-back together before letting the next caller in.
let pendingRun = Promise.resolve();
function run(fields, routine) {
  const result = pendingRun.then(() => runInWorkspace(fields, routine));
  pendingRun = result.catch(() => {});
  return result;
}

async function runInWorkspace(fields, routine) {
  const { configureWorkspace, GetOutputDir, GetLogDir } = await import('../_path.js');
  const { readFileContent } = await import('../MonoSyllabism/utilities/stream.js');
  const previous = { outputDir: GetOutputDir(), logDir: GetLogDir() };
  try {
    if (fields.work) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dirs = { outputDir: path.resolve(fields.work, 'out'), logDir: path.resolve(fields.work, 'log') };
      for (const dir of Object.values(dirs)) fs.mkdirSync(dir, { recursive: true });
      configureWorkspace(dirs);
    }
    const result = await routine(fields);
    return {
      ...result,
      syllable: result.syllablePath ? await readFileContent(result.syllablePath) : null,
      rawPos: result.rawPosPath ? await readFileContent(result.rawPosPath) : null,
    };
  } finally {
    if (fields.work) configureWorkspace(previous);
  }
}

export const handlers = Object.freeze({
  public: fields => run(fields, pathBSyllable),
  scraper: fields => run(fields, pathBSyllable),
  site: fields => run(fields, pathAFull),
  proofreading: fields => run(fields, pathAFull),
  debugger: fields => run(fields, pathADebug),
});
