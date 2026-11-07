// Site limits (public + authenticated callers)
// Split from shared 03-limits.js — site caller has its own caps.
// Public (no identity) and authenticated (identity = authenticatedUser)
// share the same limit profile; the only difference is owner access checks.
import { isMainThread, workerData } from 'node:worker_threads';
import { ValueError } from '../../core/pylib.js';

// Manager creates this profile for a trusted local stream or an identity
// handed off by an authenticated caller, never from public job metadata.
export const OWNER_PARSER_WORKER = !isMainThread && workerData?.parserOwner === true;

export function positiveLimit(name, fallback, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(String(raw))) {
    throw new ValueError(`${name} must be a positive integer`);
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ValueError(`${name} must be between 1 and ${maximum}`);
  }
  return value;
}

export function resourceLimit(name, fallback, maximum) {
  return OWNER_PARSER_WORKER ? Infinity : positiveLimit(name, fallback, maximum);
}

// Site caller caps: tighter than local because public uploads come from
// unauthenticated network callers.
export const MAX_INPUT_MB = resourceLimit('SITE_UPLOAD_MAX_MB', 32, 1024);
export const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
export const MAX_PAGES = resourceLimit('SITE_MAX_PAGES', 5_000, 200_000);
export const MAX_TEXT_CHARS = resourceLimit('SITE_MAX_TEXT_CHARS', 10_000_000, 500_000_000);

export const WORKER_TIMEOUT_MS = positiveLimit('SITE_TIMEOUT_MS', 120_000, 3_600_000);
export const OCR_BASE_TIMEOUT_MS = positiveLimit(
  'SITE_OCR_TIMEOUT_MS',
  120_000,
  1_800_000,
);
export const WORKER_HEAP_MB = positiveLimit('SITE_WORKER_HEAP_MB', 256, 768);
export const MAX_OCR_PIXELS = resourceLimit('SITE_MAX_OCR_PIXELS', 20_000_000, 50_000_000);

export const MAX_OCR_PAGES = resourceLimit('SITE_MAX_OCR_PAGES', 25, 200);
export const OCR_PAGE_TIMEOUT_MS = positiveLimit('SITE_OCR_PAGE_MS', 20_000, 120_000);

export function ocrTimeoutMs(pages = 0) {
  const n = Number.isSafeInteger(pages) && pages > 0 ? Math.min(pages, MAX_OCR_PAGES) : 1;
  return OCR_BASE_TIMEOUT_MS + n * OCR_PAGE_TIMEOUT_MS;
}
