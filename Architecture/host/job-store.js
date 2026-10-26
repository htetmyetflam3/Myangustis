// In-memory job store: the accepted /job records and their lifecycle.
//
// State machine mirrors the Site queue labels the engine participates in:
//   PENDING  — accepted, source pull not started/finished
//   RUNNING  — source pulled, native engine pipeline executing
//   DONE     — result accepted by the Site (FINISHED there)
//   FAILED   — terminal rejection (403/409/410, digest mismatch, pipeline error)
// Records are TTL-pruned on insert and capped by JOB_STORE_MAX.
export const JOB_STATES = Object.freeze({
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
});

export class JobStore {
  constructor({ max = 500, ttlMs = 120000, now = () => Date.now() } = {}) {
    this.max = max;
    this.ttlMs = ttlMs;
    this.now = now;
    this.records = new Map(); // jobToken -> record
  }

  _prune() {
    const now = this.now();
    for (const [token, rec] of this.records) {
      if (now - rec.acceptedAt > this.ttlMs) this.records.delete(token);
    }
    while (this.records.size >= this.max) {
      this.records.delete(this.records.keys().next().value);
    }
  }

  accept(metadata) {
    this._prune();
    const record = {
      ...metadata,
      state: JOB_STATES.PENDING,
      acceptedAt: this.now(),
      attempts: 0,
      error: null,
    };
    this.records.set(metadata.jobToken, record);
    return record;
  }

  get(jobToken) {
    return this.records.get(jobToken) ?? null;
  }

  // Preceding-request guard for POST /job: the Site queue keys one file by
  // formId and mints a fresh jobToken per engine round. A new round is only
  // admissible once the prior round for that formId reached a terminal state
  // (DONE/FAILED) — an active PENDING/RUNNING predecessor means the duplicate
  // call must be refused at the door.
  activeByFormId(formId) {
    for (const rec of this.records.values()) {
      if (
        rec.formId === formId &&
        rec.state !== JOB_STATES.DONE &&
        rec.state !== JOB_STATES.FAILED
      ) {
        return rec;
      }
    }
    return null;
  }

  update(jobToken, patch) {
    const rec = this.records.get(jobToken);
    if (!rec) return null;
    Object.assign(rec, patch);
    return rec;
  }

  pending() {
    return [...this.records.values()].filter((r) => r.state === JOB_STATES.PENDING);
  }

  snapshot() {
    return [...this.records.values()].map((r) => ({
      jobToken: r.jobToken,
      formId: r.formId,
      submitId: r.submitId,
      state: r.state,
      error: r.error,
    }));
  }
}

// Bounded pipeline slots — the upload side accepts fast and queues parse work
// behind the same kind of limiter (Site createSlotLimiter, default 2).
export class SlotLimiter {
  constructor(max) {
    this.max = max;
    this.active = 0;
    this.waiting = [];
  }

  acquire() {
    return new Promise((resolve) => {
      if (this.active < this.max) {
        this.active += 1;
        return resolve();
      }
      this.waiting.push(resolve);
    });
  }

  release() {
    const next = this.waiting.shift();
    if (next) return next(); // slot handed over — occupancy unchanged
    this.active = Math.max(0, this.active - 1);
  }
}
