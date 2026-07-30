/**
 * Dependency-free fixed-window rate limiter (in-memory, per-instance).
 * Suitable for throttling abuse on auth endpoints on a single API instance.
 * For multi-instance deployments, back this with Redis instead.
 * Usage: router.post("/login", rateLimit({ windowMs, max, keyPrefix }), handler)
 */





const buckets = new Map();

// Periodically evict stale buckets so memory doesn't grow unbounded.
// unref() so this timer never keeps the process (or test runner) alive.
const CLEANUP_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now > b.reset) buckets.delete(key);
  }
}, CLEANUP_MS).unref();

const clientIp = (req) =>
  req.ip ||
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
  req.socket?.remoteAddress ||
  "unknown";

const rateLimit = ({ windowMs, max, keyPrefix = "" }) => {
  return (req, res, next) => {
    const key = `${keyPrefix}:${clientIp(req)}`;
    const now = Date.now();

    let b = buckets.get(key);
    if (!b || now > b.reset) {
      b = { count: 0, reset: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    if (b.count > max) {
      const retryAfter = Math.ceil((b.reset - now) / 1000);
      res.set("Retry-After", String(retryAfter));
      return res.status(429).json({
        status: false,
        message: `Too many requests. Please try again in ${retryAfter}s.`,
      });
    }
    return next();
  };
};

module.exports = rateLimit;
