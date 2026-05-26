// Simple in-memory rate limiter. Resets state per process - if you scale
// horizontally you'll want a shared store instead.
export function createRateLimiter({ windowMs, maxRequests, keyFn, logger }) {
  const hits = new Map();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const entry = hits.get(key);

    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(key, { windowStart: now, count: 1 });
      return next();
    }

    entry.count += 1;

    if (entry.count > maxRequests) {
      logger?.warn({ key, count: entry.count }, 'Rate limit exceeded');
      res.set('Retry-After', String(Math.ceil((entry.windowStart + windowMs - now) / 1000)));
      return res.status(429).json({
        error: 'Too many requests',
        retryAfterMs: entry.windowStart + windowMs - now,
      });
    }

    return next();
  };
}
