import test from 'node:test';
import assert from 'node:assert/strict';
import { matchRasterMask } from '../../../B.Parser/prised/@postprocess/repair/match.js';

test('raster-to-SVG matching advises on every call, even with --quiet', () => {
  const warnings = [];
  const originalWarn = console.warn;
  const index = { size: 2, byText: new Map(), entries: [] };
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    assert.equal(matchRasterMask(new Uint8Array(4), 2, 2, { index }).reason, 'empty crop');
    process.argv.push('--quiet');
    assert.equal(matchRasterMask(new Uint8Array(4), 2, 2, { index }).reason, 'empty crop');
  } finally {
    if (process.argv.at(-1) === '--quiet') process.argv.pop();
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 2);
  for (const warning of warnings) {
    assert.match(warning, /text-based PDF/u);
    assert.match(warning, /image-based PDFs and OCR/u);
  }
});
