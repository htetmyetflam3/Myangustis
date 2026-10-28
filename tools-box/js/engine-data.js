#!/usr/bin/env node

import { getEngineData } from '../../index-path.js';

const [operation, file] = process.argv.slice(2);
if (!['master', 'file', 'paths'].includes(operation) || (operation === 'file' && !file)) {
  throw new Error('usage: node engine-data.js master | file PATH | paths');
}
const data = await getEngineData();
const result = operation === 'master' ? data.readMasterJson()
  : operation === 'file' ? data.readSecureJson(file)
  : { master: data.MASTER_ENC };
process.stdout.write(JSON.stringify(result));
