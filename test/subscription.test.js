const test = require("node:test");
const assert = require("node:assert");

const { computeState, isRenewable, isSubscriptionExpired, DAY_MS } = require("../src/modules/organizationSubscription/subscription.logic");

const NOW = 1_800_000_000_000; // fixed "now"
const mk = (over = {}) => ({
  endAt: NOW + 10 * DAY_MS,
  status: "ACTIVE",
  isTrial: false,
  autoRenew: true,
  cancelAtPeriodEnd: false,
  ...over,
});

test("computeState: no subscription → expired, no plan", () => {
  const s = computeState(null, NOW);
  assert.strictEqual(s.hasSubscription, false);
  assert.strictEqual(s.isExpired, true);
  assert.strictEqual(s.current, null);
});

test("computeState: active future → not expired, daysLeft + nextBillingAt", () => {
  const s = computeState(mk(), NOW);
  assert.strictEqual(s.isExpired, false);
  assert.strictEqual(s.daysLeft, 10);
  assert.strictEqual(s.nextBillingAt, NOW + 10 * DAY_MS);
});

test("computeState: EXPIRED status → isExpired true", () => {
  const s = computeState(mk({ status: "EXPIRED", endAt: NOW - DAY_MS }), NOW);
  assert.strictEqual(s.isExpired, true);
  assert.strictEqual(s.daysLeft, 0);
});

test("computeState: ACTIVE but ended (not yet settled) → not flagged expired", () => {
  // status still ACTIVE; lazy settle happens elsewhere
  const s = computeState(mk({ endAt: NOW - DAY_MS }), NOW);
  assert.strictEqual(s.isExpired, false);
});

test("computeState: cancelAtPeriodEnd → nextBillingAt null", () => {
  const s = computeState(mk({ cancelAtPeriodEnd: true, autoRenew: false }), NOW);
  assert.strictEqual(s.nextBillingAt, null);
});

test("computeState: auto-renew off → nextBillingAt null", () => {
  const s = computeState(mk({ autoRenew: false }), NOW);
  assert.strictEqual(s.nextBillingAt, null);
});

test("computeState: trial flagged via isTrial or TRIALING status", () => {
  assert.strictEqual(computeState(mk({ isTrial: true }), NOW).isTrial, true);
  assert.strictEqual(computeState(mk({ status: "TRIALING" }), NOW).isTrial, true);
});

test("isRenewable: true only when autoRenew, not cancelling, not trial", () => {
  assert.strictEqual(isRenewable(mk()), true);
  assert.strictEqual(isRenewable(mk({ autoRenew: false })), false);
  assert.strictEqual(isRenewable(mk({ cancelAtPeriodEnd: true })), false);
  assert.strictEqual(isRenewable(mk({ isTrial: true })), false);
});

test("isSubscriptionExpired: null sub → expired (used by auth guard)", () => {
  assert.strictEqual(isSubscriptionExpired(null, NOW), true);
});

test("isSubscriptionExpired: active future → not expired", () => {
  assert.strictEqual(isSubscriptionExpired(mk(), NOW), false);
});

test("isSubscriptionExpired: EXPIRED / CANCELLED status → expired", () => {
  assert.strictEqual(isSubscriptionExpired(mk({ status: "EXPIRED" }), NOW), true);
  assert.strictEqual(isSubscriptionExpired(mk({ status: "CANCELLED" }), NOW), true);
});

test("isSubscriptionExpired: ACTIVE but past endAt → not expired (lazy settle elsewhere)", () => {
  assert.strictEqual(isSubscriptionExpired(mk({ endAt: NOW - DAY_MS }), NOW), false);
});

test("isSubscriptionExpired: non-active status past endAt → expired", () => {
  assert.strictEqual(isSubscriptionExpired(mk({ status: "PAST_DUE", endAt: NOW - DAY_MS }), NOW), true);
});
