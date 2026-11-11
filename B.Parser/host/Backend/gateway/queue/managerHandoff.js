















import {
  buildTriggerRequest,
  keyForJob,
} from "../../../../integration/services/trigger-request.js";

const HANDLING = new Set(['extracting', 'ocr', 'null', 'false']);
const MODES = new Set(['default', 'manual']);
const OUTPUTS = new Set(['txt', 'docx', 'pdf']);

const isAnalysis = (intent) => intent?.source === 'analysis';
const handlingOf = (intent) => (isAnalysis(intent) ? intent?.method : intent?.job);
const modeOf = (intent) => (isAnalysis(intent) ? intent?.task : intent?.method);

// Queue -> trigger request: job/caller/limit/worker/key/output travel
// together. `worker` is the caller profile (public/private/service), `key`
// picks one of the two parser worker scripts, and `output` is the requested
// file type (pdf/docx/txt). OCR jobs go to ocr.js; every other handling goes
// to converter.js, which auto-detects PDF vs DOCX (see trigger-request.js).
export function queueTriggerRequest(intent, { executionTask, caller = "public" } = {}) {
  const payload = managerPayload(intent, { executionTask });
  return buildTriggerRequest({
    job: payload.job,
    caller,
    key: keyForJob(payload.job),
    method: payload.method,
    output: payload.output,
  });
}

export function managerPayload(intent, { executionTask } = {}) {
  const handling = handlingOf(intent);
  const mode = modeOf(intent);
  if (!HANDLING.has(handling)) throw new Error('Unsupported manager handling');

  if (handling !== 'false' && !MODES.has(mode)) throw new Error('Unsupported manager mode');
  if (!OUTPUTS.has(intent.outputFormat)) throw new Error('Unsupported output format');
  // Preserve analysis-source metadata, but a conversion-only Site task must
  // produce the requested file, not the DOCX staged for future Engine work.
  return {
    job: handling,
    method: mode ?? 'default',



    output: isAnalysis(intent) && executionTask !== 'conversion' ? 'docx' : intent.desired ?? intent.outputFormat,
  };
}
