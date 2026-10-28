// INPUT FLAG: callers pass text, not file paths. File callers should prefer a
// read stream on their side. The engine preserves its internal streaming
// pipeline when processing the received string; normal output is not written.
import { randomUUID } from 'node:crypto';
import { SlotLimiter } from '../../host/job-store.js';

const webSlots = new SlotLimiter(2);

// Input is normalized and mapped by readFromApi, segmented into Burmese
// syllables, and grouped by fullstopHolder before the requested formatter.
async function* Engine({ sourceText, flag }, hash, positional) {
  const [{ readFromApi }, { runSegmentor }, { fullstopHolder }, formatter] = await Promise.all([
    import('../MonoSyllabism/generators/input.js'),
    import('../MonoSyllabism/main/phoneme/lexer.js'),
    import('../MonoSyllabism/generators/pos-input.js'),
    import('../MonoSyllabism/utilities/formatter.js'),
  ]);
  const seg = runSegmentor(readFromApi(sourceText));
  if (flag === 'syllable') {
    const tokenizer = positional ? await import('./tokenizer.js') : null;
    for await (const line of fullstopHolder(seg, { perLine: true })) {
      const formatted = formatter.toSyllableLine(line);
      if (!positional) yield formatted;
      else {
        const positions = tokenizer.syllablePosition(formatted);
        if (positions !== null) yield positions;
      }
    }
    return;
  }

  const [{ runTagger }, { runRuleEngine }] = await Promise.all([
    import('../MonoSyllabism/main/phoneme/phonology.js'),
    import('../bridge/Ginit.js'),
  ]);
  const tagged = runTagger(fullstopHolder(seg), hash);
  for await (const line of runRuleEngine(tagged, hash)) {
    yield {
      syllable: formatter.toBurmeseLine(line),
      rawPos: formatter.toBurmeseLineWithPos(line, 'rawPos'),
    };
  }
}

// Hold a web slot for the actual lifetime of a consumed stream, including
// early cancellation or failure; an unconsumed generator holds no slot.
async function* stream(request, hash, callerHasHash) {
  if (callerHasHash) await webSlots.acquire();
  try {
    yield* Engine(request, hash, callerHasHash && request.flag === 'syllable');
  } finally {
    if (callerHasHash) webSlots.release();
  }
}

async function debug(request, hash, callerHasHash) {
  if (callerHasHash) await webSlots.acquire();
  try {
    const { runDebug } = await import('./debug-bridge.js');
    return await runDebug(request.sourceText, hash);
  } finally {
    if (callerHasHash) webSlots.release();
  }
}

/**
 * One entry for text input. Non-debug syllable and hash-free POS calls return
 * async generators. Hashed POS calls return a promise for the guard message;
 * debug calls return a promise for the five retained debug output paths.
 */
export function BindEngine(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('BindEngine: a request object is required');
  }
  if (typeof request.sourceText !== 'string') {
    throw new TypeError('BindEngine: sourceText must be a string');
  }
  if ('inputPath' in request || 'outputPath' in request || 'work' in request || 'seg' in request) {
    throw new TypeError('BindEngine: supply text, not paths or a segment stream');
  }
  if (request.flag !== 'syllable' && request.flag !== 'pos') {
    throw new TypeError('BindEngine: flag must be syllable or pos');
  }
  const isDebug = request.debug === undefined ? false : request.debug;
  if (typeof isDebug !== 'boolean') {
    throw new TypeError('BindEngine: debug must be a boolean');
  }
  const callerHasHash = request.hash !== undefined && request.hash !== null;
  if (callerHasHash && (typeof request.hash !== 'string' ||
      !/^[A-Za-z0-9._-]{72}$/.test(request.hash) || request.hash.includes('..'))) {
    throw new TypeError('BindEngine: caller hash must be 72 safe characters');
  }
  const hash = callerHasHash ? request.hash : randomUUID();
  const input = { sourceText: request.sourceText, flag: request.flag };
  if (isDebug) return debug(input, hash, callerHasHash);
  const result = stream(input, hash, callerHasHash);
  if (callerHasHash && input.flag === 'pos') {
    return import('./pos-guard.js').then(({ consumePos }) => consumePos(result));
  }
  return result;
}
