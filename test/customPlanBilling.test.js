const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const { computePlanAmount } = require("../src/modules/organizationSubscription/autoUpgrade.service");
const { withTax, toStripeAmount } = require("../src/config/stripe");

/**
 * Billing arithmetic for the participant-based Custom plan.
 *
 * Every case here is a bug that shipped. They are cheap to re-introduce (one
 * stale field read) and expensive to notice, because nothing errors — the
 * customer is simply charged the wrong amount, or nothing at all.
 */

const custom = (interval) => ({
  isCustom: true,
  interval,
  price: 0, // per-head plans carry no flat price — that is the trap
  pricePerParticipant: 2000,
});

const flat = { isCustom: false, interval: "MONTHLY", price: 99800 };

/* ── Per-head arithmetic ──────────────────────────────────────────────── */

test("custom monthly charges the per-participant rate per head", () => {
  assert.strictEqual(computePlanAmount(custom("MONTHLY"), 100), 200_000);
  assert.strictEqual(computePlanAmount(custom("MONTHLY"), 71), 142_000);
});

test("custom YEARLY is twelve times the monthly rate", () => {
  // Was reading the stored rate as-is, so a yearly customer paid one month's
  // price for a whole year — a 12x undercharge.
  assert.strictEqual(computePlanAmount(custom("YEARLY"), 100), 2_400_000);
  assert.strictEqual(
    computePlanAmount(custom("YEARLY"), 83),
    computePlanAmount(custom("MONTHLY"), 83) * 12,
    "yearly must equal monthly x12 — the same rule the flat tiers follow",
  );
});

test("a flat plan ignores the participant count entirely", () => {
  assert.strictEqual(computePlanAmount(flat, 5), 99800);
  assert.strictEqual(computePlanAmount(flat, 500), 99800);
});

test("a custom plan with no rate set charges zero, not NaN", () => {
  const broken = { isCustom: true, interval: "MONTHLY", pricePerParticipant: null };
  assert.strictEqual(computePlanAmount(broken, 100), 0);
});

/* ── Consumption tax ──────────────────────────────────────────────────── */

test("10% consumption tax is added on top of a tax-exclusive price", () => {
  const m = withTax(200_000);
  assert.strictEqual(m.subtotal, 200_000);
  assert.strictEqual(m.taxAmount, 20_000);
  assert.strictEqual(m.totalAmount, 220_000);
  assert.strictEqual(m.taxPercent, 10);
});

test("tax on a custom yearly period is computed on the full year", () => {
  const net = computePlanAmount(custom("YEARLY"), 100);
  assert.strictEqual(withTax(net).totalAmount, 2_640_000);
});

/* ── Stripe amount conversion ─────────────────────────────────────────── */

test("JPY is zero-decimal — the amount is never multiplied by 100", () => {
  // Sending 220000 as 22000000 would charge the customer a hundred times over.
  assert.strictEqual(toStripeAmount(220_000, "JPY"), 220_000);
  assert.strictEqual(toStripeAmount(220_000), 220_000, "JPY is the default");
});

test("a decimal currency still converts to minor units", () => {
  assert.strictEqual(toStripeAmount(10.5, "USD"), 1050);
});

/* ── Renewal must re-price a per-head plan ────────────────────────────── */

test("renewal re-prices a custom plan instead of reading plan.price", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../src/modules/organizationSubscription/organizationSubscription.service.js"),
    "utf8",
  );
  // Scope to processPeriodEnd's own body. `changePlan` further down still reads
  // plan.price, and correctly so — it rejects the Custom plan outright.
  const fn = src.slice(src.indexOf("processPeriodEnd:"), src.indexOf("markExpiredIfNeeded"));
  assert.ok(fn.length > 0, "processPeriodEnd not found");

  // `plan.price` is 0 on a Custom row, so renewing at it billed nothing at all,
  // every period, forever.
  assert.ok(
    !fn.includes("amount: plan.price"),
    "renewal must not use plan.price — a per-head plan stores 0 there",
  );
  assert.ok(
    src.includes("renewalAmount"),
    "renewal must go through renewalAmount, which re-counts participants",
  );
});

test("a customer cannot select the Custom plan at checkout", () => {
  // It carries price: 0, so subscribing to it directly was free — unlimited
  // participants at no charge. It is only ever applied by the upgrade path.
  for (const f of [
    "../src/modules/payment/payment.service.js",
    "../src/modules/organizationSubscription/organizationSubscription.service.js",
  ]) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.ok(
      src.includes("plan.isCustom") && src.includes("cannot be selected directly"),
      `${f} must reject a Custom plan at checkout`,
    );
  }
});

test("the upgrade trigger and the renewal charge share one headcount", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../src/modules/organizationSubscription/organizationSubscription.service.js"),
    "utf8",
  );
  // A second count with a different filter would upgrade an organization at one
  // number and bill it at another.
  assert.ok(
    src.includes("activeParticipantCount"),
    "renewal must reuse activeParticipantCount, not re-query participants",
  );
});

/* ── Declined assignments must not count as staffed ───────────────────── */

test("dispatch + booking relations exclude DECLINED, not just CANCELLED", () => {
  // A declined assignment leaves nobody working the task. If it still counted,
  // an all-declined booking would vanish from the dispatch "needs staff" queue.
  const files = [
    "../src/modules/dispatch/dispatch.service.js",
    "../src/modules/booking/booking.service.js",
  ];
  for (const f of files) {
    const src = fs.readFileSync(path.join(__dirname, f), "utf8");
    assert.ok(
      !src.includes('status: { not: "CANCELLED" }'),
      `${f} must exclude DECLINED too (use notIn), not only CANCELLED`,
    );
  }
});

test("createSubscription re-prices via data.organizationId, not a bare ref", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../src/modules/organizationSubscription/organizationSubscription.service.js"),
    "utf8",
  );
  const fn = src.slice(src.indexOf("createSubscription:"), src.indexOf("getSubscriptions"));
  // `renewalAmount(plan, organizationId)` throws ReferenceError — the param is `data`.
  assert.ok(
    !/renewalAmount\(plan, organizationId\)/.test(fn),
    "createSubscription must pass data.organizationId, not an undeclared organizationId",
  );
});

/* ── Reports export must cover all three types uniformly ──────────────── */

test("report export supports vehicles alongside bookings and attendance", () => {
  // The vehicle report used to build CSV in the browser: CSV-only, and the one
  // report that could not produce Excel or localize its headers server-side.
  const src = fs.readFileSync(
    path.join(__dirname, "../src/modules/report/report.controller.js"),
    "utf8",
  );
  for (const type of ["bookings", "attendance", "vehicles"]) {
    assert.ok(
      src.includes(`type === "${type}"`),
      `export must handle type=${type}`,
    );
  }
});

test("vehicle report columns are localized in both languages", () => {
  const { getLabels } = require("../src/modules/report/report.labels");
  for (const lang of ["en", "ja"]) {
    const L = getLabels(lang);
    for (const key of ["vehicleName", "totalTrips", "totalCost", "costPerKm"]) {
      assert.ok(L[key], `${lang} labels must define ${key}`);
    }
  }
  // A Japanese export that emitted English headers was a real past complaint.
  assert.notStrictEqual(getLabels("ja").vehicleName, getLabels("en").vehicleName);
});
