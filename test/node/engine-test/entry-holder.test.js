import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINE_BYTES, toLineStrings } from '../../../Architecture/Engine/MonoSyllabism/generators/SfomatterForP.js';
import { fullstopHolder } from '../../../Architecture/Engine/MonoSyllabism/generators/pos-input.js';

async function* segments(...items) {
  yield* items;
}
const collect = source => Array.fromAsync(source);

test('entry holder emits a line at the limit, then resets the byte count', async () => {
  const limit = 'a'.repeat(MAX_LINE_BYTES);
  assert.deepEqual(await collect(toLineStrings(segments(limit, '\n', 'next', '\n'))), [limit, 'next']);
});

test('overflow clears the buffer including the triggering item and continues the same line', async () => {
  const almost = 'a'.repeat(MAX_LINE_BYTES - 1);
  assert.deepEqual(await collect(toLineStrings(segments(almost, 'bc', 'tail', '\n'))), ['tail']);
});

test('an overflowed line without a remaining tail does not emit an empty line', async () => {
  const oversized = 'a'.repeat(MAX_LINE_BYTES + 1);
  assert.deepEqual(await collect(toLineStrings(segments(oversized, '\n', '\n', 'later'))), ['', 'later']);
  assert.deepEqual(await collect(toLineStrings(segments(oversized))), []);
});

test('the limit counts UTF-8 bytes instead of JavaScript string length', async () => {
  const exactly = 'က'.repeat(Math.floor(MAX_LINE_BYTES / 3));
  assert.deepEqual(await collect(toLineStrings(segments(exactly, 'က', 'ကျန်', '\n'))), ['ကျန်']);
});

test('multiple overflows discard each buffer and retain only the final tail', async () => {
  const limit = 'x'.repeat(MAX_LINE_BYTES);
  assert.deepEqual(await collect(toLineStrings(segments(limit, 'x', limit, 'x', 'end'))), ['end']);
});

test('the POS holder receives only the retained entry-holder tail', async () => {
  const oversized = 'x'.repeat(MAX_LINE_BYTES + 1);
  const lines = toLineStrings(segments(oversized, 'က√။√', '\n', 'ခ√။√', '\n'));
  assert.deepEqual(await collect(fullstopHolder(lines)), ['က√။√ √ခ√။√']);
});
