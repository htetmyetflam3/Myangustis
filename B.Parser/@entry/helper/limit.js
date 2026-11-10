/*
(new/limit) Limits for the input stage, up to decryption.
The caps every stage in this tree lands by: how big an input may be,
how far a collector may write before it must stop. Env-tunable with
hard maximums; owner workers (parserOwner stamped by the Manager)
are uncapped, everyone else gets the numbers below.
*/
import { isMainThread, workerData } from "node:worker_threads";
import { ValueError } from "../../core/@helper/pylib.js";

export const OWNER_PARSER_WORKER = !isMainThread && workerData?.parserOwner === true;

export function positiveLimit(name, fallback, maximum) {
  const raw = process.env[name] ?? String(fallback);
  if (!/^\d+$/.test(String(raw))) {
    throw new ValueError(name + " must be a positive integer");
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new ValueError(name + " must be between 1 and " + maximum);
  }
  return value;
}

export function resourceLimit(name, fallback, maximum) {
  return OWNER_PARSER_WORKER ? Infinity : positiveLimit(name, fallback, maximum);
}

export const MAX_INPUT_MB = resourceLimit("LOCAL_UPLOAD_MAX_MB", 128, 4096);
export const MAX_INPUT_BYTES = MAX_INPUT_MB * 1024 * 1024;
export const MAX_PAGES = resourceLimit("LOCAL_MAX_PAGES", 20_000, 1_000_000);
export const MAX_OCR_PIXELS = resourceLimit("LOCAL_MAX_OCR_PIXELS", 25_000_000, 200_000_000);
export const MAX_TEXT_CHARS = resourceLimit("LOCAL_MAX_TEXT_CHARS", 50_000_000, 2_000_000_000);
export const MAX_DOCX_ENTRIES = resourceLimit("PRASER_MAX_DOCX_ENTRIES", 4096, 20000);
export const MAX_DOCX_MEMBER_MB = resourceLimit("PRASER_MAX_MEMBER_MB", 64, 256);
export const MAX_DOCX_TOTAL_MB = resourceLimit("PRASER_MAX_DOCX_TOTAL_MB", 128, 512);
export const MAX_DOCX_RATIO = OWNER_PARSER_WORKER ? Infinity : 200;
