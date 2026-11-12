













import { getBox } from './host.js';

const box = getBox();
const call = (method, ...args) => box.call(method, ...args);
const tables = box.call('tables');







const asSet = value => new Set(Array.isArray(value) ? value : []);


export const normalize = (...a) => call('normalize', ...a);
export const mapperNormalize = (...a) => call('mapperNormalize', ...a);
export const myNormalize = (...a) => call('myNormalize', ...a);
export const MyNormalize = myNormalize;
export const mapperStr = (...a) => call('mapperStr', ...a);
export const toBurmeseStr = (...a) => call('toBurmeseStr', ...a);
export const isTail = (...a) => call('isTail', ...a);
export const isBase = (...a) => call('isBase', ...a);
export const isNum = (...a) => call('isNum', ...a);
export const isStick = (...a) => call('isStick', ...a);
export const isStandalone = (...a) => call('isStandalone', ...a);
export const isLowerOrUpperAZ = (...a) => call('isLowerOrUpperAZ', ...a);
export const isLowercaseAZ = (...a) => call('isLowercaseAZ', ...a);
export const isUppercaseAZ = (...a) => call('isUppercaseAZ', ...a);


export const MMap = tables.MMap;
export const NewMap = tables.NewMap;
export const newClause = tables.newClause;
export const IMPOSTER = tables.IMPOSTER;
export const Priority = tables.Priority;
export const BLOCK_PUNCT = asSet(tables.BLOCK_PUNCT);
export const ALL_DIGITS = asSet(tables.ALL_DIGITS);
export const PUNCTUATION = asSet(tables.PUNCTUATION);
export const Glue = asSet(tables.Glue);
export const BURMESE_DIGITS = asSet(tables.BURMESE_DIGITS);
export const ENGLISH_DIGITS = asSet(tables.ENGLISH_DIGITS);


export default mapperNormalize;
