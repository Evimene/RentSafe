const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 30 } = {}) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.method}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    let bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({
        error: 'Too many requests',
        retryAfterMs: Math.max(0, bucket.resetAt - now),
      });
    }

    next();
  };
}
