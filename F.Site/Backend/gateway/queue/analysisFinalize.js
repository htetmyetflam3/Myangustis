import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeDocxPlain, writePdf } from '../../../../Parser/main/parser/index.mjs';
import { storeAnalysisArtifact } from './artifact.js';

export const RESULT_MIME = new Map([
  ['txt', 'text/plain'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['pdf', 'application/pdf'],
]);

function extensionOf(name = '') {
  const dot = String(name).lastIndexOf('.');
  return dot < 0 ? '' : String(name).slice(dot + 1).toLowerCase();
}

function replaceExtension(name, ext) {
  const safe = path.basename(String(name || `answer.${ext}`));
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  return `${stem || 'answer'}.${ext}`;
}

async function synthesizeFromText({ text, requested, filename, submitId, outputDir, sourceName }) {
  await fs.mkdir(outputDir, { recursive: true, mode: 0o700 });
  const finalName = replaceExtension(filename, requested);
  const tmp = path.join(
    outputDir,
    `.${submitId}_${finalName}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    if (requested === 'docx') {
      await writeDocxPlain(tmp, text);
    } else if (requested === 'pdf') {
      await writePdf(tmp, [text], { Analysis: 'Engine result' }, sourceName || filename, 1);
    } else {
      throw new Error(`Cannot synthesize requested analysis extension: ${requested}`);
    }
    const bytes = await fs.readFile(tmp);
    return await storeAnalysisArtifact({ bytes, filename: finalName, submitId, outputDir });
  } finally {
    await fs.unlink(tmp).catch(() => {});
  }
}

export function acceptsAnalysisResultExtension({ returned, requested, staged }) {
  if (returned === requested) return true;
  // For analysis, the Site stages an editable DOCX source and the Engine may
  // return checked text. The Site then owns final DOCX/PDF rendering from the
  // queue's requestedExtension.
  return staged === 'docx' && returned === 'txt' && (requested === 'docx' || requested === 'pdf');
}

export async function finalizeAnalysisArtifact({
  job,
  bytes,
  filename,
  returnedExtension,
  outputDir,
}) {
  const returned = String(returnedExtension || '').toLowerCase();
  const requested = String(job.requestedExtension || '').toLowerCase();
  const staged = String(job.managerFormat || '').toLowerCase();
  if (!acceptsAnalysisResultExtension({ returned, requested, staged })) {
    throw new Error('Result extension does not match the requested extension');
  }
  if (extensionOf(filename) !== returned) {
    throw new Error('Result filename does not carry the result extension');
  }
  if (returned === requested) {
    const stored = await storeAnalysisArtifact({
      bytes,
      filename,
      submitId: job.submitId,
      outputDir,
    });
    return {
      ...stored,
      filename: stored.filename,
      mimeType: RESULT_MIME.get(requested),
    };
  }
  const text = bytes.toString('utf8');
  const stored = await synthesizeFromText({
    text,
    requested,
    filename,
    submitId: job.submitId,
    outputDir,
    sourceName: job.originalName || job.uploadName,
  });
  return {
    ...stored,
    filename: stored.filename,
    mimeType: RESULT_MIME.get(requested),
  };
}
