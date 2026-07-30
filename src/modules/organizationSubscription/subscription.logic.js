// Pure subscription logic (no DB) — unit-testable.
const DAY_MS = 24 * 60 * 60 * 1000;

// Whether a subscription row denies access at `nowMs`. Single source of truth
// reused by computeState() and the auth-middleware expiry guard (no drift).
// `null`/missing sub counts as expired.
function isSubscriptionExpired(sub, nowMs = Date.now()) {
  if (!sub) return true;
  const ended = Number(sub.endAt) < nowMs;
  return (
    sub.status === "EXPIRED" ||
    sub.status === "CANCELLED" ||
    (ended && sub.status !== "ACTIVE" && sub.status !== "TRIALING")
  );
}

// Computed UI/state fields from a subscription row + current time (ms).
function computeState(sub, nowMs = Date.now()) {
  if (!sub) return { hasSubscription: false, isExpired: true, current: null, daysLeft: 0 };
  const end = Number(sub.endAt);
  const isExpired = isSubscriptionExpired(sub, nowMs);
  const daysLeft = Math.max(0, Math.ceil((end - nowMs) / DAY_MS));
  return {
    hasSubscription: true,
    current: sub,
    isExpired,
    daysLeft,
    isTrial: !!sub.isTrial || sub.status === "TRIALING",
    autoRenew: sub.autoRenew,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    nextBillingAt: sub.cancelAtPeriodEnd || !sub.autoRenew ? null : end,
    // Provisional auto-upgrade awaiting konbini payment (UC36) — drives a "pay
    // within 3 days or your upgrade reverts" banner.
    provisionalUpgrade: sub.provisionalInvoiceRef
      ? { until: Number(sub.provisionalUntil), planName: sub.planName }
      : null,
  };
}

// Whether an ended subscription should auto-renew (vs expire).
function isRenewable(sub) {
  return !!sub.autoRenew && !sub.cancelAtPeriodEnd && !sub.isTrial;
}

module.exports = { computeState, isRenewable, isSubscriptionExpired, DAY_MS };
