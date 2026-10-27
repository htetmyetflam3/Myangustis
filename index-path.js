import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspace = './Junk';

export const JUNK_DIR = path.resolve(__dirname, workspace);
fs.mkdirSync(JUNK_DIR, { recursive: true });

export default { JUNK_DIR };
