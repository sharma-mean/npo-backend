const crypto = require("crypto");
const prisma = require("../../config/db");
const { withTax, isStripeEnabled } = require("../../config/stripe");
const notificationService = require("../notification/notification.service");
const { logAudit } = require("../../utils/auditLogger");

const rnd = () => crypto.randomBytes(4).toString("hex");

/**
 * Automatic participant-based plan upgrade (client Use Cases 35–37).
 *
 * When active participants cross a plan's cap the org is moved up a tier
 * (Basic→Professional→Enterprise) and, at 71+, onto the per-head **Custom Plan**
 * (¥2000/participant). Adding a participant is NEVER blocked (UC35) — the upgrade
 * just happens. Card orgs are charged the prorated difference immediately (Stripe
 * proration); konbini/bank-transfer orgs get the higher plan **provisionally** for
 * a 3-day grace window while a prorated konbini invoice is pending — if it isn't
 * paid in time the upgrade is revoked and the org rolls back to its previous plan.
 *
 * Real Stripe money-movement (proration charge / konbini slip) runs when live keys
 * are configured; the DB-side upgrade, provisional state, grace + rollback, and
 * notifications work regardless (and are what emulated/dev exercises).
 */

const GRACE_MS = 3 * 24 * 60 * 60 * 1000; // 3-day konbini grace window
const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

/**
 * The participant headcount every billing decision is based on — the upgrade
 * trigger AND the per-head renewal charge must agree, or an organization is
 * moved onto Custom at one number and billed at another.
 */
const activeParticipantCount = (organizationId) =>
  prisma.user.count({ where: { organizationId, role: "PARTICIPANT", isDeleted: false } });

// A plan's period charge: Custom is per-head, everything else is the flat price.
/**
 * What one billing period of `plan` costs for `participantCount` people,
 * tax-exclusive.
 *
 * A standard plan stores its period price directly (the YEARLY row already holds
 * monthly × 12). A custom plan stores a per-participant MONTHLY rate on both
 * rows, so a yearly custom period must multiply by 12 here — the same
 * "yearly = monthly × 12, no discount" rule the standard tiers follow. Reading
 * the stored rate as-is on a yearly plan billed a customer one month's price for
 * a whole year.
 */
const MONTHS_PER_YEAR = 12;

const computePlanAmount = (plan, participantCount) => {
  if (!plan.isCustom) return plan.price;
  const perMonth = (plan.pricePerParticipant || 0) * participantCount;
  return plan.interval === "YEARLY" ? perMonth * MONTHS_PER_YEAR : perMonth;
};

// The cheapest standard plan (matching the current billing interval) whose cap
// fits `count`; if none fits (count > highest cap, i.e. 71+) → the Custom plan.
const resolveTargetPlan = async (count, interval) => {
  const plans = await prisma.subscriptionPlan.findMany({
    where: { isActive: true, interval },
    orderBy: { maxParticipants: "asc" },
  });
  const standard = plans.filter((p) => !p.isCustom && p.maxParticipants != null);
  const fit = standard.find((p) => count <= p.maxParticipants);
  if (fit) return fit;
  return plans.find((p) => p.isCustom) || null;
};

// Notify the three audiences of an automatic upgrade (UC37).
const notifyUpgrade = async (organizationId, fromName, toName, count, provisional) => {
  try {
    const managers = await prisma.user.findMany({
      where: { organizationId, role: { in: MANAGER_ROLES }, status: true, isDeleted: false },
      select: { id: true, email: true, role: true },
    });
    const admins = managers.filter((m) => m.role === "NPO_ADMIN");
    const coords = managers.filter((m) => m.role === "COORDINATOR");

    for (const a of admins) {
      await notificationService.notify({
        userId: a.id,
        organizationId,
        type: "PLAN_UPGRADED",
        title: provisional ? "Plan upgrade — payment required" : "Your plan was upgraded",
        message: provisional
          ? `Your plan was provisionally upgraded to ${toName} because you now have ${count} active participants. Please pay the konbini slip within 3 days to keep it.`
          : `Your plan was automatically upgraded to ${toName} because you now have ${count} active participants.`,
        email: a.email,
        emailSubject: provisional ? "Action needed: complete your plan upgrade payment" : "Your plan was upgraded",
      });
    }
    for (const c of coords) {
      await notificationService.notify({
        userId: c.id,
        organizationId,
        type: "PLAN_UPGRADED",
        title: "Plan upgraded",
        message: `Plan upgraded to ${toName}. Participant capacity has increased.`,
      });
    }
    // Super Admins get a platform-level notice (org-wide, no org scoping on read).
    const supers = await prisma.user.findMany({
      where: { role: "SUPER_ADMIN", status: true, isDeleted: false },
      select: { id: true },
    });
    for (const s of supers) {
      await notificationService.notify({
        userId: s.id,
        organizationId,
        type: "PLAN_UPGRADED",
        title: "Organization plan auto-upgraded",
        message: `An organization moved from ${fromName || "—"} to ${toName} (${count} participants)${provisional ? " — provisional, awaiting konbini payment" : ""}.`,
      });
    }
  } catch (err) {
    console.error("[autoUpgrade] notify failed:", err.message);
  }
};

