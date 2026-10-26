// Native engine boundary for the host web service.
//
// Everything web/queue lives in host/; the segmentation/tagging stays in
// architecture/ and is reached through the single BindEngine entry — no
// direct import of an individual engine routine. The Site job worker pulls
// source text over the queue and hands the string straight into the bridge:
// the readFromApi() memory generator head feeds the same pipeline a file
// would, so no temp .txt is ever staged. The tagged output is streamed to
// the engine workspace by the engine's own writer and read back with the
// engine's stream reader (readFileContent), not host-level fs calls.
//
// Job identity: the Site queue's formId (one UUID per file, derived at
// upload) IS the job id on both webs. It is passed as the bridge hash solely
// to namespace segmented_<formId>_* against parallel runs — the web layer
// never looks anything up by hash; job state in JobStore is the authority.
import path from 'node:path';
import { BindEngine } from '../../architecture/bridge/bind-engine.js';
import { readFileContent } from '../../architecture/MonoSyllabism/utilities/stream.js';

// RESULT_MIME on the Site side (analysisFinalize.js):
//   txt -> text/plain | docx -> wordprocessingml.document | pdf -> application/pdf
// The engine emits checked/segmented text, so its artifact is always txt.
const RESULT_EXTENSION = 'txt';
const RESULT_MIME = 'text/plain';

function safeStem(filename) {
  // Site result-name gate: /^[A-Za-z0-9][A-Za-z0-9._ -]{0,250}$/ and no '..'
  const stem = path.basename(String(filename ?? 'answer')).replace(/\.[^.]*$/, '');
  const cleaned = stem.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^\.+/, '').slice(0, 200) || 'answer';
  return cleaned;
}

/**
 * Run the native pipeline over pulled source text and return a Site-ready
 * artifact. The text travels in memory through readFromApi(); the only disk
 * touch is the engine writer's segmented_<formId>_* output, whose path the
 * bridge result returns and readFileContent streams back.
 */
export async function runEngineJob({ record, sourceText }) {
  if (typeof sourceText !== 'string' || sourceText.length === 0) {
    throw new Error('runEngineJob: sourceText string is required');
  }

  // formId is the cross-web job id: outputs land as segmented_<formId>_*
  // purely for parallel-run collision avoidance. The result carries the
  // concrete output path back, so nothing here resolves a file by hash.
  const result = await BindEngine('site', { hash: record.formId, sourceText });
  if (!result.rawPosPath) {
    throw new Error('engine path-A returned no rawPosPath output');
  }
  const outputText = await readFileContent(result.rawPosPath);

  const bytes = Buffer.from(outputText, 'utf8');
  return {
    filename: `${safeStem(record.filename)}.${RESULT_EXTENSION}`,
    extension: RESULT_EXTENSION,
    mime: RESULT_MIME,
    bytes,
  };
}
