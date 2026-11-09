/*
(Support 23) Shared support, no chain position - the local caller's limit profile.
This module defines the size, page and text caps for trusted local stream callers, read from environment variables with hard maximums.
*/
// Local limits (local caller — stream-based)
// Split from shared 03-limits.js — local caller has looser caps because the
// caller already holds the stream/object and the parser never touches the
// original source path directly.
import { isMainThread, workerData } from 'node:worker_threads';
import { ValueError } from '../pylib.js';

// Local stream owner is trusted: the caller opened the stream themselves.
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

// Local caller caps: looser than site because the caller is trusted
// (CLI, Python, internal service) and supplies the stream directly.
export const MAX_INPUT_MB = resourceLimit('LOCAL_UPLOAD_MAX_MB', 128, 4096);
export const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
export const MAX_PAGES = resourceLimit('LOCAL_MAX_PAGES', 20_000, 1_000_000);
export const MAX_TEXT_CHARS = resourceLimit('LOCAL_MAX_TEXT_CHARS', 50_000_000, 2_000_000_000);

export const WORKER_TIMEOUT_MS = positiveLimit('LOCAL_TIMEOUT_MS', 300_000, 3_600_000);
export const OCR_BASE_TIMEOUT_MS = positiveLimit(
  'LOCAL_OCR_TIMEOUT_MS',
  300_000,
  3_600_000,
);
export const WORKER_HEAP_MB = positiveLimit('LOCAL_WORKER_HEAP_MB', 512, 2048);
export const MAX_OCR_PIXELS = resourceLimit('LOCAL_MAX_OCR_PIXELS', 80_000_000, 200_000_000);

export const MAX_OCR_PAGES = resourceLimit('LOCAL_MAX_OCR_PAGES', 100, 1000);
export const OCR_PAGE_TIMEOUT_MS = positiveLimit('LOCAL_OCR_PAGE_MS', 30_000, 300_000);

export function ocrTimeoutMs(pages = 0) {
  const n = Number.isSafeInteger(pages) && pages > 0 ? Math.min(pages, MAX_OCR_PAGES) : 1;
  return OCR_BASE_TIMEOUT_MS + n * OCR_PAGE_TIMEOUT_MS;
}
