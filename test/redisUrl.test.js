const test = require("node:test");
const assert = require("node:assert");

const { normalizeRedisUrl } = require("../src/utils/redisUrl");

test("normalizeRedisUrl: returns null for empty/undefined", () => {
  assert.strictEqual(normalizeRedisUrl(""), null);
  assert.strictEqual(normalizeRedisUrl(undefined), null);
  assert.strictEqual(normalizeRedisUrl(null), null);
});

test("normalizeRedisUrl: passes through a clean rediss:// url", () => {
  const u = "rediss://default:secret@host.upstash.io:6379";
  assert.strictEqual(normalizeRedisUrl(u), u);
});

test("normalizeRedisUrl: strips a pasted `redis-cli --tls -u` wrapper", () => {
  const raw = "redis-cli --tls -u redis://default:secret@my-host.upstash.io:6379";
  assert.strictEqual(
    normalizeRedisUrl(raw),
    "rediss://default:secret@my-host.upstash.io:6379",
  );
});

test("normalizeRedisUrl: upgrades upstash redis:// to rediss:// (TLS)", () => {
  assert.strictEqual(
    normalizeRedisUrl("redis://default:x@abc.upstash.io:6379"),
    "rediss://default:x@abc.upstash.io:6379",
  );
});

test("normalizeRedisUrl: leaves non-upstash redis:// as-is", () => {
  assert.strictEqual(
    normalizeRedisUrl("redis://localhost:6379"),
    "redis://localhost:6379",
  );
});

test("normalizeRedisUrl: strips surrounding quotes", () => {
  assert.strictEqual(
    normalizeRedisUrl("'redis://localhost:6379'"),
    "redis://localhost:6379",
  );
});

test("normalizeRedisUrl: returns null when no scheme present", () => {
  assert.strictEqual(normalizeRedisUrl("just some text"), null);
});
