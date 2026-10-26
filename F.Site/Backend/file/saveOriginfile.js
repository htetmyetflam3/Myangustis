import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { QUARANTINE_DIR, abs } from './paths.js';
const fsp = fs.promises;
export async function moveFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.rename(source, destination);
  } catch (err) {
    if (err?.code !== 'EXDEV') throw err;
    await fsp.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    await fsp.unlink(source);
  }
  await fsp.chmod(destination, 0o600);
  return destination;
}
export function createSaveOriginal({ quarantineDir } = {}) {
  const dir = abs(quarantineDir || QUARANTINE_DIR);
  return async function saveOriginal(file) {
    const ext = path.extname(file?.originalname || '').toLowerCase();
    const safeExt = ext === '.pdf' || ext === '.docx' ? ext : '';
    const destination = path.join(dir, `${crypto.randomUUID()}${safeExt}`);
    return moveFile(file.path, destination);
  };
}
export async function deleteStoredFile(filePath) {
  if (!filePath) return;
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    if (err?.code !== 'ENOENT') throw err;
  }
}