// In-memory fixed-window rate limiter — no external dependency.
//
// One bucket per key per fixed window. Keys default to the client IP
// (Express req.ip, which honors the app-level 'trust proxy' setting).
// Expired buckets are swept lazily on each hit; no background timer, so the
// limiter adds nothing to keep alive or shut down and is trivial to test.
//
// On reject: 429 with Retry-After (seconds) and a JSON body. On accept the
// standard X-RateLimit-* headers are set so callers can self-throttle.
export function createRateLimiter({ windowMs = 60_000, max = 60, name = 'rate-limit' } = {}) {
  const buckets = new Map(); // key -> { count, resetAt }
  let lastSweep = 0;

  return function rateLimit(req, res, next) {
    const now = Date.now();
    if (now - lastSweep > windowMs) {
      for (const [key, bucket] of buckets) {
        if (bucket.resetAt <= now) buckets.delete(key);
      }
      lastSweep = now;
    }

    const key = `${name}:${req.ip}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'rate limit exceeded', retryAfter });
    }
    return next();
  };
}