// Prorated difference for the remainder of the current period.
const proratedDiff = (current, currentAmount, targetAmount) => {
  const now = Date.now();
  const start = Number(current.startAt);
  const end = Number(current.endAt);
  if (!(end > now && end > start)) return Math.max(0, targetAmount - currentAmount);
  const remainingFraction = (end - now) / (end - start);
  return Math.max(0, Math.round((targetAmount - currentAmount) * remainingFraction));
};

// Real Stripe money-movement for the prorated upgrade (only called when Stripe is
// live). Card → an auto-charged invoice on the card on file; konbini/bank → a
// hosted Checkout session (mode:payment) that issues the payment slip and whose
// completion fires `async_payment_succeeded` (→ confirmProvisionalPayment). Returns
// the konbini session id to store as the provisional ref, or null for card.
// Best-effort — the caller catches any throw and the DB upgrade still applies.
const chargeUpgrade = async (current, targetPlan, count, money) => {
  const { stripe, toStripeAmount } = require("../../config/stripe");
  const org = await prisma.organization.findUnique({
    where: { id: current.organizationId },
    select: { stripeCustomerId: true, name: true },
  });
  let customerId = org?.stripeCustomerId;
  if (!customerId) {
    const c = await stripe.customers.create({ name: org?.name || undefined, metadata: { organizationId: current.organizationId } });
    customerId = c.id;
    await prisma.organization.update({ where: { id: current.organizationId }, data: { stripeCustomerId: customerId } });
  }

  const amount = toStripeAmount(money.total, targetPlan.currency || "JPY");
  const description = `Prorated upgrade to ${targetPlan.name}${targetPlan.isCustom ? ` (${count} participants)` : ""}`;
  const metadata = { organizationId: current.organizationId, type: "auto_upgrade_proration", targetPlanId: targetPlan.id };

  if (current.paymentMethod === "CARD") {
    // Charge the difference on the card on file (auto-advancing invoice).
    await stripe.invoiceItems.create({ customer: customerId, amount, currency: (targetPlan.currency || "JPY").toLowerCase(), description });
    const inv = await stripe.invoices.create({ customer: customerId, collection_method: "charge_automatically", auto_advance: true, metadata });
    await stripe.invoices.finalizeInvoice(inv.id).catch(() => {});
    return null; // card is immediate — no provisional grace
  }

  // Konbini / bank transfer → hosted checkout for the prorated amount (issues slip).
  const base = process.env.FRONTEND_URL || "http://localhost:5173";
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "payment",
    payment_method_types: [current.paymentMethod === "BANK_TRANSFER" ? "customer_balance" : "konbini"],
    locale: "ja",
    line_items: [{
      price_data: {
        currency: (targetPlan.currency || "JPY").toLowerCase(),
        product_data: { name: description },
        unit_amount: amount,
      },
      quantity: 1,
    }],
    payment_intent_data: { metadata },
    metadata,
    success_url: `${base}/billing?upgrade=paid`,
    cancel_url: `${base}/billing`,
  });
  return session.id;
};

