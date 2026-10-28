#!/usr/bin/env node

import { getEngineData } from '../../index-path.js';

const [operation, file] = process.argv.slice(2);
if (!['master', 'file', 'paths', 'master-info'].includes(operation) || (operation === 'file' && !file)) {
  throw new Error('usage: node engine-data.js master | file PATH | paths | master-info');
}
const data = await getEngineData();
const result = operation === 'master' ? data.readMasterJson()
  : operation === 'file' ? data.readSecureJson(file)
  : operation === 'master-info' ? { master: data.MASTER_ENC, sha256: data.masterFingerprint() }
  : { master: data.MASTER_ENC };
process.stdout.write(JSON.stringify(result));
