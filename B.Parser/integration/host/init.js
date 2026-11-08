/*
(Support 5) Shared support, no chain position - the site-side parser factory.
This module creates the converter, PDF and DOCX parsers the site calls, over the shared Manager pool, and closes that pool on shutdown.
*/
// Site entry point (unshared)
// Caller reads the file on their side via BindInput (input-dispatcher) and passes the
// resulting object to BindParser ($) through the dispatcher.
// Public (no identity) and authenticated (identity = authenticatedUser) callers
// share the same path; identity only affects owner access checks.
import { BindInput } from '../../core/api/input-dispatcher.js';
import { dispatchSite } from '../../core/api/dispatcher.js';
import { pool } from '../../core/manager/manager-core.js';

// Shutdown for the shared parser manager pool behind the site dispatchers.
// Safe to call more than once; the pool clears its own worker table.
export async function closePraserManager() {
  await pool.close();
}

function stripCliArtifact(raw) {
  return raw
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .replace(/^--- Page \d+ ---$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// One converter parser for both PDF and DOCX. The caller does not split by
// input file type here: the trigger's key/output are forwarded and
// converter.js detects PDF vs DOCX inside the worker.
export function createConverterParser() {
  return {
    async parse(filePath, out = null, options = {}) {
      const intent = options.intent;
      if (!intent) throw new Error('Converter upload intent is required');
      const trigger = options.trigger ?? {};
      const method = String(trigger.method ?? intent.method ?? 'default').toLowerCase();
      const job = trigger.job ?? intent.job ?? 'extracting';
      const identity = options.authenticatedUser ?? null;
      // For queued Site requests, the queue's file reader has already read
      // the file and placed it on the trigger. Only read it here when this
      // parser is called without that queue-provided object.
      const object = trigger.object ?? await BindInput({ path: filePath });
      let reply;
      try {
        reply = await dispatchSite({
          object,
          method,
          identity,
          job: { job, method },
          key: trigger.key ?? (job === 'ocr' ? 'ocr' : 'converter'),
          output: trigger.output ?? intent.outputFormat ?? intent.desired ?? 'txt',
          limit: trigger.limit ?? null,
          worker: trigger.worker ?? null,
        });
      } catch (err) {
        throw new Error('Converter manager failed', { cause: err });
      }
      // The dispatcher returns the parse result: per-page records for txt
      // (pages[].text), or an assembled `text` when a worker provides one.
      // Assemble page texts with the same separators PdfTextSink writes;
      // stripCliArtifact below removes them again.
      const raw = typeof reply.text === 'string'
        ? reply.text
        : Array.isArray(reply.pages)
          ? reply.pages
            .map((p, i) => `--- Page ${i + 1} ---\n${typeof p === 'string' ? p : (p?.text ?? '')}`)
            .join('\n')
          : '';
      const text = stripCliArtifact(raw);
      if (!text) {
        throw new Error('No text found in this file. It is most likely a scan — image-only pages carry no text to extract.');
      }
      return text;
    },
    async bindIdentity() {
      return null;
    },
  };
}

// Backwards-compatible names: both are the same auto-detecting converter.
export function createPdfParser() {
  return createConverterParser();
}

export function createDocxParser() {
  return createConverterParser();
}
