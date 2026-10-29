import fs from 'node:fs/promises';
/* `source` selects the column, and the column decides what each field is
   CALLED. Two facts, two labels per column, and the labels differ:

     HOW THE FILE IS HANDLED   extracting | ocr | null | false
       source=converter   metadata.job
       source=analysis    metadata.method

     HOW THAT IS CARRIED OUT   default | manual
       source=converter   metadata.method
       source=analysis    metadata.task

   So there is no `job` under analysis at all, and no `task` under converter.
   Read them through handlingOf()/modeOf(); never touch either name directly.

   `false` is the handling for a text input: it is already text, so there is
   nothing to parse. The fused 'extracting-analysis' / 'conversion-analysis'
   jobs are gone -- `source` already says which column this is. */
const SOURCES = new Set(['converter', 'analysis']);
/* Measured from the upload's text/image byte share:
     text    a text layer and nothing worth reading in the images
     image   pixels only -- a scan
     mixed   both: a real text layer AND image boxes that hold text
   `mixed` is the case the user is prompted about, and it is the one that
   needs the second worker group, so it pairs with handling "null". */
const CONTENT = new Set(['text', 'image', 'mixed']);
const HANDLING = new Set(['extracting', 'ocr', 'null', 'false']);
const MODES = new Set(['default', 'manual']);

/** Is this the analysis column? Read `source`, never a work field. */
export function isAnalysis(intent) {
  return intent?.source === 'analysis';
}

/** How the file is handled, under whichever label this column uses. */
export function handlingOf(intent) {
  return isAnalysis(intent) ? intent?.method : intent?.job;
}

