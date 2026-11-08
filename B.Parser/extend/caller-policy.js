/*
(Support 40) Shared support, no chain position - caller policy.
This module defines the known callers and, for each caller, how encoding verdicts (legacy path, vector layout path) are decided.
*/














export const CALLERS = Object.freeze({
  SITE: 'site',
  SCRAPER: 'scraper',
  LOCAL: 'local',
});



const SCRAPER_ENCODING_ALLOW = Object.freeze(new Set(['unicode', 'zawcode']));

const KNOWN_NAMED_PATHS = Object.freeze(new Set(['unicode', 'zawcode', 'wininnwa', 'ayar']));

export function normalizeCaller(caller) {
  const key = String(caller ?? CALLERS.SITE).trim().toLowerCase();
  // Trigger callers map onto the internal caller vocabulary:
  // public -> site, owner -> local, scraper stays scraper.
  if (key === CALLERS.SCRAPER) return CALLERS.SCRAPER;
  if (key === CALLERS.LOCAL || key === 'owner') return CALLERS.LOCAL;
  return CALLERS.SITE;
}



export function isVectorLayoutPath(encodingPath) {
  return Boolean(encodingPath) && !KNOWN_NAMED_PATHS.has(encodingPath);
}

export function isLegacyFontPath(encodingPath) {
  if (!encodingPath) return false;
  return encodingPath === 'wininnwa' || encodingPath === 'ayar' || isVectorLayoutPath(encodingPath);
}








export function decideForCaller(caller, verdict = {}) {
  const who = normalizeCaller(caller);
  const { encodingPath = null, lane = 'extract' } = verdict;

  if (who !== CALLERS.SCRAPER) {
    return { action: 'parse', caller: who };
  }


  if (lane === 'ocr') {
    return { action: 'parse', caller: who, reason: 'ocr-lane' };
  }


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
