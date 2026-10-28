















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

  if (handling !== 'false' && !MODES.has(mode)) throw new Error('Unsupported manager mode');
  if (!OUTPUTS.has(intent.outputFormat)) throw new Error('Unsupported output format');
  return {
    job: handling,
    method: mode ?? 'default',



    output: isAnalysis(intent) ? 'docx' : intent.desired ?? intent.outputFormat,
  };
}
