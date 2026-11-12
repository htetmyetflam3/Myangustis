// Differential-test oracle only. Production Python never starts Node or WASM.
import * as map from '../../Engine/MonoSyllabism/map/loader.js';
import { walk, walkPos } from '../../Engine/MonoSyllabism/main/grapheme/traverser.js';
import { walkReverse } from '../../Engine/MonoSyllabism/main/grapheme/reverse.js';
import { getRtlTree, getPosTree, getTree } from '../../Engine/MonoSyllabism/main/grapheme/Tree.loaded.js';
import { runSegmentor } from '../../Engine/MonoSyllabism/main/phoneme/lexer.js';
import { runTagger } from '../../Engine/MonoSyllabism/main/phoneme/phonology.js';
import { classifyNumber } from '../../Engine/MonoSyllabism/main/phoneme/classify-number.js';
import readline from 'node:readline';
import fs from 'node:fs';

// The kit's sourceMap.js is build input, not an importable standalone module.
// Inject the real WASM tables to run its unchanged compose/decompose functions.
globalThis.__mapperTables = { MMap: map.MMap, NewMap: map.NewMap };
const source = fs.readFileSync(new URL('../../wasm/wasm-kit/base/function.js', import.meta.url), 'utf8')
  .replace("import { MMap, NewMap } from './sourceMap.js';", 'const {MMap,NewMap}=globalThis.__mapperTables;');
const helpers = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const asciiToMm = new Map();
for (const group of ['Base', 'Tail', 'Asat', 'Num']) {
  map.MMap[group].forEach((ch, index) => asciiToMm.set(map.NewMap[group][index], ch));
}

for await (const line of readline.createInterface({ input: process.stdin })) {
  try {
    const { op, args } = JSON.parse(line);
    let result;
    if (op === 'walk') result = walk(...args);
    else if (op === 'walkPos') result = walkPos(...args);
    else if (op === 'walkReverse') result = walkReverse(getRtlTree(), ...args);
    else if (op === 'classifyNumber') result = classifyNumber(...args);
    else if (op === 'compose') result = helpers.compose(args[0], asciiToMm);
    else if (op === 'decompose') result = helpers.decompose(args[0], null, asciiToMm);
    else if (op === 'segment') {
      result = []; for await (const token of runSegmentor(args[0], { log: false })) result.push(token);
    } else if (op === 'tagger') {
      result = []; for await (const unit of runTagger(args[0], 'test', { log: false })) result.push(unit);
    } else if (op === 'walkPosFixture') {
      const tree = getPosTree(), [fixture, tokens] = args;
      tree.__fixture = fixture;
      try { result = walkPos(['__fixture', ...tokens], 0); }
      finally { delete tree.__fixture; }
    } else if (op === 'walkFixture') {
      const tree = getTree(), [fixture, text] = args;
      tree.Root.__fixture = fixture;
      // A single-character fixture root that is guaranteed absent in shipped trees.
      const key = '\u0001', previous = tree.Root[key];
      tree.Root[key] = fixture;
      try { result = walk(key + text, 0); }
      finally { delete tree.Root.__fixture; if (previous === undefined) delete tree.Root[key]; else tree.Root[key] = previous; }
    } else result = map[op](...args);
    process.stdout.write(JSON.stringify({ result }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: error.stack }) + '\n');
  }
}
