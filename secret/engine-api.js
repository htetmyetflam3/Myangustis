// BUILD INPUT: evaluated only inside QuickJS/WASM, never imported by the host.
import { normalize, mapperNormalize, myNormalize } from './base/normalize.js';
import { mapperStr, toBurmeseStr, isTail, isBase, isNum, isStick, isStandalone } from './base/sourceMapper.js';
import { isLowerOrUpperAZ, isLowercaseAZ, isUppercaseAZ } from './base/function.js';
import * as tables from './base/sourceMap.js';

const functions = { normalize, mapperNormalize, myNormalize, mapperStr, toBurmeseStr,
  isTail, isBase, isNum, isStick, isStandalone, isLowerOrUpperAZ, isLowercaseAZ, isUppercaseAZ };

export function call(request) {
  const parsed = JSON.parse(request);
  if (!parsed || typeof parsed.method !== 'string' || !Array.isArray(parsed.args)) {
    throw new TypeError('WASM API requires {method, args}');
  }
  if (parsed.method === 'tables') {
    return JSON.stringify(tables, (_, value) => value instanceof Set ? Array.from(value) : value);
  }
  if (!Object.prototype.hasOwnProperty.call(functions, parsed.method)) {
    throw new Error('Unknown WASM API method: ' + parsed.method);
  }
  return JSON.stringify(functions[parsed.method](...parsed.args));
}
