const TERMINAL_STATES = ["FINISHED", "FAILED", "EXPIRED"];
export const isTerminal = (state) => TERMINAL_STATES.includes(state);
const statusUrlFor = (submitId) =>
  `/api/submit/status/${encodeURIComponent(submitId)}`;
const downloadUrlFor = (submitId) =>
  `/api/submit/file/${encodeURIComponent(submitId)}`;
const str = (value) =>
  typeof value === "string" && value ? value : null;
const num = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function readDelivery(body, fallbackSubmitId = "") {
  const b = body ?? {};
  const p = b.processing && typeof b.processing === "object" ? b.processing : b;
  const submitId = str(p.submitId) ?? str(b.submitId) ?? fallbackSubmitId;
  const raw = str(p.state) ?? str(b.status);
  const state = raw && raw !== "pending" ? raw : "UNKNOWN";
  return {
    submitId,
    state,
    finalFilename: str(p.finalFilename),
    finalBytes: num(p.finalBytes),
    downloadUrl:
      str(p.downloadUrl) ?? (state === "FINISHED" && submitId ? downloadUrlFor(submitId) : null),
    error: str(p.error),
  };
}

const POLL_ATTEMPTS = 40;
const POLL_INTERVAL_MS = 1500;



const POLL_SLOW_INTERVAL_MS = 5000;
const POLL_SLOW_ATTEMPTS = 240;

export async function pollDelivery(
  submitId,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onUpdate,
    attempts = POLL_ATTEMPTS + POLL_SLOW_ATTEMPTS,
    intervalMs = POLL_INTERVAL_MS,
    signal,
  } = {}
) {
  let last = {
    submitId,
    state: "UNKNOWN",
    finalFilename: null,
    finalBytes: null,
    downloadUrl: null,
    error: null,
  };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (signal?.aborted) return last;
    try {
      const response = await fetchImpl(statusUrlFor(submitId));
      if (response.ok) {
        last = readDelivery(await response.json(), submitId);
      } else {
        last = { ...last, error: `The status endpoint answered ${response.status}.` };
      }
    } catch (error) {
      last = {
        ...last,
        error: error instanceof Error ? error.message : "The status check failed.",
      };
    }
    onUpdate?.(last);
    if (isTerminal(last.state)) return last;
    if (attempt < attempts - 1) {
      const wait = attempt < POLL_ATTEMPTS ? intervalMs : POLL_SLOW_INTERVAL_MS;
      await sleep(wait);
    }
  }
  return {
    ...last,
    error: last.error ?? "The job is still running. Check back in a moment.",
  };
}
export function stateLabel(state) {
  switch (state) {
    case "RECEIVED":
      return "Queued";
    case "SITE_PROCESSING":
      return "Converting…";
    case "SOURCE_READY":
      return "Converted — preparing…";
    case "ENGINE_ACCEPTED":
    case "ANALYSING":
      return "Analysing…";
    case "FINISHED":
      return "Ready";
    case "FAILED":
      return "Failed";
    case "EXPIRED":
      return "Expired";
    default:
      return "Working…";
  }
}