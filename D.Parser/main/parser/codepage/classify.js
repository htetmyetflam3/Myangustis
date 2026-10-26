// codepage/classify.mjs — cheap, pre-parse caller classification.
//
// The full six-path score still runs inside the pipeline and remains the
// authoritative measurement. This is only the scraper's EARLY gate, and it
// reuses the existing structure test rather than re-decoding anything:
//
//   prepareVectorLayout() returns null for an ordinary Unicode / Zawgyi
//   document (no legacy-layout fonts) and only builds a layout when the PDF
//   carries wininnwa / ayar / vector-repaired legacy fonts. That is exactly
//   the scraper's parse-vs-skip boundary, so one existing function decides it.
//
// A DOCX has no PDF object stream and is never a legacy-font PDF, so it is
// always parseable. Any failure fails OPEN to parsing — a classifier that
// cannot see the document must not drop it.
import { prepareVectorLayout } from './resolve.mjs';

/**
 * @param {Buffer|Uint8Array|string} source  bytes or a server-local path
 * @param {string} inputKind                  'pdf' | 'docx'
 * @returns {Promise<{skip:boolean, reason:string, encodingPath?:string|null}>}
 */
export async function classifyScraperSource(source, inputKind, log = () => {}) {
  if (String(inputKind ?? 'pdf').toLowerCase() === 'docx') {
    return { skip: false, reason: 'docx-not-a-legacy-pdf', encodingPath: null };
  }
  try {
    const layout = await prepareVectorLayout(source, log);
    if (!layout) {
      // No legacy-layout fonts: Unicode / ZawCode / OCR territory — allowed.
      return { skip: false, reason: 'no-legacy-layout-fonts', encodingPath: null };
    }
    return {
      skip: true,
      reason: 'legacy-font-not-convertible',
      // The vector build is keyed by its font-derived name; the policy layer
      // treats every non-(unicode|zawcode) path as a legacy/vector skip.
      encodingPath: layout.name ?? 'vector',
    };
  } catch {
    return { skip: false, reason: 'classify-unavailable-fail-open', encodingPath: null };
  }
}
