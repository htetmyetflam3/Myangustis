import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MUTE_MS = 24 * 60 * 60 * 1000;
const shownHere = new Set();
let initialized = false;
let mutedHereUntil = 0;
let warnedPersistence = false;

function stateDirectory() {
  return process.env.MYANGUSTIS_STATE_DIR || path.join(os.homedir(), '.myangustis');
}

function prepareDirectory() {
  const directory = stateDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

// A --quiet invocation starts a 24-hour mute for later processes too. No
// source text, keys or other document metadata are written to this state.
export function muteAdvisories() {
  initialized = true;
  const until = Date.now() + MUTE_MS;
  mutedHereUntil = until;
  let temporary;
  try {
    const directory = prepareDirectory();
    temporary = path.join(directory, `.quiet-${randomUUID()}.tmp`);
    fs.writeFileSync(temporary, String(until), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, path.join(directory, 'quiet-until'));
  } catch {
    if (!warnedPersistence) {
      warnedPersistence = true;
      process.stderr.write('[advisory] Could not save --quiet; it applies to this process only.\n');
    }
  } finally {
    if (temporary) try { fs.rmSync(temporary, { force: true }); } catch { /* best effort */ }
  }
}

function quietActive() {
  if (!initialized) {
    initialized = true;
    if (process.argv.includes('--quiet') || /^(1|true|yes|on)$/iu.test(process.env.MYANGUSTIS_QUIET || '')) {
      muteAdvisories();
    }
  }
  if (mutedHereUntil > Date.now()) return true;
  try {
    const value = Number(fs.readFileSync(path.join(stateDirectory(), 'quiet-until'), 'utf8'));
    return Number.isFinite(value) && value > Date.now();
  } catch {
    return false;
  }
}

// Advisories are terminal-only and once per user; protocol
// stdout and noninteractive workers are never used for this guidance.
export function advisoryOnce(name, message) {
  if (!/^[a-z0-9-]+$/u.test(name)) throw new TypeError('Invalid advisory name');
  if (shownHere.has(name)) return;
  if (!process.stderr.isTTY) {
    if (!initialized) quietActive();
    return;
  }
  if (quietActive()) return;
  try {
    const marker = path.join(prepareDirectory(), `${name}.seen`);
    const fd = fs.openSync(marker, 'wx', 0o600);
    fs.closeSync(fd);
  } catch (error) {
    if (error?.code === 'EEXIST') { shownHere.add(name); return; }
    // A read-only home must not prevent either the guidance or the job.
  }
  shownHere.add(name);
  process.stderr.write(`${message}\n`);
}
