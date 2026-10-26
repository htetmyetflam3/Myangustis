import fs from 'node:fs/promises';
import path from 'node:path';
import { createResponseGenerator } from './responses.js';
import { moveFile } from '../../file/saveOriginfile.js';
import { RAW_TXT_DIR, ORIGINAL_DIR, abs } from '../../file/paths.js';
export function createRawSaver() {
  const generator = createResponseGenerator();
  return async function saveRaw({ formId, textContent, metadata, submitId = null }) {
    const { submitId: finalId, filename } = generator.generate({
      formId,
      sessionId: metadata.visitorHash,
      originalName: metadata.originalName,
      submitId,
    });
    const rawPath = path.join(abs(RAW_TXT_DIR), `${finalId}.txt`);
    let originalPath = null;
    await fs.mkdir(abs(RAW_TXT_DIR), { recursive: true });
    await fs.mkdir(abs(ORIGINAL_DIR), { recursive: true });
    try {
      await fs.writeFile(rawPath, textContent, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      if (metadata.originalName && metadata.quarantinePath) {
        originalPath = path.join(abs(ORIGINAL_DIR), filename);
        await moveFile(metadata.quarantinePath, originalPath);
      }
    } catch (error) {
      await Promise.allSettled([
        fs.unlink(rawPath),
        originalPath ? fs.unlink(originalPath) : Promise.resolve(),
      ]);
      throw error;
    }
    return {
      saved: true,
      rawPath,
      originalPath,
      submitId: finalId,
      filename,
    };
  };
}
export async function cleanupRawResult(result) {
  if (!result) return;
  await Promise.allSettled(
    [result.rawPath, result.originalPath].filter(Boolean).map((file) => fs.unlink(file)),
  );
}