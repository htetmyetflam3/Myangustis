/**
 * FILE: logen/engine.js
 *
 * THE ENGINE HALF. The ledgers, the cross-module reconciliation, and the
 * checks that go with them.
 *
 * FOR TRANSPLANT. The modules this covers -- normalize, the segmentor
 * (lexer.js) and the walker (traverser.js) -- live on the architecture
 * branch, not here. This file is written to be copied there, next to an
 * identical logen/core.js, and to work without a single change. It is kept
 * in this tree only so the two halves are written against the same core
 * and cannot drift apart unnoticed.
 *
 * The shared core now lives at the top-level Bridge/logen/ (the future
 * cross-engine lib); this file imports it from there directly.
 *
 * Nothing in here imports the site half, and the site half does not import
 * this. Both import the core.
 *
 * WHAT IT EXPECTS TO BE EMITTED
 *
 *   'normalize' { total, final, finalNoSpace, spaces,
 *                 braceChars, braceBlocks, collapsed, composed, swap }
 *
 *   'segment'   { characters, bypassBlocks, bypassSpaces, quit, failed }
 *
 * The caller builds `composed`, `swap` and `failed` in a buffer it already
 * owns -- a plain Map, incremented in its own loop -- and emits ONCE when
 * the function returns. logen offers no in-loop helper on purpose: a
 * logger reachable from the hot path is how the engine ended up logging
 * per syllable and then having all of it switched off.
 */
import core, {
  bus, registerBadges, installBase, emitLog, appendFile, paint, palette as C,
  reportInc, reportSample, record, runChecks, defineCheck, stage,
  readTally, readCounts, showPairs, showCounts,
} from '../../Bridge/logen/core.js';

export * from '../../Bridge/logen/core.js';

registerBadges({
  NORMALIZE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'NORM' },
  SEGMENT: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'SEGMNT' },
  WALKER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'WALKER' },
  TAGGER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'TAGGER' },
  BRIDGE: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'BRIDGE' },
  BUILD: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'BUILD' },
  READER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'READER' },
  WRITER: { code: '\x1b[48;5;23m\x1b[38;5;231m', label: 'WRITER' },
});

export const normalize = stage('NORMALIZE');
export const segment = stage('SEGMENT');
export const walker = stage('WALKER');
export const tagger = stage('TAGGER');
export const bridge = stage('BRIDGE');
export const build = stage('BUILD');
export const reader = stage('READER');
export const writer = stage('WRITER');

/* The last normalize ledger, so the segment listener can reconcile the two.
   This is the cross-module check the architecture branch's own header
   promised -- "math must work across modules to catch disappearing
   tokens" -- and never performed. */
let _lastNormalize = null;

