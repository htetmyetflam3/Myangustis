/* What the site hands the parser manager.

   Each column spells the two work facts with its own labels:

     HOW THE FILE IS HANDLED   extracting | ocr | null | false
       source=converter   intent.job
       source=analysis    intent.method

     HOW THAT IS CARRIED OUT   default | manual
       source=converter   intent.method
       source=analysis    intent.task

   They are read through the two helpers below and passed on under one
   internal name, so nothing downstream has to know which column it came
   from. `source` already says which that is, which is why the fused
   'extracting-analysis' / 'conversion-analysis' job values are gone. */
const HANDLING = new Set(['extracting', 'ocr', 'null', 'false']);
const MODES = new Set(['default', 'manual']);
const OUTPUTS = new Set(['txt', 'docx', 'pdf']);

const isAnalysis = (intent) => intent?.source === 'analysis';
const handlingOf = (intent) => (isAnalysis(intent) ? intent?.method : intent?.job);
const modeOf = (intent) => (isAnalysis(intent) ? intent?.task : intent?.method);

export function managerPayload(intent) {
  const handling = handlingOf(intent);
  const mode = modeOf(intent);
  if (!HANDLING.has(handling)) throw new Error('Unsupported manager handling');
  // A text input is not parsed at all, so it carries no mode.
  if (handling !== 'false' && !MODES.has(mode)) throw new Error('Unsupported manager mode');
  if (!OUTPUTS.has(intent.outputFormat)) throw new Error('Unsupported output format');
  return {
    job: handling,
    method: mode ?? 'default',
    // Analysis always stages an editable DOCX source for the Engine round.
    // The queue still keeps requestedExtension/outputFormat for the final
    // callback format (txt/docx/pdf).
    output: isAnalysis(intent) ? 'docx' : intent.desired ?? intent.outputFormat,
  };
}
