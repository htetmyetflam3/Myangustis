export const ENGINE_KEY_RE = /^[0-9a-f]{32}$/i;
export function checkEngineKey(key) {
  if (!key) return "missing";
  return ENGINE_KEY_RE.test(key) ? "ok" : "shape";
}
const DISPATCH_FIELDS = [
  "jobToken",
  "formId",
  "submitId",
  "userId",
  "sessionId",
  "filename",
  "extension",
  /* Both work fields, under the labels the analysis column uses: `method`
     is the handling (extracting | ocr | null), `task` is the mode. The
     fused "extracting-analysis" job carried the handling before. */
  "method",
  "task",
  "job",
];
const DEFAULT_ACCEPT_TIMEOUT_MS = 3000;
const DEFAULT_JOB_TIMEOUT_MS = 120_000;
function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isSafeInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}
export function engineConfig(env = process.env) {
  const jobUrl = String(env.ENGINE_JOB_URL || "").trim();
  return {
    jobUrl,
    siteToEngineKey: String(env.SITE_TO_ENGINE_KEY || "").trim(),
    engineToSiteKey: String(env.ENGINE_TO_SITE_KEY || "").trim(),
    acceptTimeoutMs: boundedInteger(
      env.ENGINE_ACCEPT_TIMEOUT_MS,
      DEFAULT_ACCEPT_TIMEOUT_MS,
      100,
      30_000,
    ),
    jobTimeoutMs: boundedInteger(
      env.ENGINE_JOB_TIMEOUT_MS,
      DEFAULT_JOB_TIMEOUT_MS,
      1_000,
      600_000,
    ),
  };
}

export function createEngineDispatcher({
  jobUrl = "",
  key = "",
  acceptTimeoutMs = DEFAULT_ACCEPT_TIMEOUT_MS,
  fetchImpl = fetch,
  log = console.warn,
} = {}) {
  const url = String(jobUrl || "").trim();
  const callerKey = String(key || "").trim();
  const configured = Boolean(url);
  const keyShape = checkEngineKey(callerKey);
  if (!configured) {
    log(
      "[engine] ENGINE_JOB_URL is not set — hidden analysis dispatch is dormant; " +
        "the Site runs normally.",
    );
  } else if (keyShape !== "ok") {
    log(
      `[engine] SITE_TO_ENGINE_KEY ${keyShape === "missing" ? "is not set" : "is not 32 hex characters"} — ` +
        "dispatch will be refused until a correctly shaped key is configured.",
    );
  }
  function dispatchBody(metadata) {
    const body = {};
    for (const field of DISPATCH_FIELDS) {
      body[field] = metadata[field] ?? null;
    }
    return body;
  }
  
  async function dispatch(metadata) {
    if (!configured) {
      return { accepted: false, reason: "engine-not-configured" };
    }
    if (keyShape !== "ok") {
      return { accepted: false, reason: "engine-key-not-configured" };
    }
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": callerKey,
        },
        body: JSON.stringify(dispatchBody(metadata)),
        signal: AbortSignal.timeout(acceptTimeoutMs),
      });
    } catch (error) {
      const cause = error?.cause?.code || error?.cause?.name || error?.name;
      return {
        accepted: false,
        reason: cause ? `engine-unreachable:${cause}` : "engine-unreachable",
      };
    }
    await response.text().catch(() => "");
    if (!response.ok) {
      return { accepted: false, status: response.status };
    }
    return { accepted: true, status: response.status };
  }
  return {
    configured,
    endpoint: url,
    dispatch,
    dispatchBody,
  };
}
export async function generateEngineKey(randomBytes) {
  const rng = randomBytes || (await import("node:crypto")).randomBytes;
  return rng(16).toString("hex");
}
export default { ENGINE_KEY_RE, checkEngineKey, engineConfig, createEngineDispatcher };