export function installEngineLog({ file = '', checks = false } = {}) {
  const first = installBase({ file, checks });
  if (!first) return false;
  registerEngineChecks();

  /* ── normalize ─────────────────────────────────────────────────────
     Two ledgers, both of which must close.

       total = final + collapsed + braceChars
       final = finalNoSpace + spaces

     Braced content is BYPASSED, not dropped: it leaves the sequence
     whole, so it has to be named or the total stops balancing. */
  bus.on('normalize', (ev) => {
    const {
      total, final, finalNoSpace, spaces = 0,
      braceChars = 0, braceBlocks = 0, collapsed = 0,
      composed, swap, module = 'NORMALIZE',
    } = ev;
    const comp = readTally(composed);
    const swp = readTally(swap);

    const ledger = Number(final) + Number(collapsed) + Number(braceChars);
    const lost = Number(total) - ledger;
    const split = Number(finalNoSpace) + Number(spaces);
    const splitOff = Number(final) - split;
    const ok = lost === 0 && splitOff === 0;

    emitLog(module, ok ? 'success' : 'warn', 'normalize finished', {
      total,
      final,
      finalNoSpace,
      spaces,
      brace: `${braceBlocks} blocks / ${braceChars} chars`,
      collapsed: `${collapsed} spaces`,
      composed: `${comp.total} (${comp.chars ?? '?'} chars)`,
      swap: `${swp.total} (${swp.chars ?? '?'} chars)`,
      ...(lost ? { unaccounted: lost } : {}),
      ...(splitOff ? { splitMismatch: splitOff } : {}),
    });

    /* Disk gets every pair, always: that is the trace. The console gets
       them only when the arithmetic fails, because then they are the
       evidence rather than noise. */
    for (const [label, tally] of [['composed', comp], ['swap', swp]]) {
      if (tally.pairs.length) appendFile(`  ${label} ${showPairs(tally.pairs, Infinity)}`);
    }
    if (!ok) {
      for (const [label, tally] of [['composed', comp], ['swap    ', swp]]) {
        if (tally.pairs.length) {
          console.log(`  ${paint(C.comment, label)} ${showPairs(tally.pairs, 12)}`);
        }
      }
    }

    _lastNormalize = {
      final: Number(final),
      finalNoSpace: Number(finalNoSpace),
      spaces: Number(spaces),
      braceBlocks: Number(braceBlocks),
    };

    record('normalize', ev);
    runChecks('normalize', ev);
    reportInc(module, 'normalizePasses');
    for (const pr of comp.pairs) reportSample(module, 'composedPairs', `${pr.from}=>${pr.to}`, 40);
    for (const pr of swp.pairs) reportSample(module, 'swapPairs', `${pr.from}=>${pr.to}`, 40);
    if (lost) reportInc(module, 'normalizeUnaccounted', Math.abs(lost));
  });

  /* ── segment ───────────────────────────────────────────────────────
     THE THREE EXITS of a walk, and which is which:

       leaf step NOT final, unmatched char is a MARK -> failed
           the tree should have had this and did not, so the path is kept
       leaf step NOT final, unmatched char is a BASE -> quit
           a new syllable simply starts here
       leaf step IS final (St-F)                     -> quit
           the walk ended where it was meant to

     Both exits produce a syllable, so syllables = quit + failed. */
  bus.on('segment', (ev) => {
    const {
      characters = 0, bypassBlocks = 0, bypassSpaces = 0,
      quit = 0, failed, module = 'SEGMENT',
    } = ev;
    const bad = readCounts(failed);
    const quits = readCounts(quit).total;
    const syllables = quits + bad.total;
    const avg = syllables > 0 ? Number(characters) / syllables : 0;

    /* The walker never sees a space or a braced block, so both are named
       rather than quietly missing from what it was handed. */
    const received = Number(characters) + Number(bypassSpaces);

    const n = _lastNormalize;
    const mismatch = [];
    if (n) {
      if (received !== n.final) mismatch.push(`received ${received} != normalize.final ${n.final}`);
      if (Number(characters) !== n.finalNoSpace) mismatch.push(`walked ${characters} != finalNoSpace ${n.finalNoSpace}`);
      if (Number(bypassSpaces) !== n.spaces) mismatch.push(`bypassSpaces ${bypassSpaces} != spaces ${n.spaces}`);
      if (Number(bypassBlocks) !== n.braceBlocks) mismatch.push(`bypassBlocks ${bypassBlocks} != braceBlocks ${n.braceBlocks}`);
    }

    emitLog(module, mismatch.length || bad.total ? 'warn' : 'success', 'segment finished', {
      received,
      characters,
      bypass: `${bypassBlocks} blocks / ${bypassSpaces} spaces`,
      syllables,
      avgCharsPerSyllable: syllables > 0 ? avg.toFixed(2) : '-',
      quit: quits,
      failed: bad.total,
    });

    /* failed is per path: the same dead end hit twice is one line with a
       count, not two lines. */
    if (bad.items.length) {
      appendFile(`  failed ${showCounts(bad.items, Infinity)}`);
      for (const i of bad.items) {
        console.log(`  ${paint(C.comment, 'failed path')} ${i.key} = ${i.count}`);
      }
    }
    for (const line of mismatch) {
      console.log(`  ${paint(C.err, 'cross-module')} ${line}`);
      appendFile(`  cross-module ${line}`);
    }

    record('segment', ev);
    runChecks('segment', ev);
    reportInc(module, 'characters', Number(characters) || 0);
    reportInc(module, 'syllables', syllables);
    reportInc(module, 'quit', quits);
    reportInc(module, 'failed', bad.total);
    if (mismatch.length) reportInc(module, 'crossModuleMismatch', mismatch.length);
    for (const i of bad.items) reportSample(module, 'failedPaths', i.key, 40);
  });

  return true;
}

/** Reset the reconciliation state (tests, or between runs). */
export const resetEngineChain = () => { _lastNormalize = null; };

/* ── the engine's invariants ─────────────────────────────────────────
   The same statements the ledgers compute, named so a failure says which
   contract broke instead of only that a number looked wrong. */
function registerEngineChecks() {
  defineCheck('normalize.ledger', {
    after: 'normalize',
    run: ({ total, final, collapsed = 0, braceChars = 0 }) => {
      const sum = Number(final) + Number(collapsed) + Number(braceChars);
      return sum === Number(total)
        || `total ${total} != final ${final} + collapsed ${collapsed} + brace ${braceChars} (${sum})`;
    },
  });
  defineCheck('normalize.split', {
    after: 'normalize',
    run: ({ final, finalNoSpace, spaces = 0 }) => {
      const sum = Number(finalNoSpace) + Number(spaces);
      return sum === Number(final) || `final ${final} != noSpace ${finalNoSpace} + spaces ${spaces}`;
    },
  });
  defineCheck('segment.received', {
    after: 'segment',
    run: ({ characters = 0, bypassSpaces = 0 }, chain) => {
      const norm = [...chain].reverse().find((e) => e.event === 'normalize');
      if (!norm) return { ok: true, detail: 'no normalize in this chain' };
      const received = Number(characters) + Number(bypassSpaces);
      return received === Number(norm.payload.final)
        || `segmentor received ${received}, normalize produced ${norm.payload.final}`;
    },
  });
  defineCheck('segment.bypassMatchesBrace', {
    after: 'segment',
    run: ({ bypassBlocks = 0 }, chain) => {
      const norm = [...chain].reverse().find((e) => e.event === 'normalize');
      if (!norm) return { ok: true, detail: 'no normalize in this chain' };
      return Number(bypassBlocks) === Number(norm.payload.braceBlocks ?? 0)
        || `bypass ${bypassBlocks} blocks != ${norm.payload.braceBlocks} braces`;
    },
  });
  defineCheck('segment.syllableSum', {
    after: 'segment',
    run: ({ quit = 0, failed }) => {
      const bad = readCounts(failed);
      return readCounts(quit).total + bad.total > 0 || 'no syllables produced';
    },
  });
}

export default {
  ...core,
  installEngineLog, resetEngineChain,
  normalize, segment, walker, tagger, bridge, build, reader, writer,
};
