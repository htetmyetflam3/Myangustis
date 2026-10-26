import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { createPdfParser, createDocxParser } from '../../file/praser.js';
import { INPUT_PDF, INPUT_DOCX, abs } from '../../file/paths.js';
import logger from '../../../../Bridge/logen/site.js';
import {
  curlEndpointPath, curlEndpointEnabled, keyMatches, presentedKey, endpointUrl,
} from './curlGate.js';

export { curlEndpointPath, curlEndpointBanner } from './curlGate.js';
export { curlEndpointEnabled };

/*
  THE OFF-PATH -- plumbing.

  One door, for the owner and the owner's agents, carrying two things: a key
  and a file. Nothing else. No cookie, no CSRF token, no User-Agent theatre,
  no quota, no rate limit, no country. The rules it enforces live in
  curlGate.js; this file is the express/multer half.

  It replaces the whole DEV_BYPASS_* / ALLOW_AGENT_UPLOAD / MODE apparatus --
  five flags consulted in six files, which could only ever be switched on
  globally, for every caller at once. A key on one route is the same
  capability with a blast radius of one route.

  Two deliberate limits on what it IS:

    * CONVERSION ONLY. It calls the praser and returns text. It never touches
      the engine, the queue, the database or a session. The site path still
      owns all of that, automatically.
    * OFF THE NORMAL GATE. It is mounted before the gate, not inside it with
      an exemption, so no normal-path middleware has to learn that a bypass
      exists. Deleting these two files and two lines in index.js removes the
      feature completely.

      curl -H "x-curl-key: $CURL_KEY" -F file=@doc.pdf https://<host>$CURL_ENDPOINT

  A wrong or missing key gets 404, not 403. A 403 confirms the path exists and
  turns a secret URL into a guessing game with feedback; 404 is what every
  other unmapped path returns.
*/

const MAX_NAME = 255;
const KINDS = new Map([
  ['.pdf', { kind: 'pdf', dir: INPUT_PDF, parser: createPdfParser }],
  ['.docx', { kind: 'docx', dir: INPUT_DOCX, parser: createDocxParser }],
]);

export function createCurlRouter() {
  const suffix = curlEndpointPath();
  if (!suffix || !curlEndpointEnabled()) return null;

  const maxMb = Number.parseInt(process.env.CURL_MAX_MB ?? '0', 10);
  const limits = { files: 1, fields: 2, parts: 3, fieldSize: 64 * 1024 };
  if (Number.isSafeInteger(maxMb) && maxMb > 0) limits.fileSize = maxMb * 1024 * 1024;

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, file, cb) => {
        const entry = KINDS.get(path.extname(file.originalname).toLowerCase());
        if (!entry) return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'));
        return cb(null, abs(entry.dir));
      },
      filename: (_req, file, cb) =>
        cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    // The site path demands a timestamped name because the browser builds it.
    // curl should not have to: any name, as long as the extension is one we
    // can actually convert.
    fileFilter: (_req, file, cb) => {
      const ok = file.originalname.length <= MAX_NAME
        && KINDS.has(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'file'), ok);
    },
    limits,
  });

  const router = express.Router();

  // Gate first: an unauthenticated caller must not be able to make the server
  // read a file, or tell the two failure modes apart.
  router.use((req, res, next) => {
    if (keyMatches(presentedKey(req))) return next();
    logger.warn?.('[curl] rejected: bad or missing key');
    return res.status(404).json({ error: 'Not found' });
  });

  router.post('/', upload.single('file'), async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Attach one .pdf or .docx as "file"' });
    }
    const uploaded = req.file.path;
    const entry = KINDS.get(path.extname(uploaded).toLowerCase());
    const name = req.file.originalname;

    try {
      const text = await entry.parser().parse(uploaded, null, {
        // The smallest intent the praser accepts. Plain conversion to text:
        // no analysis, no engine, no queue.
        intent: {
          source: 'converter',
          job: 'extracting',
          method: 'default',
          outputFormat: 'txt',
          inputFormat: entry.kind,
          uploadName: name,
        },
      });
      res.set('Cache-Control', 'no-store');
      res.set('X-Curl-Endpoint', endpointUrl(req, suffix));
      res.type('text/plain; charset=utf-8').send(text);
      logger.info?.(`[curl] converted ${name} (${text.length} chars)`);
    } catch (error) {
      logger.error?.(`[curl] ${name}: ${error.message}`);
      res.status(422).json({ error: error.message });
    } finally {
      await fs.unlink(uploaded).catch(() => {});
    }
  });

  // Anything else under the suffix looks like nothing at all.
  router.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  return { path: suffix, router };
}

