import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as root from '../../../index-path.js';
import * as engine from '../../../Architecture/Engine/_path.js';
import * as parser from '../../../B.Parser/_path.js';
import * as site from '../../../F.Site/_path.js';
import * as tools from '../../../tools-box/_path.js';
import * as proofreading from '../../../C.Proofreading/index.js';
import { BindEngine } from '../../../Architecture/_index.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

test('component path chains reach the same root logging module and event bus', async () => {
  const main = await root.getLogen();
  for (const component of [engine, parser, site, tools]) {
    assert.strictEqual(await component.getLogen(), main);
  }
  assert.strictEqual(main.siteLog.bus, main.coreLog.bus);
  const event = `test-${Date.now()}`;
  let seen;
  const handler = value => { seen = value; };
  main.coreLog.bus.once(event, handler);
  main.siteLog.emitEvent(event, { value: 7 });
  assert.equal(seen.value, 7);
  assert.strictEqual(proofreading.BindEngine, BindEngine);
  assert.equal(typeof proofreading.tagProofreading, 'function');
  for (const old of ['Bridge/logen', 'Architecture/Engine/bridge/logen.js',
    'F.Site/site_logen/engine.js', 'Bridge/proofreading-tagger.js']) {
    assert.equal(fs.existsSync(path.join(repo, old)), false, old);
  }
});

test('parser and site helpers remain available from the consolidated logger', async () => {
  const logger = await root.getLogen();
  const sink = logger.parserLog.collect();
  logger.parserLog.tee(sink)('hello');
  assert.deepEqual(sink.lines, ['hello']);
  assert.equal(logger.parserLog.resolveLog({ logging: false }), logger.parserLog.SILENT);
  const fakeMorgan = (format, options) => ({ format, options });
  const consoleLogger = logger.httpLog.createHttpConsoleLogger(fakeMorgan);
  assert.equal(typeof consoleLogger.format, 'function');
  const stream = {};
  assert.deepEqual(logger.httpLog.createHttpFileLogger(fakeMorgan, stream), { format: 'combined', options: { stream } });
  const output = [];
  const db = { prepare: () => ({ run: (...args) => args }) };
  logger.sqlLog.attachSqlLogging(db, line => output.push(line));
  assert.deepEqual(db.prepare('SELECT ?').run(42), [42]);
  assert.match(output.join(''), /SQL: SELECT \?/);
  assert.match(output.join(''), /Values: \[42\]/);
});
