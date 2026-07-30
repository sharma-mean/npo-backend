const crypto = require("crypto");
const prisma = require("../../config/db");
const { assertStripe, fromStripeAmount, withTax } = require("../../config/stripe");
const notificationService = require("../notification/notification.service");
const autoUpgradeService = require("../organizationSubscription/autoUpgrade.service");

const rndHex = () => crypto.randomBytes(8).toString("hex").toUpperCase();
const invoiceNumber = () => `INV-${Date.now().toString(36).toUpperCase()}-${rndHex()}`;

const DAY_MS = 24 * 60 * 60 * 1000;

// Only a CARD subscription renews itself; konbini / bank transfer are one-off.
const canAutoRenew = (method) => method === "CARD";

const PAYMENT_METHOD_LABEL = {
  CARD: "Card",
  KONBINI: "Convenience store (コンビニ)",
  BANK_TRANSFER: "Bank transfer (振込)",
};

const formatJpy = (amount) =>
  typeof amount === "number" && Number.isFinite(amount)
    ? `¥${Math.round(amount).toLocaleString("ja-JP")}`
    : null;

const formatDay = (ms) => {
  if (ms == null) return null;
  const d = new Date(Number(ms));
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString("en-GB", {
        timeZone: "Asia/Tokyo",
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
};

/**
 * Billing detail rows for the email. Read from the org's current subscription
 * so every billing message carries plan / amount / period without each webhook
 * branch having to fetch it. Best-effort: no subscription ⇒ no rows.
 */
const billingDetails = async (organizationId) => {
  try {
    const sub = await prisma.organizationSubscription.findUnique({
      where: { organizationId },
      select: {
        planName: true,
        amount: true,
        endAt: true,
        paymentMethod: true,
        plan: { select: { name: true, interval: true } },
      },
    });
    if (!sub) return [];

    const rows = [];
    const planName = sub.plan?.name || sub.planName;
    if (planName) {
      rows.push(["Plan", sub.plan?.interval ? `${planName} (${sub.plan.interval.toLowerCase()})` : planName]);
    }
    // `amount` is the plan's TAX-EXCLUSIVE price — never show it as the total.
    // Japan adds 10% consumption tax on top, so itemise what was actually paid.
    if (typeof sub.amount === "number" && Number.isFinite(sub.amount)) {
      const money = withTax(sub.amount);
      rows.push(["Subtotal", formatJpy(money.subtotal)]);
      rows.push([`Consumption tax (${money.taxPercent}%)`, formatJpy(money.taxAmount)]);
      rows.push(["Total", formatJpy(money.totalAmount)]);
    }
    if (sub.paymentMethod) {
      rows.push(["Payment method", PAYMENT_METHOD_LABEL[sub.paymentMethod] || sub.paymentMethod]);
    }
    const until = formatDay(sub.endAt);
    if (until) rows.push(["Access until", until]);
    return rows;
  } catch (err) {
    console.error("[stripe] billing details failed:", err.message);
    return [];
  }
};

/** Email the org's admins about a billing event. Best-effort. */
const notifyAdmins = async (organizationId, title, message) => {
  try {
    const [admins, details] = await Promise.all([
      prisma.user.findMany({
        where: { organizationId, role: "NPO_ADMIN", isDeleted: false, status: true },
        select: { id: true, email: true },
      }),
      billingDetails(organizationId),
    ]);

    const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

    await Promise.allSettled(
      admins.map((a) =>
        notificationService.notify({
          userId: a.id,
          organizationId,
          title,
          message,
          type: "BILLING",
          email: a.email,
          emailData: {
            details,
            ...(frontendUrl
              ? { actionUrl: `${frontendUrl}/billing`, actionText: "Manage billing" }
              : {}),
          },
        }),
      ),
    );
  } catch (err) {
    console.error("[stripe] admin notify failed:", err.message);
  }
};

/**
 * Mark a period paid: set the subscription ACTIVE and write the immutable invoice.
 *
 * EXACTLY-ONCE. Three different callers can fire for the same payment — the
 * Stripe webhook, a Stripe webhook *retry*, and the success-redirect fallback
 * (confirmSession) when webhooks aren't reachable. A check-then-insert would
 * race between them, so the real guard is the DB: `Invoice.paymentRef` is
 * UNIQUE, both writes happen in one transaction, and the loser gets P2002 and
 * rolls back with zero side effects. The cheap pre-check below is just a fast
 * path to avoid doing the work at all in the common duplicate case.
 */
const activatePeriod = async ({
  organizationId,
  planId,
  paymentMethod,
  stripeSubscriptionId = null,
  stripeSessionId = null,
  stripePaymentIntentId = null,
  periodStartMs,
  periodEndMs,
}) => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const paymentRef = stripePaymentIntentId || stripeSubscriptionId || stripeSessionId;

  // Idempotency guard — a duplicate webhook must not double-bill.
  if (paymentRef) {
    const seen = await prisma.invoice.findFirst({
      where: { organizationId, paymentRef, status: "PAID" },
      select: { id: true },
    });
    if (seen) return { duplicate: true };
  }

  const now = BigInt(Date.now());
  const startAt = BigInt(periodStartMs ?? Date.now());
  const endAt = BigInt(periodEndMs ?? Date.now() + plan.durationDays * DAY_MS);
  const money = withTax(plan.price);

  const subFields = {
    planId: plan.id,
    planName: plan.name,
    amount: plan.price,
    status: "ACTIVE",
    startAt,
    endAt,
    isTrial: false,
    paymentMethod,
    // Konbini / bank transfer can't be charged automatically — the customer
    // must come back and pay again, so never leave autoRenew on for them.
    autoRenew: canAutoRenew(paymentMethod),
    cancelAtPeriodEnd: false,
    stripeSubscriptionId,
    stripeSessionId,
    paymentRef,
    // A fresh paid period resolves any auto-upgrade restriction / provisional state.
    autoUpgradeBlockedAt: null,
    provisionalPlanId: null,
    previousPlanId: null,
    provisionalUntil: null,
    provisionalInvoiceRef: null,
  };

  let subscription;
  try {
    subscription = await prisma.$transaction(async (tx) => {
      const sub = await tx.organizationSubscription.upsert({
        where: { organizationId },
        update: { ...subFields, updatedAt: now },
        create: { organizationId, ...subFields, createdAt: now, updatedAt: now },
      });

      // The UNIQUE paymentRef makes this the exactly-once gate: a concurrent
      // webhook + redirect-fallback pair both reach here, one wins, the other
      // throws P2002 and the whole transaction (including the upsert) rolls back.
      await tx.invoice.create({
        data: {
          organizationId,
          subscriptionId: sub.id,
          number: invoiceNumber(),
          planName: plan.name,
          amount: money.subtotal,
          taxAmount: money.taxAmount,
          taxPercent: money.taxPercent,
          totalAmount: money.totalAmount,
          currency: plan.currency || "JPY",
          status: "PAID",
          paymentRef,
          stripePaymentIntentId,
          paymentMethod,
          periodStart: startAt,
          periodEnd: endAt,
          createdAt: now,
        },
      });

      return sub;
    });
  } catch (err) {
    // P2002 = unique violation on paymentRef → someone else already activated
    // this exact payment. Not an error: the period is booked, just not by us.
    if (err.code === "P2002") return { duplicate: true };
    throw err;
  }

  // An expired org is reactivated by a successful payment.
  await prisma.organization
    .update({ where: { id: organizationId }, data: { status: "ACTIVE" } })
    .catch(() => {});

  return { subscription };
};

/** Park the subscription until an async (konbini/furikomi) payment lands. */
const markPendingPayment = async ({ organizationId, planId, paymentMethod, stripeSessionId }) => {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan) return;
  const now = BigInt(Date.now());

  const existing = await prisma.organizationSubscription.findUnique({
    where: { organizationId },
    select: { status: true },
  });
  // Don't knock a currently-ACTIVE subscription out of service just because the
  // admin started a konbini checkout for the next period.
  if (existing && existing.status === "ACTIVE") return;

  await prisma.organizationSubscription.upsert({
    where: { organizationId },
    update: {
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      status: "PENDING_PAYMENT",
      paymentMethod,
      stripeSessionId,
      autoRenew: false,
      updatedAt: now,
    },
    create: {
      organizationId,
      planId: plan.id,
      planName: plan.name,
      amount: plan.price,
      status: "PENDING_PAYMENT",
      paymentMethod,
      stripeSessionId,
      autoRenew: false,
      startAt: now,
      endAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
};

const webhookService = {
  /** Verify the signature and return the parsed Stripe event. Throws if invalid. */
  constructEvent: (rawBody, signature) => {
    const stripe = assertStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    return stripe.webhooks.constructEvent(rawBody, signature, secret);
  },

  handleEvent: async (event) => {
    const obj = event.data.object;

    switch (event.type) {
      // ── Checkout finished ────────────────────────────────────────────────
      case "checkout.session.completed": {
        const md = obj.metadata || {};
        if (!md.organizationId || !md.planId) break;

        // Konbini / bank transfer: the customer left with a voucher and hasn't
        // paid yet (payment_status = "unpaid"). Park it; the async_payment_*
        // event decides the outcome.
        if (obj.payment_status !== "paid") {
          await markPendingPayment({
            organizationId: md.organizationId,
            planId: md.planId,
            paymentMethod: md.paymentMethod,
            stripeSessionId: obj.id,
          });
          await notifyAdmins(
            md.organizationId,
            "Payment pending",
            "Your subscription will activate as soon as we receive your payment. " +
              "Please complete it at the convenience store / by bank transfer using the instructions from Stripe.",
          );
          break;
        }

        await activatePeriod({
          organizationId: md.organizationId,
          planId: md.planId,
          paymentMethod: md.paymentMethod || "CARD",
          stripeSubscriptionId: obj.subscription || null,
          stripeSessionId: obj.id,
          stripePaymentIntentId: obj.payment_intent || null,
        });
        await notifyAdmins(md.organizationId, "Subscription active", "Your payment succeeded — your subscription is now active.");
        break;
      }

      // ── Konbini / bank transfer actually paid (can be days later) ─────────
      case "checkout.session.async_payment_succeeded": {
        const md = obj.metadata || {};
        if (!md.organizationId) break;
        // A prorated auto-upgrade top-up is NOT a new billing period — it only
        // locks the provisional plan upgrade in (clears the 3-day grace). Do not
        // re-activate the period for it.
        if (md.type === "auto_upgrade_proration") {
          await autoUpgradeService.confirmProvisionalPayment(md.organizationId).catch(() => {});
          await notifyAdmins(md.organizationId, "Upgrade payment received", "Your plan upgrade is now confirmed.");
          break;
        }
        if (!md.planId) break;
        await activatePeriod({
          organizationId: md.organizationId,
          planId: md.planId,
          paymentMethod: md.paymentMethod || "KONBINI",
          stripeSessionId: obj.id,
          stripePaymentIntentId: obj.payment_intent || null,
        });
        await notifyAdmins(md.organizationId, "Payment received", "We received your payment — your subscription is now active.");
        break;
      }

      case "checkout.session.async_payment_failed": {
        const md = obj.metadata || {};
        if (!md.organizationId) break;
        await prisma.organizationSubscription.updateMany({
          where: { organizationId: md.organizationId, status: "PENDING_PAYMENT" },
          data: { status: "EXPIRED", updatedAt: BigInt(Date.now()) },
        });
        await notifyAdmins(md.organizationId, "Payment failed", "Your payment was not completed in time. Please start the checkout again.");
        break;
      }

      // ── Card subscription renewed ────────────────────────────────────────
      case "invoice.paid": {
        const subId = obj.subscription;
        if (!subId) break;
        const sub = await prisma.organizationSubscription.findFirst({
          where: { stripeSubscriptionId: subId },
          select: { organizationId: true, planId: true },
        });
        if (!sub) break;

        const line = obj.lines?.data?.[0];
        await activatePeriod({
          organizationId: sub.organizationId,
          planId: sub.planId,
          paymentMethod: "CARD",
          stripeSubscriptionId: subId,
          stripePaymentIntentId: obj.payment_intent || obj.id,
          periodStartMs: line?.period?.start ? line.period.start * 1000 : undefined,
          periodEndMs: line?.period?.end ? line.period.end * 1000 : undefined,
        });
        break;
      }

      case "invoice.payment_failed": {
        const subId = obj.subscription;
        if (!subId) break;
        const sub = await prisma.organizationSubscription.findFirst({
          where: { stripeSubscriptionId: subId },
          select: { organizationId: true },
        });
        if (!sub) break;
        await prisma.organizationSubscription.updateMany({
          where: { organizationId: sub.organizationId },
          data: { status: "PAST_DUE", updatedAt: BigInt(Date.now()) },
        });
        await notifyAdmins(sub.organizationId, "Payment failed", "We couldn't charge your card. Please update your payment method to keep your access.");
        break;
      }

      // ── Card subscription cancelled at Stripe ────────────────────────────
      case "customer.subscription.deleted": {
        const sub = await prisma.organizationSubscription.findFirst({
          where: { stripeSubscriptionId: obj.id },
          select: { organizationId: true },
        });
        if (!sub) break;
        await prisma.organizationSubscription.updateMany({
          where: { organizationId: sub.organizationId },
          data: { status: "CANCELLED", autoRenew: false, updatedAt: BigInt(Date.now()) },
        });
        await notifyAdmins(sub.organizationId, "Subscription cancelled", "Your subscription has been cancelled. Access continues until the end of the paid period.");
        break;
      }

      default:
        break; // ignore everything else
    }

    return { handled: true, type: event.type };
  },
};

module.exports = webhookService;
// Shared with payment.service's confirmSession() so the webhook path and the
// success-redirect fallback activate a period through the exact same code.
module.exports.activatePeriod = activatePeriod;
module.exports.markPendingPayment = markPendingPayment;
module.exports.notifyAdmins = notifyAdmins;
