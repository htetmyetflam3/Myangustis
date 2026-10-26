/**
 * FILE: logen/selftest.js
 *
 * THE SUITE, RUN AT BOOT, BY LOGEN, WHEN LOGGING IS ON.
 *
 * So `npm test` is not a separate step for the site: start the server with
 * checks on and the suite runs in this process, before the first request,
 * and reports through the same logger as everything else.
 *
 * WHAT CAN MOVE HERE, AND WHAT CANNOT
 *
 * Measured, not guessed. Of the 103 tests in this repository:
 *
 *   PURE -- no database, no listening socket. They construct their own
 *   input and assert on a return value. Every backend test of that kind,
 *   and the parser's whole suite, runs here.
 *
 *   NOT PURE -- creates a real sqlite file (cookieQuota, cookieUpsert, db,
 *   migrate) or boots a server and makes requests (engineQueue,
 *   engineRoundtrip, curlOffPath). Running those at boot would mean a
 *   server that writes scratch databases and binds extra ports on startup,
 *   which is worse than running them separately. They stay in `npm test`.
 *
 * So this is not "the test suite moved into the server". It is the half
 * that can honestly run anywhere, run automatically, plus the live chain
 * checks in core.js that cover real traffic. The other 47 still belong to
 * `npm test`, and the boot summary says so rather than implying coverage
 * it does not have.
 *
 * The files are NOT duplicated. This runs the same .test.js files the npm
 * script runs, through node:test's programmatic runner, so there is one
 * owner for every assertion.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import { emitLog, reportInc } from '../../Bridge/logen/core.js';

/** The pure files: no sqlite, no socket. Keep this list honest -- adding a
 *  file that opens a database here makes every boot write one. */
export const PURE_SUITE = [
  'backend/cookie/codec.test.js',
  'backend/cookie/csrf.test.js',
  'backend/file/parser.test.js',
  'backend/gateway/cookieSecurity.test.js',
  'backend/gateway/edge.test.js',
  'backend/gateway/mirrorGuard.test.js',
  'backend/gateway/api/hidden.test.js',
  'backend/gateway/api/uploadMetadata.test.js',
  'backend/gateway/generator/engine.test.js',
  'backend/gateway/queue/artifact.test.js',
  'backend/gateway/queue/managerHandoff.test.js',
  'backend/gateway/queue/processingQueue.test.js',
  // The parser's suite is pure throughout -- no database, no socket.
  'Parsed/parser/test/layers.test.mjs',
  'Parsed/parser/test/scan.test.mjs',
  'Parsed/parser/test/repair.test.mjs',
  'Parsed/parser/test/qpdf.test.mjs',
  'Parsed/parser/test/provenance.test.mjs',
];

/** Tests that need a database or a socket, named so the summary can say
 *  what it did NOT cover rather than leaving a false impression. */
export const EXCLUDED = {
  database: ['cookieQuota', 'cookieUpsert', 'db', 'migrate'],
  server: ['engineQueue', 'engineRoundtrip', 'curlOffPath'],
};

/**
 * Run the pure suite in this process.
 *
 * Never throws and never exits: a self-test that takes the server down is
 * worse than the bug it found. A failure is reported and the boot carries
 * on, because the operator can still read the line.
 */
export async function runSelfTests({ root = process.cwd(), files = PURE_SUITE } = {}) {
  const present = files.filter((f) => fs.existsSync(path.join(root, f)));
  const missing = files.length - present.length;
  if (present.length === 0) {
    emitLog('CHECK', 'skip', 'self-test skipped', { reason: 'no test files present' });
    return { pass: 0, fail: 0, skipped: true };
  }

  const started = Date.now();
  let pass = 0;
  let fail = 0;
  const failures = [];

  /* node:test's run() spawns each file as its own process and forwards
     only the FILE's result, not the individual assertions inside it. So
     the unit here is files, and it is labelled as files -- reporting a
     test count it cannot actually see would be a number that looks like
     coverage and is not. A failing file is named; `npm test` prints the
     assertion. */
  try {
    for await (const ev of run({ files: present.map((f) => path.join(root, f)), concurrency: true })) {
      if (ev.type === 'test:pass') pass += 1;
      else if (ev.type === 'test:fail') {
        fail += 1;
        failures.push(ev.data?.name ?? 'unnamed');
      }
    }
  } catch (error) {
    emitLog('CHECK', 'fail', 'self-test could not run', { error: error.message });
    return { pass, fail, error: error.message };
  }

  const ms = Date.now() - started;
  emitLog('CHECK', fail ? 'fail' : 'success', 'self-test finished', {
    filesPassed: `${pass}/${present.length}`,
    failed: fail,
    ms,
    ...(missing ? { missing } : {}),
    notCovered: `${EXCLUDED.database.length} db + ${EXCLUDED.server.length} server suites — run npm test`,
  });
  for (const name of failures) emitLog('CHECK', 'fail', 'self-test failure', { file: path.relative(root, name) });

  reportInc('CHECK', 'selfTestPassed', pass);
  if (fail) reportInc('CHECK', 'selfTestFailed', fail);
  return { pass, fail, ms, failures };
}
