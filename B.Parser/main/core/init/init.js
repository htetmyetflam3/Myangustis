// Site entry point (unshared)
// Caller reads the file on their side via streamReader (B) and passes the
// resulting object to BindParser ($) through the dispatcher.
// Public (no identity) and authenticated (identity = authenticatedUser) callers
// share the same path; identity only affects owner access checks.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { streamReader } from '../api/stream-reader.js';
import { dispatchSite } from '../api/dispatcher.js';

function stripCliArtifact(raw) {
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .replace(/^--- Page \d+ ---$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createParserParser(label) {
  return {
    async parse(filePath, out = null, options = {}) {
      const intent = options.intent;
      if (!intent) throw new Error(`${label} upload intent is required`);
      const method = String(intent.method ?? 'extracting').toLowerCase();
      const identity = options.authenticatedUser ?? null;
      const object = await streamReader({ path: filePath });
      let reply;
      try {
        reply = await dispatchSite({ object, method, identity });
      } catch (err) {
        throw new Error(`${label} manager failed`, { cause: err });
      }
      const raw = typeof reply.text === 'string'
        ? reply.text
        : '';
      const text = stripCliArtifact(raw);
      if (!text) {
        const hint =
          label === 'PDF'
            ? ' It is most likely a scan — image-only pages carry no text to extract.'
            : '';
        throw new Error(`No text found in this ${label}.${hint}`);
      }
      return text;
    },
    async bindIdentity() {
      return null;
    },
  };
}
export function createPdfParser() {
  return createParserParser('PDF');
}
export function createDocxParser() {
  return createParserParser('DOCX');
}
