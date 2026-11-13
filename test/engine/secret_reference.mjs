// Run the supplied kit's own source modules in a temporary materialization.
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import readline from 'node:readline';
const root = process.argv[2];
const load = path => import(pathToFileURL(join(root, path)).href);
const norm = await load('base/normalize.js');
const mapper = await load('base/sourceMapper.js');
const graph = await load('graph/disassembler.js');
const { getStep } = await load('graph/shape.js');
const operations = {
  ...norm, ...mapper, ...graph,
  Bb: data => graph.Bb(data, { getStep }),
  buildPosTreeFromObject: (mapping, pos) => graph.buildPosTree(new Map(Object.entries(mapping)), pos),
};
// Graph helpers log diagnostics; stdout is reserved for JSON responses.
console.log = () => {};
for await (const line of readline.createInterface({ input: process.stdin })) {
  try {
    const { method, args } = JSON.parse(line);
    process.stdout.write(JSON.stringify({ result: operations[method](...args) }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ error: String(error) }) + '\n');
  }
}