const applyUpgrade = async (organizationId, current, targetPlan, count, actorId) => {
  const now = BigInt(Date.now());
  const currentPlan = current.plan;
  const targetAmount = computePlanAmount(targetPlan, count);
  const currentAmount = current.amount ?? computePlanAmount(currentPlan, count);
  const diff = proratedDiff(current, currentAmount, targetAmount);
  const money = withTax(diff);

  // Konbini/bank get a 3-day provisional grace — but ONLY when Stripe is live and
  // can actually issue a payment slip. Without live Stripe there's no way to collect
  // an async payment, so an emulated konbini upgrade is applied immediately (else it
  // would be stuck provisional and always auto-revert — no slip can ever be paid).
  const isAsync = ["KONBINI", "BANK_TRANSFER"].includes(current.paymentMethod);
  const stripeLive = isStripeEnabled();
  const useProvisional = isAsync && stripeLive;

  // Best-effort real Stripe money-movement (activates with live keys). Card =
  // prorated subscription price swap; konbini = a payment slip for the diff whose
  // payment fires the webhook that locks the upgrade in. Failures never block the
  // DB upgrade — the state machine still works.
  let stripeRef = null;
  if (stripeLive) {
    try {
      stripeRef = await chargeUpgrade(current, targetPlan, count, money);
    } catch (err) {
      console.error("[autoUpgrade] Stripe charge failed (DB upgrade still applied):", err.message);
    }
  }

  const data = {
    planId: targetPlan.id,
    planName: targetPlan.name,
    amount: targetAmount,
    updatedAt: now,
  };
  if (useProvisional) {
    data.provisionalPlanId = targetPlan.id;
    // Preserve the ORIGINAL plan across chained provisional upgrades (don't
    // overwrite with an already-provisional plan) so a revert lands correctly.
    data.previousPlanId = current.previousPlanId || currentPlan.id;
    data.provisionalUntil = BigInt(Date.now() + GRACE_MS);
    data.provisionalInvoiceRef = stripeRef || `prorate-${Date.now()}-${rnd()}`;
  } else {
    // Card / immediate — locked in, no provisional state.
    data.provisionalPlanId = null;
    data.previousPlanId = null;
    data.provisionalUntil = null;
    data.provisionalInvoiceRef = null;
    data.autoUpgradeBlockedAt = null; // a successful upgrade clears any prior block
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationSubscription.update({ where: { organizationId }, data });
    await tx.invoice.create({
      data: {
        subscriptionId: current.id,
        number: `AUTO-${Date.now()}-${rnd()}`,
        planName: `${currentPlan.name} → ${targetPlan.name} (prorated)`,
        amount: money.net,
        taxAmount: money.tax,
        taxPercent: money.taxPercent,
        totalAmount: money.total,
        currency: targetPlan.currency || "JPY",
        status: useProvisional ? "PENDING" : "PAID",
        paymentRef: `auto-${Date.now()}-${rnd()}`,
        periodStart: current.startAt,
        periodEnd: current.endAt,
        createdAt: now,
      },
    }).catch(() => {}); // invoice is best-effort audit; never block the upgrade
  });

  logAudit({
    actorId: actorId || null,
    organizationId,
    entity: "OrganizationSubscription",
    entityId: current.id,
    action: "UPGRADE",
    metadata: { from: currentPlan.name, to: targetPlan.name, count, provisional: useProvisional },
  });

  await notifyUpgrade(organizationId, currentPlan.name, targetPlan.name, count, useProvisional);
  return { upgraded: true, to: targetPlan.name, provisional: useProvisional };
};

