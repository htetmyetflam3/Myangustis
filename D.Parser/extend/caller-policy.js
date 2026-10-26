// caller-policy.mjs — the ONE place caller policy lives.
//
// The parser's six internal text paths are measurement, not policy, and stay
// in codepage/ (unicode, zawcode, wininnwa, ayar, the auto-built vector
// layout) plus the separate OCR lane. This module only answers: given WHO is
// calling and what the document was measured to be, may this caller parse it?
//
//   site     — every path runs (today's full behaviour), OCR allowed.
//   scraper  — the Python scraper's shape: only Unicode, Zawgyi-convertible
//              (zawcode) and OCR. An old-font layout (wininnwa / ayar / the
//              font-named vector layout) is SKIPPED, not parsed and not errored.
//
// Pure module: no fs, no workers, no pdf deps — unit testable on its own.

export const CALLERS = Object.freeze({
  SITE: 'site',
  SCRAPER: 'scraper',
});

// Paths the scraper may parse. Everything else the codepage scorer can emit
// (wininnwa, ayar, or a font-named vector layout) is an old-font skip.
const SCRAPER_ENCODING_ALLOW = Object.freeze(new Set(['unicode', 'zawcode']));

const KNOWN_NAMED_PATHS = Object.freeze(new Set(['unicode', 'zawcode', 'wininnwa', 'ayar']));

export function normalizeCaller(caller) {
  const key = String(caller ?? CALLERS.SITE).trim().toLowerCase();
  return key === CALLERS.SCRAPER ? CALLERS.SCRAPER : CALLERS.SITE;
}

// A vector layout carries the FONT NAME as its path id, not a fixed token, so
// it is recognised as "anything that is not one of the four named tables".
export function isVectorLayoutPath(encodingPath) {
  return Boolean(encodingPath) && !KNOWN_NAMED_PATHS.has(encodingPath);
}

export function isLegacyFontPath(encodingPath) {
  if (!encodingPath) return false;
  return encodingPath === 'wininnwa' || encodingPath === 'ayar' || isVectorLayoutPath(encodingPath);
}

/**
 * Decide parse vs skip for one measured document.
 *
 * @param {string} caller  'site' | 'scraper'
 * @param {object} verdict  { encodingPath?: string|null, lane?: 'extract'|'ocr' }
 * @returns {{action:'parse'|'skip', caller:string, reason?:string, encodingPath?:string}}
 */
export function decideForCaller(caller, verdict = {}) {
  const who = normalizeCaller(caller);
  const { encodingPath = null, lane = 'extract' } = verdict;

  if (who === CALLERS.SITE) {
    return { action: 'parse', caller: who };
  }

  // Scraper. OCR is its own lane and always allowed (scanned image, no font table).
  if (lane === 'ocr') {
    return { action: 'parse', caller: who, reason: 'ocr-lane' };
  }
  // No measurement yet: fail OPEN to parsing rather than silently dropping a
  // document. The cheap pre-gate and the post-parse verdict both call here.
  if (!encodingPath) {
    return { action: 'parse', caller: who, reason: 'verdict-unavailable-fail-open' };
  }
  if (SCRAPER_ENCODING_ALLOW.has(encodingPath)) {
    return { action: 'parse', caller: who, encodingPath };
  }
  return {
    action: 'skip',
    caller: who,
    reason: 'legacy-font-not-convertible',
    encodingPath,
  };
}
