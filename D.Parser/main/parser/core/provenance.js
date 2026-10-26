/**
 * FILE: Parsed/parser/core/provenance.mjs
 *
 * THE REGISTER. One append-only file recording what every document actually
 * was, so a broken word in a corpus can be traced back to the PDF that made it.
 *
 * WHY THIS EXISTS
 * Everything in a record below was already being computed on every run -- the
 * /Info metadata, the embedded legacy font faces, the code-page ranking -- and
 * all of it went to `log()`, which is stdout, which is gone the moment the
 * terminal scrolls. The one artifact that survived a run (the scan report)
 * knew the damage and nothing about where the damage came from. This closes
 * that: the broken cluster and the reason for it now live in the same place.
 *
 * It replaces opening the PDF in an online metadata viewer to find out which
 * Zawgyi foundry font a document used.
 *
 * THIS IS AUTHORING EQUIPMENT, NOT A PRODUCT FEATURE.
 * It exists for corpus building and testing. It is deliberately one file with
 * one call site per entry point, importing nothing from the parser, so it can
 * be deleted later by removing this file, `REGISTER_LOG` in core/paths.mjs,
 * and the handful of `provenance` lines the removal will then make unresolved.
 *
 * SWITCHES
 *   PRASER_REGISTER=0            off
 *   PRASER_REGISTER=/some/path   write somewhere other than the default
 *
 * FORMAT -- greppable by filename first, machine-readable second:
 *
 *   ───────────────────────────────────────────────
 *   bg-mlc-1-1.pdf
 *   2026-10-06T09:14:22.108Z
 *   ───────────────────────────────────────────────
 *   { ...one JSON object... }
 *
 * `grep -n '^bg-mlc' register.log` finds the document; the JSON under it is
 * the whole story.
 */

import fs from "node:fs";
import path from "node:path";

const RULE = "\u2500".repeat(60);

const off = () => /^(0|false|no|off)$/iu.test(String(process.env.PRASER_REGISTER ?? ""));

/**
 * Start a record. Every field is optional and filled in as the run discovers
 * it, so a run that dies early still writes what it knew.
 */
export function startRecord(source = "") {
  return {
    source: source ? path.basename(source) : "",
    sourcePath: source || "",
    at: new Date().toISOString(),
    pages: null,
    detection: null,
    metadata: null,   // the PDF's own /Info dictionary
    fonts: null,      // embedded legacy font faces, if any
    codepage: null,   // which byte table won, what it scored, what it beat
    scan: null,       // damage counts from the scan report
    output: null,
  };
}

/** Merge facts into a record. Null/undefined records are ignored, so every
 *  call site can stay a one-liner without guarding. */
export function note(record, facts) {
  if (!record || !facts) return record;
  for (const [key, value] of Object.entries(facts)) {
    if (value !== undefined) record[key] = value;
  }
  return record;
}

/** Where the register lives. Caller passes the default from core/paths.mjs so
 *  this module keeps importing nothing. */
export function registerPath(fallback) {
  const chosen = String(process.env.PRASER_REGISTER ?? "").trim();
  return chosen && !off() ? chosen : fallback;
}

/**
 * Append one entry. Never throws: a failure to journal must not fail a
 * conversion, so problems are reported through `log` and swallowed.
 */
export function appendRecord(record, { file, log = () => {} } = {}) {
  if (!record || off() || !file) return null;
  const entry = [
    RULE,
    record.source || "(unnamed)",
    record.at,
    RULE,
    JSON.stringify(record, null, 2),
    "",
    "",
  ].join("\n");
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, entry, "utf8");
    return file;
  } catch (error) {
    log(`[-] Register not written (${error.message})`);
    return null;
  }
}
