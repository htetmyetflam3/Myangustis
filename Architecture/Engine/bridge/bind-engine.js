// BindEngine — the ONE integration entry into the engine.
//
// Pre-design for the binary/WASM exporter the engine will later ship behind:
// a compiled boundary exposes a single callable, not a tree of importable
// routines. So every caller — a local in-process runner or a web process
// boosting the engine — imports BindEngine and nothing else from the bridge.
// Individual routines stay reachable only through the signature dispatch in
// the internal bridge.js sibling; reaching around this entry is a design
// violation, not a supported call style.
//
// Boundary contract (kept FFI-shaped on purpose):
//   signature  a plain STRING naming the caller, not a field of an options
//              object — the routine and the field set are decided FROM it.
//   payload    object carrying this caller's own fields; every payload must
//              carry hash. The hash is NOT validated for shape here and the
//              segmentor never sees it: it only names segmented_<hash>_* so
//              parallel processes cannot collide on the output workspace.
//              Missing hash stops the run at input receiving.
//
// Throws are plain STRINGS, never Error objects: a string is what crosses a
// WASM/serialized boundary intact. Nothing here logs — a boundary throw is a
// quiet failure of THIS run. At the express layer a string throw becomes a
// refusal response; the web process itself keeps running.
//
// Queue guard: the two web signatures (public, site) delay behind a bounded
// slot before their routine runs — the accept-fast/queue shape already used
// by Bridge/api-server.js and the Site upload side, sized by
// config.maxConcurrent (SlotLimiter in job-store.mjs, the pending-list
// queue primitive). Local in-process signatures run inline, no queue.
import { config } from '../../host/config.mjs';
import { SlotLimiter } from '../../host/job-store.mjs';
import { handlers } from './bridge.js';

// One bound for the whole process: web requests wait here, local calls don't.
const webSlots = new SlotLimiter(config.maxConcurrent);
const QUEUED_SIGNATURES = Object.freeze(new Set(['public', 'site']));

/**
 * Bind a caller to its predefined engine routine.
 *
 * @param {string} signature caller name; selects path A/B and the routine.
 * @param {object} [payload]  the caller's fields; hash is mandatory.
 * @returns {Promise<object>} the routine's result object.
 * @throws {string} quiet string failure; the web layer maps it to a refusal.
 */
export async function BindEngine(signature, payload = {}) {
  // No field enumeration, no examples: a bad envelope gets one quiet line.
  if (typeof signature !== 'string' || signature.trim() === '') {
    throw 'BindEngine: provide a caller signature';
  }
  if (payload === null || typeof payload !== 'object') {
    throw 'BindEngine: provide a caller signature';
  }

  // Hash guard at input receiving. Presence only — its job is output
  // namespacing across parallel runs, so a missing one must stop here.
  const { hash } = payload;
  if (typeof hash !== 'string' || hash === '') {
    throw 'BindEngine: hash is required';
  }

  const routine = handlers[signature];
  if (!routine) {
    throw 'BindEngine: unknown caller signature';
  }

  if (QUEUED_SIGNATURES.has(signature)) {
    await webSlots.acquire();
    try {
      return await routine(payload);
    } finally {
      webSlots.release();
    }
  }
  return routine(payload);
}
