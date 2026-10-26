#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MANAGED_KEYS = [
  'MODE',
  'NODE_ENV',
  'COOKIE_SECRET',
  'SESSION_SECRET',
  'TRUST_PROXY',
  'EDGE_SECRET',
  'FSM_KEY',
  'ENGINE_KEY_ANSWER',
];

const SECRET_KEYS = [
  'COOKIE_SECRET',
  'SESSION_SECRET',
  'FSM_KEY',
  'ENGINE_KEY_ANSWER',
];

function randomSecret() {
  // 32 random bytes = 256 bits, represented by 64 hexadecimal characters.
  return crypto.randomBytes(32).toString('hex');
}

function readAssignments(content) {
  const values = new Map();

  for (const line of content.split(/\r?\n/)) {
    const match =
      /^(?:\s*export\s+|\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(
        line,
      );

    if (match && !values.has(match[1])) {
      values.set(match[1], match[2]);
    }
  }

  return values;
}

function semanticValue(raw = '') {
  let value = String(raw).trim();

  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  } else {
    value = value.replace(/\s+#.*$/, '').trim();
  }

  return value;
}

function replaceManagedValues(content, values) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = content.endsWith('\n');
  const lines = content.split(/\r?\n/);

  if (hadFinalNewline) {
    lines.pop();
  }

  const seen = new Set();
  const output = [];

  for (const line of lines) {
    const match =
      /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/.exec(
        line,
      );

    if (!match || !values.has(match[2])) {
      output.push(line);
      continue;
    }

    const key = match[2];

    // Remove duplicate managed assignments so a stale duplicate cannot win.
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(`${match[1]}${key}${match[3]}${values.get(key)}`);
  }

  const missing = MANAGED_KEYS.filter((key) => !seen.has(key));

  if (missing.length > 0) {
    if (output.length > 0 && output[output.length - 1] !== '') {
      output.push('');
    }

    output.push('# Generated production identity and integration values');

    for (const key of missing) {
      output.push(`${key}=${values.get(key)}`);
    }
  }

  return `${output.join(newline)}${hadFinalNewline ? newline : ''}`;
}

function printSummary({ filePath, values, edgeEnabled }) {
  const rows = MANAGED_KEYS.map((key) => `${key}=${values.get(key)}`);

  const width = Math.max(
    ...rows.map((row) => row.length),
    filePath.length + 9,
    34,
  );

  const border = '─'.repeat(width + 2);

  console.log(`\n┌${border}┐`);
  console.log(`│ ${`Updated: ${filePath}`.padEnd(width)} │`);
  console.log(`├${border}┤`);

  for (const row of rows) {
    console.log(`│ ${row.padEnd(width)} │`);
  }

  console.log(`└${border}┘`);
  console.log(
    '\nGenerated secrets use 32 cryptographically random bytes (256 bits).',
  );
  console.log(
    'Warning: these values are visible in this terminal. Do not copy them into logs.',
  );

  if (edgeEnabled) {
    console.log(
      'EDGE_SECRET is active: the proxy must send the matching x-edge-secret header.',
    );
  } else {
    console.log(
      'EDGE_SECRET remains blank, so direct-hosted Site traffic stays enabled.',
    );
  }
}

export async function regenerateEnv({
  filePath = path.resolve('.env'),
  enableEdge = false,
  print = true,
} = {}) {
  const target = path.resolve(filePath);

  const stat = await fs.lstat(target).catch((error) => {
    if (error?.code === 'ENOENT') {
      throw new Error(`Existing environment file not found: ${target}`);
    }

    throw error;
  });

  if (!stat.isFile()) {
    throw new Error(`Environment path is not a regular file: ${target}`);
  }

  const original = await fs.readFile(target, 'utf8');
  const existing = readAssignments(original);

  // TRUST_PROXY is topology configuration, not a random secret.
  // Preserve its existing value.
  const currentTrustProxy = existing.get('TRUST_PROXY') ?? '';

  // A blank EDGE_SECRET keeps direct-hosted operation enabled.
  // An existing nonblank value is rotated.
  const currentEdgeSecret = semanticValue(existing.get('EDGE_SECRET'));
  const edgeEnabled = enableEdge || currentEdgeSecret.length > 0;

  const values = new Map([
    ['MODE', 'production'],
    ['NODE_ENV', 'production'],
    ['TRUST_PROXY', currentTrustProxy],
    ['EDGE_SECRET', edgeEnabled ? randomSecret() : ''],
  ]);

  for (const key of SECRET_KEYS) {
    values.set(key, randomSecret());
  }

  // Ensure cookie encryption and session signing never share a key.
  if (values.get('COOKIE_SECRET') === values.get('SESSION_SECRET')) {
    values.set('SESSION_SECRET', randomSecret());
  }

  const updated = replaceManagedValues(original, values);

  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );

  try {
    await fs.writeFile(temporary, updated, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });

    // Atomic replacement on the same filesystem.
    await fs.rename(temporary, target);
    await fs.chmod(target, 0o600);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }

  if (print) {
    printSummary({
      filePath: target,
      values,
      edgeEnabled,
    });
  }

  return Object.fromEntries(values);
}

function usage() {
  console.log(`Usage: node utility-tools/regenerate-env.mjs [options]

Options:
  --file <path>    Existing .env file to update (default: ./.env)
  --enable-edge    Generate EDGE_SECRET even when currently blank
  --quiet          Update the file without printing secret values
  --help           Show this help

The script preserves every unrelated line in the existing file.

It updates only:

  MODE=production
  NODE_ENV=production
  COOKIE_SECRET=<new 32-byte random secret>
  SESSION_SECRET=<new 32-byte random secret>
  TRUST_PROXY=<existing value>
  EDGE_SECRET=<blank unless already enabled or --enable-edge>
  FSM_KEY=<new 32-byte random secret>
  ENGINE_KEY_ANSWER=<new 32-byte random secret>
`);
}

function parseArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--help') {
      return { help: true };
    }

    if (arg === '--quiet') {
      options.print = false;
      continue;
    }

    if (arg === '--enable-edge') {
      options.enableEdge = true;
      continue;
    }

    if (arg === '--file') {
      const value = args[index + 1];

      if (!value) {
        throw new Error('--file requires a path');
      }

      options.filePath = value;
      index += 1;
      continue;
    }

    if (arg.startsWith('--file=')) {
      options.filePath = arg.slice('--file='.length);
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

const isCli =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isCli) {
  try {
    const options = parseArgs(process.argv.slice(2));

    if (options.help) {
      usage();
    } else {
      await regenerateEnv(options);
    }
  } catch (error) {
    console.error(`[env] ${error.message}`);
    process.exitCode = 1;
  }
}