const autoUpgradeService = {
  computePlanAmount,
  activeParticipantCount,
  resolveTargetPlan,

  /**
   * Called after a participant is added/reactivated. Detects an over-cap
   * situation and upgrades the org's plan. Only upgrades (never auto-downgrades
   * here). Best-effort — a failure never blocks the participant operation.
   */
  evaluateOnParticipantChange: async (organizationId, actorId) => {
    try {
      const current = await prisma.organizationSubscription.findUnique({
        where: { organizationId },
        include: { plan: true },
      });
      // Only act on a live subscription; no plan → nothing to upgrade.
      if (!current || !current.plan) return null;
      if (!["ACTIVE", "TRIALING"].includes(current.status)) return null;
      // A previous upgrade was reverted for non-payment → don't re-provision
      // endlessly; the org is restricted until they resolve billing (see the
      // createParticipant guard). Requires a manual/checkout resolution.
      if (current.autoUpgradeBlockedAt) return null;

      const count = await activeParticipantCount(organizationId);
      const target = await resolveTargetPlan(count, current.plan.interval);
      if (!target) return null;

      // Already on the fitting plan (or a higher one) → nothing to do. Compare by
      // cap: Custom (null cap) is the highest tier.
      const curCap = current.plan.isCustom ? Infinity : current.plan.maxParticipants ?? 0;
      const tgtCap = target.isCustom ? Infinity : target.maxParticipants ?? 0;
      if (target.id === current.planId || tgtCap <= curCap) return null;

      return await applyUpgrade(organizationId, current, target, count, actorId);
    } catch (err) {
      console.error("[autoUpgrade] evaluate failed:", err.message);
      return null;
    }
  },

  /**
   * Clears the provisional flag once a konbini/bank prorated invoice is paid —
   * called from the payment webhook / confirm path. Locks the upgrade in.
   */
  confirmProvisionalPayment: async (organizationId) => {
    await prisma.organizationSubscription.updateMany({
      where: { organizationId, provisionalInvoiceRef: { not: null } },
      data: {
        provisionalPlanId: null,
        previousPlanId: null,
        provisionalUntil: null,
        provisionalInvoiceRef: null,
        autoUpgradeBlockedAt: null, // paying resolves any restriction
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  /**
   * Whether a new participant add should be BLOCKED (only after an unpaid
   * upgrade was reverted — client's "restrict excess participant activity").
   * Normal over-cap adds are NEVER blocked (they auto-upgrade, UC35).
   */
  isParticipantAddRestricted: async (organizationId) => {
    const sub = await prisma.organizationSubscription.findUnique({
      where: { organizationId },
      include: { plan: true },
    });
    if (!sub || !sub.autoUpgradeBlockedAt || !sub.plan) return false;
    const cap = sub.plan.isCustom ? null : sub.plan.maxParticipants;
    if (cap == null) return false; // no cap → nothing to restrict
    const count = await prisma.user.count({
      where: { organizationId, role: "PARTICIPANT", isDeleted: false },
    });
    return count >= cap;
  },

  /**
   * Daily cron: any provisional upgrade whose 3-day grace has lapsed while its
   * prorated invoice is still unpaid is revoked — the org rolls back to its
   * previous plan (and its participant cap is enforced again). Per-org isolated.
   */
  runAutoUpgradeGraceSweep: async () => {
    const now = BigInt(Date.now());
    const expired = await prisma.organizationSubscription.findMany({
      where: {
        provisionalInvoiceRef: { not: null },
        provisionalUntil: { lt: now },
      },
      include: { plan: true },
    });
    let reverted = 0;
    for (const sub of expired) {
      try {
        if (!sub.previousPlanId) continue;
        const prev = await prisma.subscriptionPlan.findUnique({ where: { id: sub.previousPlanId } });
        if (!prev) continue;
        // Guard against a race with confirmProvisionalPayment: the customer's
        // async_payment_succeeded webhook can land in the same instant the grace
        // expires. Only revert if the provisional fields are STILL what we read —
        // if the webhook already cleared provisionalInvoiceRef, count is 0 and we
        // skip, so a just-paid upgrade is never clobbered back to the cheaper plan.
        const res = await prisma.organizationSubscription.updateMany({
          where: {
            id: sub.id,
            provisionalInvoiceRef: sub.provisionalInvoiceRef,
            provisionalUntil: sub.provisionalUntil,
          },
          data: {
            planId: prev.id,
            planName: prev.name,
            amount: prev.price,
            provisionalPlanId: null,
            previousPlanId: null,
            provisionalUntil: null,
            provisionalInvoiceRef: null,
            // Mark restricted — blocks further participant adds + stops re-provisioning
            // until they resolve billing (client: "restrict excess participant activity").
            autoUpgradeBlockedAt: BigInt(Date.now()),
            updatedAt: BigInt(Date.now()),
          },
        });
        if (res.count !== 1) continue; // webhook won the race — payment confirmed
        logAudit({
          organizationId: sub.organizationId,
          entity: "OrganizationSubscription",
          entityId: sub.id,
          action: "DOWNGRADE",
          metadata: { reason: "konbini prorated invoice unpaid after 3-day grace", to: prev.name },
        });
        const admins = await prisma.user.findMany({
          where: { organizationId: sub.organizationId, role: "NPO_ADMIN", status: true, isDeleted: false },
          select: { id: true, email: true },
        });
        for (const a of admins) {
          await notificationService.notify({
            userId: a.id,
            organizationId: sub.organizationId,
            type: "PLAN_DOWNGRADED",
            title: "Plan upgrade reverted",
            message: `Your provisional plan upgrade was not paid within 3 days and has been reverted to ${prev.name}. Participant activity beyond the plan limit is now restricted.`,
            email: a.email,
            emailSubject: "Your plan upgrade was reverted",
          });
        }
        reverted += 1;
      } catch (err) {
        console.error(`[autoUpgrade] revert failed for ${sub.id}:`, err.message);
      }
    }
    return { reverted };
  },
};

module.exports = autoUpgradeService;
