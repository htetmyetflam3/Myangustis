import { isMainThread, workerData } from 'node:worker_threads';
import { ValueError } from './pylib.js';

// Only Manager creates this worker after verifying the owner's existing key.
// Request data cannot select this profile inside a shared public worker.
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

export const MAX_INPUT_MB = resourceLimit('UPLOAD_MAX_MB', 64, 2048);
export const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
export const MAX_PAGES = resourceLimit('PRASER_MAX_PAGES', 10_000, 500_000);
export const MAX_TEXT_CHARS = resourceLimit('PRASER_MAX_TEXT_CHARS', 20_000_000, 1_000_000_000);


export const WORKER_TIMEOUT_MS = positiveLimit('PRASER_TIMEOUT_MS', 120_000, 3_600_000);
export const OCR_BASE_TIMEOUT_MS = positiveLimit(
  'PRASER_OCR_TIMEOUT_MS',
  120_000,
  1_800_000,
);
export const WORKER_HEAP_MB = positiveLimit('PRASER_WORKER_HEAP_MB', 384, 1024);
export const MAX_OCR_PIXELS = resourceLimit('PRASER_MAX_OCR_PIXELS', 40_000_000, 100_000_000);

export const MAX_OCR_PAGES = resourceLimit('PRASER_MAX_OCR_PAGES', 50, 500);
export const OCR_PAGE_TIMEOUT_MS = positiveLimit('PRASER_OCR_PAGE_MS', 20_000, 120_000);

export function ocrTimeoutMs(pages = 0) {
  const n = Number.isSafeInteger(pages) && pages > 0 ? Math.min(pages, MAX_OCR_PAGES) : 1;
  return OCR_BASE_TIMEOUT_MS + n * OCR_PAGE_TIMEOUT_MS;
}
