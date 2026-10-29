
export type JobState =
  | "RECEIVED"
  | "SITE_PROCESSING"
  | "SOURCE_READY"
  | "ENGINE_ACCEPTED"
  | "ANALYSING"
  | "FINISHED"
  | "FAILED"
  | "EXPIRED";

export type Delivery = {
  submitId: string;
  state: JobState | "UNKNOWN";
  finalFilename: string | null;
  finalBytes: number | null;
  downloadUrl: string | null;
  error: string | null;
};


export const TERMINAL_STATES: JobState[] = ["FINISHED", "FAILED", "EXPIRED"];

export const isTerminal = (state: string): boolean =>
  TERMINAL_STATES.includes(state as JobState);

export const statusUrlFor = (submitId: string) =>
  `/api/submit/status/${encodeURIComponent(submitId)}`;

export const downloadUrlFor = (submitId: string) =>
  `/api/submit/file/${encodeURIComponent(submitId)}`;

const str = (value: unknown): string | null =>
  typeof value === "string" && value ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;


export function readDelivery(body: unknown, fallbackSubmitId = ""): Delivery {
  const b = (body ?? {}) as Record<string, any>;
  const p = (b.processing && typeof b.processing === "object" ? b.processing : b) as Record<
    string,
    any
  >;

  const submitId = str(p.submitId) ?? str(b.submitId) ?? fallbackSubmitId;
  
  
  const raw = str(p.state) ?? str(b.status);
  const state = (raw && raw !== "pending" ? raw : "UNKNOWN") as Delivery["state"];

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


export const ANALYSIS_HIDDEN_ENDPOINT: string | null = null;

export type PollOptions = {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onUpdate?: (delivery: Delivery) => void;
  attempts?: number;
  intervalMs?: number;
  signal?: { aborted: boolean };
};

export const POLL_ATTEMPTS = 40;
export const POLL_INTERVAL_MS = 1500;
// OCR over a large scan runs for minutes -- far past the first minute of
// fast polling. After POLL_ATTEMPTS quick checks the poller slows down
// instead of giving up, staying within a ~20 minute window.
export const POLL_SLOW_INTERVAL_MS = 5000;
export const POLL_SLOW_ATTEMPTS = 240;


export async function pollDelivery(
  submitId: string,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onUpdate,
    attempts = POLL_ATTEMPTS + POLL_SLOW_ATTEMPTS,
    intervalMs = POLL_INTERVAL_MS,
    signal,
  }: PollOptions = {}
): Promise<Delivery> {
  let last: Delivery = {
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


export function stateLabel(state: string): string {
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
