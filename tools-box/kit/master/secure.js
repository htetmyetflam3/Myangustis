// Build tools and runtime share one encrypted-master loader and tracked key.
export {
  MASTER_ENC,
  MASTER_KEY_FILE,
  masterFingerprint,
  readMasterText,
  readMasterJson,
  readSecureText,
  readSecureJson,
} from '../../../Architecture/Engine/.data/secure.js';