/** How that handling is carried out, under whichever label this column uses. */
export function modeOf(intent) {
  return isAnalysis(intent) ? intent?.task : intent?.method;
}
const INPUTS = new Set(['txt', 'pdf', 'docx']);
const CONVERSIONS = new Set(['txt', 'docx', 'pdf']);
const MAX_OCR_PAGES = (() => {
  const raw = process.env.PRASER_MAX_OCR_PAGES;
  const n = /^\d+$/.test(String(raw ?? '')) ? Number.parseInt(raw, 10) : 50;
  return n >= 1 && n <= 500 ? n : 50;
})();
const MAX_PARSER_PAGES = (() => {
  const raw = process.env.PRASER_MAX_PAGES;
  const n = /^\d+$/.test(String(raw ?? '')) ? Number.parseInt(raw, 10) : 10_000;
  return n >= 1 && n <= 500_000 ? n : 10_000;
})();
const DETECTORS = new Set(['text', 'pdf.js', 'mammoth']);
function one(value, field) {
  if (Array.isArray(value)) throw new Error(`${field} must be a single value`);
  return value;
}
function requiredString(value, field) {
  if (typeof value !== 'string' || !value) throw new Error(`metadata.${field} is required`);
}
function member(value, values, field) {
  if (!values.has(value)) throw new Error(`Unsupported metadata.${field}: ${String(value)}`);
}
function nonnegative(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`metadata.detector.${field} must be a non-negative integer`);
  }
}
export function readUploadMetadata(body = {}, file = null) {
  const raw = one(body.metadata, 'metadata');
  if (raw === undefined) throw new Error('Submissions require metadata JSON');
  let intent;
  if (typeof raw === 'string') {
    try {
      intent = JSON.parse(raw);
    } catch (error) {
      throw new Error('metadata must be valid JSON', { cause: error });
    }
  } else {
    intent = raw;
  }
  if (!intent || Array.isArray(intent) || typeof intent !== 'object') {
    throw new Error('metadata must be a JSON object');
  }
  if (intent.v !== 1) throw new Error('metadata.v must be 1');
  member(intent.source, SOURCES, 'source');
  requiredString(intent.originalName, 'originalName');
  requiredString(intent.uploadName, 'uploadName');
  if (
    intent.originalName.length > 255 ||
    /[\u0000-\u001f\u007f]/.test(intent.originalName) ||
    intent.originalName.includes('/') ||
    intent.originalName.includes('\\')
  ) {
    throw new Error('metadata.originalName is not a safe filename');
  }
  if (
    intent.uploadName.includes('/') ||
    intent.uploadName.includes('\\') ||
    (file && (file.originalname.includes('/') || file.originalname.includes('\\')))
  ) {
    throw new Error('Upload filename must not contain path separators');
  }
  const allowedUploadExt = file ? 'pdf|docx' : 'txt';
  const uploadNamePattern = new RegExp(`^\\d{8}T\\d{6}Z__[a-zA-Z0-9._-]+\\.(${allowedUploadExt})$`);
  if (intent.uploadName.length > 255 || !uploadNamePattern.test(intent.uploadName)) {
    throw new Error('Upload filename must follow frontend timestamped format');
  }
  member(intent.fileFormat, INPUTS, 'fileFormat');
  if (!file && intent.fileFormat !== 'txt') {
    throw new Error('Text submissions require metadata.fileFormat txt');
  }
  if (file && intent.fileFormat === 'txt') {
    throw new Error('File uploads require PDF or DOCX metadata.fileFormat');
  }
  if (intent.desired === undefined) intent.desired = intent.conversion;
  member(intent.desired, CONVERSIONS, 'desired');
  if (intent.conversion === undefined) intent.conversion = intent.desired;
  member(intent.conversion, CONVERSIONS, 'conversion');
  
  
  
  Object.defineProperties(intent, {
    inputFormat: { value: intent.fileFormat, enumerable: false, writable: true },
    outputFormat: { value: intent.desired, enumerable: false, writable: true },
  });
  if (file) {
    if (file.originalname !== intent.uploadName) {
      throw new Error('Uploaded filename does not match metadata.uploadName');
    }
    if (extension(file.originalname) !== intent.inputFormat) {
      throw new Error('Uploaded filename extension does not match metadata.inputFormat');
    }
  }
  if (extension(intent.originalName) !== intent.inputFormat) {
    throw new Error('Original filename extension does not match metadata.inputFormat');
  }
  member(intent.content, CONTENT, 'content');
  /* One label per column, and only that one. Sending the other column's name
     is a routing mistake, not a synonym. */
  if (isAnalysis(intent)) {
    if (intent.job !== undefined) {
      throw new Error('metadata.job is a converter label; analysis carries method and task');
    }
    member(intent.method, HANDLING, 'method');
    if (intent.method !== 'false') member(intent.task, MODES, 'task');
  } else {
    if (intent.task !== undefined) {
      throw new Error('metadata.task is an analysis label; converter carries job and method');
    }
    member(intent.job, HANDLING, 'job');
    if (intent.job !== 'false') member(intent.method, MODES, 'method');
  }
  requiredString(intent.clickedAt, 'clickedAt');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(intent.clickedAt)) {
    throw new Error('metadata.clickedAt must be an ISO-8601 UTC timestamp');
  }
  const d = intent.detector;
  if (!d || Array.isArray(d) || typeof d !== 'object') {
    throw new Error('metadata.detector is required');
  }
  member(d.name, DETECTORS, 'detector.name');
  for (const field of ['pages', 'textPages', 'imagePages', 'myanmarChars', 'myanmarLetters', 'imageBytes', 'textBytes']) {
    nonnegative(d[field], field);
  }
  if (typeof d.confirmed !== 'boolean') {
    throw new Error('metadata.detector.confirmed must be a boolean');
  }
  if (intent.inputFormat === 'pdf' && d.pages > MAX_PARSER_PAGES) {
    throw new Error(
      `PDF has ${d.pages} pages; the server accepts at most ${MAX_PARSER_PAGES} pages per file`,
    );
  }

  if (
    intent.inputFormat === 'txt' &&
    (intent.content !== 'text' || handlingOf(intent) !== 'false')
  ) {
    throw new Error('Text submissions require text extraction metadata');
  }
  /* THE MODE DECIDES WHAT HAPPENS TO IMAGE BOXES, SO IT DECIDES THE OUTPUT.
       default  skips every image box  -> there is nothing to carry, so the
                only honest output is txt
       manual   re-embeds the images   -> needs a format that can hold them,
                so docx or pdf, never txt
     This is the one rule that binds output format to the mode; everything
     else about the output is the caller's choice. */
  if (modeOf(intent) === 'default' && intent.outputFormat !== 'txt') {
    throw new Error(
      `the default mode skips image boxes, so it cannot produce ${intent.outputFormat}; use txt`,
    );
  }
  if (modeOf(intent) === 'manual' && !['docx', 'pdf'].includes(intent.outputFormat)) {
    throw new Error(
      'the manual mode re-embeds images, so it needs a docx or pdf output',
    );
  }

  /* OCR reads pixels, so it needs a PDF whose content is image. It says
     nothing about the mode: handling is WHICH recovery route, mode is what
     happens to image boxes on the way out. They are independent now, so the
     old `mode must be default` clause here is stale -- it dated from when
     OCR could only ever be asked for alongside method:"default". A scanned
     PDF returned as docx is OCR plus re-embedded pages, which is legal. */
  if (handlingOf(intent) === 'ocr' && (intent.inputFormat !== 'pdf' || intent.content !== 'image')) {
    throw new Error('OCR handling requires a PDF whose content is image');
  }
  /* mixed and null are the same fact under two headings, so neither may
     appear without the other. */
  if ((intent.content === 'mixed') !== (handlingOf(intent) === 'null')) {
    throw new Error('content "mixed" and the "null" handling require each other');
  }
  if (intent.content === 'image' && d.pages > MAX_OCR_PAGES) {
    throw new Error(
      `Scanned PDF has ${d.pages} pages; OCR accepts at most ${MAX_OCR_PAGES} at a time. Split the file and submit it in parts.`,
    );
  }
  if (intent.method === 'null' && intent.inputFormat !== 'docx') {
    throw new Error('The null method is DOCX-only');
  }
  return intent;
}
function extension(name = '') {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export async function validateUploadedFileSignature(file) {
  if (!file?.path) throw new Error('Uploaded file is missing');
  const format = extension(file.originalname || file.filename || '');
  const handle = await fs.open(file.path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 4) throw new Error('Uploaded file is empty or truncated');
    const prefix = Buffer.alloc(Math.min(1024, stat.size));
    await handle.read(prefix, 0, prefix.length, 0);
    if (format === 'pdf') {
      if (prefix.indexOf(Buffer.from('%PDF-')) < 0) {
        throw new Error('Uploaded PDF has an invalid file signature');
      }
      const tailSize = Math.min(4096, stat.size);
      const tail = Buffer.alloc(tailSize);
      await handle.read(tail, 0, tailSize, stat.size - tailSize);
      if (!tail.includes(Buffer.from('%%EOF'))) {
        throw new Error('Uploaded PDF is truncated or has no PDF trailer');
      }
      return 'pdf';
    }
    if (format === 'docx') {
      if (!prefix.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        throw new Error('Uploaded DOCX has an invalid ZIP file signature');
      }
      return 'docx';
    }
    throw new Error('Only PDF and DOCX uploads are accepted');
  } finally {
    await handle.close();
  }
}