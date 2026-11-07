// Site entry point (unshared)
// Caller reads the file on their side via streamReader (B) and passes the
// resulting object to BindParser ($) through the dispatcher.
// Public (no identity) and authenticated (identity = authenticatedUser) callers
// share the same path; identity only affects owner access checks.
import { streamReader } from '../../core/api/stream-reader.js';
import { dispatchSite } from '../../core/api/dispatcher.js';

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
      const object = trigger.object ?? await streamReader({ path: filePath });
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
      const raw = typeof reply.text === 'string'
        ? reply.text
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
