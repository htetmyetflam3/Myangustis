// Outbound half of the Gen2 contract: the ENGINE initiates both calls.
//
//   pullSource()  POST {SITE_QUEUE_URL}        -> text/plain stream + X-* headers
//   pushResult()  POST {SITE_QUEUE_URL}/result -> raw body + X-* headers
//
// Site status semantics (engineCollect.js):
//   200  source streamed (404 while the bound job is still being prepared)
//   403  key refused / binding burned        — terminal, do not retry
//   410  jobToken expired                     — terminal
//   409  illegal job state for this call      — terminal
//   200 + { ok:true, state:'FINISHED' }       — result accepted
import { config, sha256Hex } from './config.mjs';

export class SiteClientError extends Error {
  constructor(message, { status = 0, terminal = false } = {}) {
    super(message);
    this.status = status;
    this.terminal = terminal;
  }
}

// The 7 JOB_META_FIELDS the Site queue validates as non-empty strings <=512 chars.
export function metaHeaders(record) {
  return {
    'X-Job-Token': record.jobToken,
    'X-Form-Id': record.formId,
    'X-Submit-Id': record.submitId,
    'X-User-Id': record.userId,
    'X-Session-Id': record.sessionId,
    'X-Filename': encodeURIComponent(record.filename),
    'X-Extension': record.extension,
  };
}

function metaBody(record) {
  return {
    jobToken: record.jobToken,
    formId: record.formId,
    submitId: record.submitId,
    userId: record.userId,
    sessionId: record.sessionId,
    filename: record.filename,
    extension: record.extension,
  };
}

/**
 * Pull the raw source text. Retries only on 404 (not ready yet) until the
 * jobToken TTL deadline. Verifies the bytes against the Site's X-Content-*
 * expectations when they were supplied.
 */
export async function pullSource(record, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (!config.siteQueueUrl) throw new SiteClientError('SITE_QUEUE_URL is not configured', { terminal: true });
  const deadline = Date.now() + config.jobTimeoutMs;

  for (;;) {
    const res = await fetchImpl(config.sourceUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.engineToSiteKey },
      body: JSON.stringify(metaBody(record)),
      signal: AbortSignal.timeout(config.transferTimeoutMs),
    });

    if (res.status === 404) {
      if (Date.now() >= deadline) throw new SiteClientError('source not ready before jobToken TTL', { status: 404, terminal: true });
      await sleep(config.pullRetryMs);
      continue;
    }
    if (res.status === 403) throw new SiteClientError('Site refused the engine key (403, binding burned)', { status: 403, terminal: true });
    if (res.status === 410) throw new SiteClientError('jobToken expired (410)', { status: 410, terminal: true });
    if (res.status === 409) throw new SiteClientError('illegal job state for source pull (409)', { status: 409, terminal: true });
    if (!res.ok) throw new SiteClientError(`source pull failed: ${res.status}`, { status: res.status });

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > config.maxSourceBytes) {
      throw new SiteClientError('source exceeds the 64 MB transfer limit', { terminal: true });
    }

    const declaredBytes = Number.parseInt(String(res.headers.get('x-content-bytes') ?? ''), 10);
    if (Number.isSafeInteger(declaredBytes) && declaredBytes !== buffer.length) {
      throw new SiteClientError(`source byte mismatch: declared ${declaredBytes}, got ${buffer.length}`, { terminal: true });
    }
    const declaredSha = String(res.headers.get('x-content-sha256') ?? '').trim().toLowerCase();
    if (declaredSha && declaredSha !== sha256Hex(buffer)) {
      throw new SiteClientError('source sha256 mismatch', { terminal: true });
    }

    return {
      text: buffer.toString('utf8'),
      bytes: buffer,
      site: {
        requestedExtension: String(res.headers.get('x-requested-extension') ?? record.extension ?? '').toLowerCase(),
        contentBytes: buffer.length,
        contentSha256: sha256Hex(buffer),
      },
    };
  }
}

/**
 * Push the finished artifact as a raw body with the X-* metadata headers.
 * The engine's natural artifact is checked text: extension txt / text/plain,
 * which the Site accepts directly (and renders to docx/pdf itself when it
 * staged a docx source — acceptsAnalysisResultExtension).
 */
export async function pushResult(record, artifact, { fetchImpl = fetch } = {}) {
  if (!config.resultUrl) throw new SiteClientError('SITE_QUEUE_URL is not configured', { terminal: true });
  const res = await fetchImpl(config.resultUrl, {
    method: 'POST',
    headers: {
      'x-api-key': config.engineToSiteKey,
      'content-type': artifact.mime,
      'x-mime-type': artifact.mime,
      'x-bytes': String(artifact.bytes.length),
      'x-sha256': sha256Hex(artifact.bytes),
      ...metaHeaders({ ...record, filename: artifact.filename, extension: artifact.extension }),
    },
    body: artifact.bytes,
    signal: AbortSignal.timeout(config.transferTimeoutMs),
  });

  if (res.status === 403) throw new SiteClientError('Site refused the result key (403)', { status: 403, terminal: true });
  if (res.status === 410) throw new SiteClientError('jobToken expired before result push (410)', { status: 410, terminal: true });
  if (res.status === 409) throw new SiteClientError('illegal job state for result push (409)', { status: 409, terminal: true });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new SiteClientError(`result push rejected: ${res.status} ${detail}`, { status: res.status });
  }
  return res.json().catch(() => ({}));
}
