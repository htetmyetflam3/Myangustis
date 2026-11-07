










import { config, sha256Hex } from './config.js';

export class SiteClientError extends Error {
  constructor(message, { status = 0, terminal = false } = {}) {
    super(message);
    this.status = status;
    this.terminal = terminal;
  }
}


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
