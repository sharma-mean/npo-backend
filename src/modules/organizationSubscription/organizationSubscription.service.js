const prisma = require("../../config/db");
const crypto = require("crypto");
const { computeState, isRenewable } = require("./subscription.logic");
const { withTax, TAX_PERCENT, stripe } = require("../../config/stripe");

// Only a card can be auto-charged. Konbini / bank transfer are push methods —
// the customer sends the money, Stripe cannot pull it on a schedule.
const canAutoRenewMethod = (method) => !method || method === "CARD";

// Readable rows for the billing sweep emails.
const PAYMENT_METHOD_LABEL = {
  CARD: "Card",
  KONBINI: "Convenience store (コンビニ)",
  BANK_TRANSFER: "Bank transfer (振込)",
};

const formatDay = (ms) => {
  if (ms == null) return "—";
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-GB", {
        timeZone: "Asia/Tokyo",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

/**
 * Mirror our cancel/auto-renew intent onto the Stripe subscription.
 *
 * Without this, cancelling would only flip OUR row: Stripe would keep charging
 * the card next period and the invoice.paid webhook would re-activate the
 * subscription — the customer would be billed after cancelling. So the Stripe
 * call is made FIRST and its failure aborts the whole operation (we must never
 * tell a user they're cancelled while Stripe still bills them).
 *
 * No-ops for konbini/bank-transfer periods (one-off payments, no Stripe
 * Subscription object) and for legacy/emulated rows with no stripeSubscriptionId.
 */
const syncStripeCancelAtPeriodEnd = async (subscription, cancelAtPeriodEnd) => {
  const id = subscription?.stripeSubscriptionId;
  if (!id || !stripe) return;
  await stripe.subscriptions.update(id, { cancel_at_period_end: cancelAtPeriodEnd });
};

const {
  validateCreateSubscription
} = require("./organizationSubscription.validation");

const DAY_MS = 24 * 60 * 60 * 1000;
const planDurationMs = (plan) => BigInt(plan.durationDays * DAY_MS);
// 8 bytes (64 bits) of entropy: even two checkouts in the same millisecond won't
// collide on the @unique invoice number/paymentRef, so the in-transaction
// invoice.create() (changePlan/createSubscription) can't P2002-abort the checkout.
const rndHex = () => crypto.randomBytes(8).toString("hex").toUpperCase();

// Build the data object for an emulated PAID invoice (shared by the retry-safe
// createInvoice and the atomic changePlan transaction).
//
// `amount` is the plan price, which is TAX-EXCLUSIVE — so the invoice must also
// carry the 10% consumption tax and the gross total, otherwise a receipt would
// understate what the customer actually paid (and Japan's qualified invoice
// requires the tax to be itemised).
const makeInvoiceData = ({ organizationId, subscriptionId, planName, amount, currency, periodStart, periodEnd, now }) => {
  const money = withTax(amount);
  return {
    organizationId,
    subscriptionId: subscriptionId || null,
    number: `INV-${Date.now().toString(36).toUpperCase()}-${rndHex()}`,
    planName,
    amount: money.subtotal,
    taxAmount: money.taxAmount,
    taxPercent: money.taxPercent,
    totalAmount: money.totalAmount,
    currency: currency || "JPY",
    status: "PAID",
    paymentRef: `PAY-${Date.now().toString(36).toUpperCase()}-${rndHex()}`,
    periodStart,
    periodEnd,
    createdAt: now,
  };
};

// Staff-side seats used by an org (the metric plan.maxUsers caps).
const countSeats = (organizationId) =>
  prisma.user.count({
    where: {
      organizationId,
      isDeleted: false,
      role: { in: ["NPO_ADMIN", "COORDINATOR", "STAFF"] },
    },
  });

/**
 * What to charge for the period starting now.
 *
 * Flat tiers renew at their stored price. A Custom plan stores `price: 0`
 * because it is billed per participant, so it must be re-counted at renewal —
 * reading `plan.price` renewed those organizations for free indefinitely.
 */
const renewalAmount = async (plan, organizationId) => {
  if (!plan.isCustom) return plan.price;
  // Reuse the upgrade path's own headcount — a second query with a slightly
  // different filter would upgrade an org at one number and bill it at another.
  const { computePlanAmount, activeParticipantCount } = require("./autoUpgrade.service");
  return computePlanAmount(plan, await activeParticipantCount(organizationId));
};

const organizationSubscriptionService = {
  // Super-admin: provision/replace an org's subscription. Upserts the single
  // per-org row (no orphaned duplicates) with a full billing snapshot + invoice.
  createSubscription: async (data) => {
    validateCreateSubscription(data);

    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: data.planId } });
    if (!plan) throw new Error("Plan not found");

    const now = BigInt(Date.now());
    const startAt = now;
    const endAt = now + planDurationMs(plan);
    // Per-head plans store `price: 0`; charge the live headcount instead.
    const amount = await renewalAmount(plan, data.organizationId);

    const sub = await prisma.$transaction(async (tx) => {
      const row = await tx.organizationSubscription.upsert({
        where: { organizationId: data.organizationId },
        create: {
          organizationId: data.organizationId,
          planId: plan.id, planName: plan.name, amount,
          status: "ACTIVE", autoRenew: true, cancelAtPeriodEnd: false, isTrial: false,
          createdBy: data.createdBy || null,
          startAt, endAt, createdAt: now, updatedAt: now,
        },
        update: {
          planId: plan.id, planName: plan.name, amount,
          status: "ACTIVE", autoRenew: true, cancelAtPeriodEnd: false, isTrial: false,
          startAt, endAt, updatedAt: now,
        },
      });
      await tx.invoice.create({
        data: makeInvoiceData({
          organizationId: data.organizationId, subscriptionId: row.id,
          planName: plan.name, amount, periodStart: startAt, periodEnd: endAt, now,
        }),
      });
      return row;
    });

    await prisma.organization.update({
      where: { id: data.organizationId },
      data: { status: "ACTIVE", updatedAt: now },
    });
    return sub;
  },

  getSubscriptions: async () => {
    return await prisma.organizationSubscription.findMany({
      include: {
        organization: true,
        plan: true
      },
      orderBy: { createdAt: "desc" },
    });
  },

  // The org's single current subscription (latest)
  getCurrent: (organizationId) =>
    prisma.organizationSubscription.findFirst({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    }),

  // Create an emulated PAID invoice for a charge. Retries on the rare
  // unique-number collision (concurrent charges in the same millisecond).
  createInvoice: async ({ organizationId, subscriptionId, planName, amount, periodStart, periodEnd }) => {
    const now = BigInt(Date.now());
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await prisma.invoice.create({
          data: makeInvoiceData({ organizationId, subscriptionId, planName, amount, periodStart, periodEnd, now }),
        });
      } catch (err) {
        if (err.code === "P2002" && attempt < 2) continue; // unique collision → retry
        throw err;
      }
    }
  },

  // Computed state from the current subscription
  getSubscriptionState: async (organizationId) => {
    if (!organizationId) return { hasSubscription: false, isExpired: false, current: null };
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    return computeState(current, Date.now());
  },

  // When a subscription's period has ended: auto-renew (paid) or expire.
  // Used both lazily (on request) and by the daily cron. Concurrency-safe:
  // an optimistic `updateMany` (guarded on the unchanged endAt + status) ensures
  // only ONE caller settles the period, so no duplicate invoices / extensions.
  processPeriodEnd: async (sub) => {
    const now = BigInt(Date.now());
    const ended = Number(sub.endAt) < Date.now();
    if (!ended) return sub;
    if (sub.status === "EXPIRED" || sub.status === "CANCELLED") return sub;

    if (isRenewable(sub)) {
      const plan = await prisma.subscriptionPlan.findUnique({ where: { id: sub.planId } });
      // Renew only onto a still-active plan. A deleted or discontinued
      // (isActive=false) plan falls through to expiry — never silently
      // recharges onto a dead plan or leaves the sub stuck ACTIVE past endAt.
      if (plan && plan.isActive) {
        const durationMs = planDurationMs(plan);
        const startAt = sub.endAt;
        const endAt = startAt + durationMs;

        // A Custom plan is priced per head, so `plan.price` is 0 on the row —
        // renewing at that figure billed the customer NOTHING, every period,
        // forever. Re-count the participants and re-price at renewal, which also
        // makes an organization that grew inside the Custom tier pay for the
        // people it actually has.
        const amount = await renewalAmount(plan, sub.organizationId);

        // Only the caller that still sees the OLD endAt+status wins the renewal.
        const res = await prisma.organizationSubscription.updateMany({
          where: { id: sub.id, status: sub.status, endAt: sub.endAt },
          data: { startAt, endAt, status: "ACTIVE", amount, planName: plan.name, updatedAt: now },
        });
        if (res.count === 1) {
          await organizationSubscriptionService.createInvoice({
            organizationId: sub.organizationId, subscriptionId: sub.id, planName: plan.name, amount, periodStart: startAt, periodEnd: endAt,
          });
          await prisma.organization.update({ where: { id: sub.organizationId }, data: { status: "ACTIVE", updatedAt: now } });
        }
        return prisma.organizationSubscription.findUnique({ where: { id: sub.id } });
      }
    }
    // Not renewable → expire the SUBSCRIPTION only (guarded so it runs once).
    // Org status is left untouched — access gating is driven by the
    // subscription status (OrganizationStatus has no EXPIRED member).
    await prisma.organizationSubscription.updateMany({
      where: { id: sub.id, status: sub.status, endAt: sub.endAt },
      data: { status: sub.cancelAtPeriodEnd ? "CANCELLED" : "EXPIRED", updatedAt: now },
    });
    return prisma.organizationSubscription.findUnique({ where: { id: sub.id } });
  },

  // Lazy lifecycle settle (auto-renew or expire) then return fresh state
  markExpiredIfNeeded: async (organizationId) => {
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    if (current && Number(current.endAt) < Date.now() && (current.status === "ACTIVE" || current.status === "TRIALING")) {
      await organizationSubscriptionService.processPeriodEnd(current);
    }
    return organizationSubscriptionService.getSubscriptionState(organizationId);
  },

  // Subscribe / upgrade / downgrade — immediate, EMULATED payment + invoice.
  //
  // This takes no money. It exists for local dev/demo only, and is hard-blocked
  // in production: leaving it reachable there would let any NPO_ADMIN activate a
  // paid plan for free. Real money goes through POST /api/payments/checkout.
  changePlan: async ({ organizationId, planId, userId }) => {
    if (process.env.NODE_ENV === "production" || process.env.DISABLE_EMULATED_CHECKOUT === "true") {
      throw new Error("Emulated checkout is disabled — use the Stripe checkout instead");
    }
    if (!planId) throw new Error("planId is required");
    const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new Error("Plan not found");
    // The Custom plan is per-head and carries `price: 0`, so selecting it here
    // would subscribe the organization for nothing. It is never chosen by a
    // customer — `autoUpgrade` applies it automatically at 71+ participants and
    // prices it from the live headcount.
    if (plan.isCustom) {
      throw new Error(
        "The Custom plan cannot be selected directly — it is applied automatically once your organization exceeds the Enterprise participant limit."
      );
    }


    const nowMs = Date.now();
    const now = BigInt(nowMs);
    const current = await organizationSubscriptionService.getCurrent(organizationId);

    // Idempotency / no-op guard: already on this exact plan and still active →
    // refuse (prevents a double-submit from re-charging + resetting the period).
    if (
      current &&
      current.planId === plan.id &&
      (current.status === "ACTIVE" || current.status === "TRIALING") &&
      Number(current.endAt) > nowMs
    ) {
      throw new Error("You are already subscribed to this plan.");
    }

    // Downgrade guard: block moving to a plan whose seat limit is below current
    // staff usage — would leave the org over-provisioned.
    if (plan.maxUsers != null) {
      const seatsUsed = await countSeats(organizationId);
      if (seatsUsed > plan.maxUsers) {
        throw new Error(
          `This plan allows ${plan.maxUsers} staff seats but your organization uses ${seatsUsed}. Remove staff before downgrading.`,
        );
      }
    }
    // Same guard for the participant-based cap (client plans limit participants).
    if (plan.maxParticipants != null) {
      const participantsUsed = await prisma.user.count({
        where: { organizationId, isDeleted: false, role: "PARTICIPANT" },
      });
      if (participantsUsed > plan.maxParticipants) {
        throw new Error(
          `This plan allows ${plan.maxParticipants} participants but your organization has ${participantsUsed}. Remove participants before downgrading.`,
        );
      }
    }

    // Proration (emulated): carry remaining paid time from the current active
    // period forward so an upgrade/downgrade mid-period doesn't forfeit it.
    const remainingMs =
      current &&
      (current.status === "ACTIVE" || current.status === "TRIALING") &&
      Number(current.endAt) > nowMs
        ? Number(current.endAt) - nowMs
        : 0;
    const startAt = now;
    const endAt = now + planDurationMs(plan) + BigInt(remainingMs);
    // Preserve the user's auto-renew preference; reset cancel-at-period-end.
    const autoRenew = current ? current.autoRenew : true;

    const sub = await prisma.$transaction(async (tx) => {
      const row = await tx.organizationSubscription.upsert({
        where: { organizationId },
        create: {
          organizationId, planId: plan.id, planName: plan.name, amount: plan.price, isTrial: false,
          paymentRef: `PAY-${Date.now().toString(36).toUpperCase()}`, createdBy: userId || null,
          status: "ACTIVE", autoRenew, cancelAtPeriodEnd: false,
          startAt, endAt, createdAt: now, updatedAt: now,
        },
        update: {
          planId: plan.id, planName: plan.name, amount: plan.price, isTrial: false,
          paymentRef: `PAY-${Date.now().toString(36).toUpperCase()}`,
          status: "ACTIVE", autoRenew, cancelAtPeriodEnd: false,
          startAt, endAt, updatedAt: now,
        },
        include: { plan: true },
      });
      await tx.invoice.create({
        data: makeInvoiceData({
          organizationId, subscriptionId: row.id, planName: plan.name,
          amount: plan.price, periodStart: startAt, periodEnd: endAt, now,
        }),
      });
      return row;
    });

    await prisma.organization.update({ where: { id: organizationId }, data: { status: "ACTIVE", updatedAt: now } });
    return sub;
  },

  // Cancel at period end (keep access until then)
  cancelSubscription: async (organizationId) => {
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    if (!current) throw new Error("No active subscription");
    if (current.status !== "ACTIVE" && current.status !== "TRIALING") {
      throw new Error("Only an active subscription can be cancelled");
    }

    // MUST reach Stripe first for a card subscription. Flipping only our row
    // would leave Stripe billing the card next period, and the resulting
    // invoice.paid webhook would silently re-activate the subscription — i.e.
    // the customer gets charged after cancelling.
    await syncStripeCancelAtPeriodEnd(current, true);

    return prisma.organizationSubscription.update({
      where: { id: current.id },
      data: { cancelAtPeriodEnd: true, autoRenew: false, updatedAt: BigInt(Date.now()) },
      include: { plan: true },
    });
  },

  // Undo a pending cancel
  reactivateSubscription: async (organizationId) => {
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    if (!current) throw new Error("No subscription");
    if (current.status !== "ACTIVE" && current.status !== "TRIALING") {
      throw new Error("Subscription has already ended — subscribe to a plan instead");
    }

    // Konbini / bank transfer can't be auto-charged, so there is nothing to
    // reactivate at Stripe — those customers must pay again themselves.
    if (!canAutoRenewMethod(current.paymentMethod)) {
      throw new Error(
        "This payment method cannot renew automatically — please pay for the next period instead",
      );
    }
    await syncStripeCancelAtPeriodEnd(current, false);

    return prisma.organizationSubscription.update({
      where: { id: current.id },
      data: { cancelAtPeriodEnd: false, autoRenew: true, updatedAt: BigInt(Date.now()) },
      include: { plan: true },
    });
  },

  setAutoRenew: async (organizationId, autoRenew) => {
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    if (!current) throw new Error("No subscription");
    if (current.status !== "ACTIVE" && current.status !== "TRIALING") {
      throw new Error("Only an active subscription can change auto-renew");
    }

    const wantAutoRenew = !!autoRenew;
    // Only a card subscription can auto-renew at all — never let the UI turn it
    // on for a push payment method, or we'd promise a renewal that can't happen.
    if (wantAutoRenew && !canAutoRenewMethod(current.paymentMethod)) {
      throw new Error("This payment method cannot renew automatically");
    }

    // Auto-renew OFF == cancel_at_period_end ON at Stripe.
    await syncStripeCancelAtPeriodEnd(current, !wantAutoRenew);

    return prisma.organizationSubscription.update({
      where: { id: current.id },
      data: {
        autoRenew: wantAutoRenew,
        cancelAtPeriodEnd: !wantAutoRenew,
        updatedAt: BigInt(Date.now()),
      },
      include: { plan: true },
    });
  },

  // Throws if adding another staff-side seat would exceed the plan's maxUsers.
  // No-op when there's no plan limit. Call before creating staff-side users.
  assertSeatCapacity: async (organizationId) => {
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    const max = current?.plan?.maxUsers ?? null;
    if (max == null) return;
    const used = await countSeats(organizationId);
    if (used >= max) {
      throw new Error(
        `Seat limit reached (${max}). Upgrade your plan to add more staff.`,
      );
    }
  },

  // Throws if adding another participant would exceed the plan's maxParticipants
  // (client plans are participant-based). No-op when the plan has no cap.
  assertParticipantCapacity: async (organizationId) => {
    const current = await organizationSubscriptionService.getCurrent(organizationId);
    const max = current?.plan?.maxParticipants ?? null;
    if (max == null) return;
    const used = await prisma.user.count({
      where: { organizationId, isDeleted: false, role: "PARTICIPANT" },
    });
    if (used >= max) {
      throw new Error(
        `Participant limit reached (${max}). Upgrade your plan to add more participants.`,
      );
    }
  },

  // Current org's subscription state + invoices + usage vs plan limits
  mySubscription: async (organizationId) => {
    const state = await organizationSubscriptionService.markExpiredIfNeeded(organizationId);
    const invoices = await prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });

    // Usage counts (limit = plan.maxUsers; seats = staff-side members)
    const where = { organizationId, isDeleted: false };
    const [staff, guardians, participants, total] = await Promise.all([
      prisma.user.count({ where: { ...where, role: { in: ["NPO_ADMIN", "COORDINATOR", "STAFF"] } } }),
      prisma.user.count({ where: { ...where, role: "GUARDIAN" } }),
      prisma.user.count({ where: { ...where, role: "PARTICIPANT" } }),
      prisma.user.count({ where } ),
    ]);
    const maxUsers = state.current?.plan?.maxUsers ?? null;
    // Client plans are PARTICIPANT-based (Basic 10 / Pro 30 / Ent 100), so the
    // participant count is the headline usage metric; staff seats are secondary.
    const maxParticipants = state.current?.plan?.maxParticipants ?? null;
    const usage = {
      staff,
      guardians,
      participants,
      total,
      maxUsers,
      seatsUsed: staff,
      seatsLeft: maxUsers != null ? Math.max(0, maxUsers - staff) : null,
      percent: maxUsers ? Math.min(100, Math.round((staff / maxUsers) * 100)) : 0,
      // Participant usage (the plan's headline limit)
      maxParticipants,
      participantsLeft: maxParticipants != null ? Math.max(0, maxParticipants - participants) : null,
      participantPercent: maxParticipants
        ? Math.min(100, Math.round((participants / maxParticipants) * 100))
        : 0,
    };

    // Org brand logo + its own registration number for the printed receipt (the
    // response middleware turns the stored B2 key into a signed brandLogoUrl).
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, brandLogo: true, taxRegistrationNumber: true },
    });

    // Issuer details for the qualified invoice (適格請求書). The org's own
    // admin-set registration number wins (client #4 — each org has its own);
    // the platform-wide env value is only a fallback when the org hasn't set one.
    const issuer = {
      name: process.env.INVOICE_ISSUER_NAME || "SHINY-SOMS",
      taxRegistrationNumber:
        organization?.taxRegistrationNumber || process.env.TAX_REGISTRATION_NUMBER || null,
      taxPercent: TAX_PERCENT,
    };

    return { ...state, invoices, usage, issuer, organization };
  },

  // Subscription + invoices for one org (super admin)
  getOrgSubscriptions: async (organizationId) => {
    const subscriptions = await prisma.organizationSubscription.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
      include: { plan: true },
    });
    const invoices = await prisma.invoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
    return { subscriptions, invoices };
  },

  // Daily sweep: notify "expiring in 3 days" + mark/notify expired.
  // Best-effort; safe to run repeatedly.
  runExpirySweep: async () => {
    const notificationService = require("../notification/notification.service");
    const now = Date.now();
    const in3Days = now + 3 * 24 * 60 * 60 * 1000;

    // Batch-load NPO_ADMINs for a set of orgs in one query → Map<orgId, admins[]>.
    // Avoids the per-subscription N+1 the sweep previously ran.
    const adminsByOrg = async (orgIds) => {
      const map = new Map();
      const ids = [...new Set(orgIds)];
      if (!ids.length) return map;
      const admins = await prisma.user.findMany({
        where: { organizationId: { in: ids }, role: "NPO_ADMIN", isDeleted: false },
        select: { id: true, email: true, fullName: true, organizationId: true },
      });
      for (const a of admins) {
        if (!map.has(a.organizationId)) map.set(a.organizationId, []);
        map.get(a.organizationId).push(a);
      }
      return map;
    };

    // Ending soon AND won't auto-renew (cancelling or auto-renew off) → warn
    const expiring = await prisma.organizationSubscription.findMany({
      where: {
        status: { in: ["ACTIVE", "TRIALING"] },
        endAt: { gte: BigInt(now), lte: BigInt(in3Days) },
        OR: [{ autoRenew: false }, { cancelAtPeriodEnd: true }, { isTrial: true }],
      },
    });
    const expiringAdmins = await adminsByOrg(expiring.map((s) => s.organizationId));
    for (const sub of expiring) {
      const admins = expiringAdmins.get(sub.organizationId) || [];
      const days = Math.max(1, Math.ceil((Number(sub.endAt) - now) / (24 * 60 * 60 * 1000)));

      // Konbini / bank transfer cannot be charged automatically — those orgs
      // must actively pay again, so tell them that instead of "renew or upgrade".
      const isPushMethod = ["KONBINI", "BANK_TRANSFER"].includes(sub.paymentMethod);
      const message = isPushMethod
        ? `Your ${sub.planName || "subscription"} ends in ${days} day(s). ` +
          `Your payment method (${sub.paymentMethod === "KONBINI" ? "convenience store" : "bank transfer"}) ` +
          `cannot renew automatically — please pay for the next period before it expires to keep your access.`
        : `Your ${sub.planName || "subscription"} ends in ${days} day(s). Renew or upgrade to avoid interruption.`;

      // allSettled so one admin's notify failure never aborts the sweep.
      await Promise.allSettled(
        admins.map((admin) =>
          notificationService.notify({
            userId: admin.id,
            organizationId: sub.organizationId,
            title: "Your plan is ending soon",
            message,
            type: "BILLING",
            email: admin.email,
            recipientName: admin.fullName,
            emailSubject: "Your plan ends soon",
            emailData: {
              eyebrow: "Billing",
              details: [
                ["Plan", sub.planName || "—"],
                ["Ends in", `${days} day(s)`],
                ["Ends on", formatDay(sub.endAt)],
                ...(sub.paymentMethod
                  ? [["Payment method", PAYMENT_METHOD_LABEL[sub.paymentMethod] || sub.paymentMethod]]
                  : []),
                ...(isPushMethod ? [["Auto-renew", "Not available — manual payment required"]] : []),
              ],
              actionUrl: `${process.env.FRONTEND_URL || ""}/billing`,
              actionText: "Renew Plan",
            },
          }),
        ),
      );
    }

    // Period ended → auto-renew (paid) or expire. processPeriodEnd mutates per
    // sub; isolate each so one failing org doesn't abort the whole sweep.
    const ended = await prisma.organizationSubscription.findMany({
      where: { status: { in: ["ACTIVE", "TRIALING"] }, endAt: { lt: BigInt(now) } },
    });
    let renewed = 0;
    const expiredSubs = [];
    for (const sub of ended) {
      try {
        const after = await organizationSubscriptionService.processPeriodEnd(sub);
        if (after?.status === "ACTIVE") renewed++;
        else expiredSubs.push(sub);
      } catch (err) {
        console.error(`[cron] processPeriodEnd failed for sub ${sub.id}:`, err.message);
      }
    }

    const expiredAdmins = await adminsByOrg(expiredSubs.map((s) => s.organizationId));
    for (const sub of expiredSubs) {
      const admins = expiredAdmins.get(sub.organizationId) || [];
      await Promise.allSettled(
        admins.map((admin) =>
          notificationService.notify({
            userId: admin.id,
            organizationId: sub.organizationId,
            title: "Your plan has expired",
            message: "Your subscription has expired. Renew or upgrade your plan to restore full access.",
            type: "BILLING",
            email: admin.email,
            recipientName: admin.fullName,
            emailSubject: "Your plan has expired",
            emailData: {
              eyebrow: "Billing",
              details: [
                ["Plan", sub.planName || "—"],
                ["Expired on", formatDay(sub.endAt)],
              ],
              actionUrl: `${process.env.FRONTEND_URL || ""}/billing`,
              actionText: "Upgrade Plan",
            },
          }),
        ),
      );
    }

    return { expiringNotified: expiring.length, renewed, expired: expiredSubs.length };
  },
};

module.exports = organizationSubscriptionService;
