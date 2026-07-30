/**
 * Normalize a (possibly malformed) REDIS_URL into a clean rediss?:// URL.
 * Returns null when no usable URL is present.
 *
 * - Strips a pasted `redis-cli ... -u <url>` wrapper (keeps from the scheme on)
 * - Strips surrounding quotes/whitespace
 * - Forces TLS (rediss://) for Upstash hosts
 */
const normalizeRedisUrl = (raw) => {
  if (!raw) return null;
  let url = String(raw).trim().replace(/^['"]|['"]$/g, "");

  const schemeIdx = url.search(/rediss?:\/\//);
  if (schemeIdx > 0) url = url.slice(schemeIdx);
  url = url.trim().replace(/^['"]|['"]$/g, "");

  if (!/^rediss?:\/\//.test(url)) return null;

  if (url.startsWith("redis://") && /upstash\.io/.test(url)) {
    url = "rediss://" + url.slice("redis://".length);
  }
  return url;
};

module.exports = { normalizeRedisUrl };
