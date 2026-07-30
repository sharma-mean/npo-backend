const prisma = require("../../config/db");
const {
  assertStripe,
  toStripeAmount,
  withTax,
  TAX_PERCENT,
} = require("../../config/stripe");
// The webhook owns the activation logic; the redirect fallback reuses it so
// both paths behave identically (and share the exactly-once paymentRef gate).
const { activatePeriod, markPendingPayment } = require("./webhook.service");

// Only CARD can auto-renew. Konbini and bank transfer are *push* methods — the
// customer actively pays each period — so Stripe cannot charge them on a
// schedule. Those checkouts are one-off payments and autoRenew is forced false.
const RECURRING_METHODS = ["CARD"];
const ASYNC_METHODS = ["KONBINI", "BANK_TRANSFER"];
const ALL_METHODS = [...RECURRING_METHODS, ...ASYNC_METHODS];

// Our enum → Stripe's payment_method_types values.
const STRIPE_METHOD = {
  CARD: "card",
  KONBINI: "konbini",
  BANK_TRANSFER: "customer_balance",
};

const FRONTEND_URL = () => process.env.FRONTEND_URL || "http://localhost:5173";

/** Reuse (or lazily create) the org's Stripe Customer. */
const ensureCustomer = async (organizationId) => {
  const stripe = assertStripe();
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, email: true, stripeCustomerId: true },
  });
  if (!org) throw new Error("Organization not found");
  if (org.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripe.customers.create({
    name: org.name,
    email: org.email || undefined,
    metadata: { organizationId: org.id },
  });
  await prisma.organization.update({
    where: { id: org.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
};

/**
 * Reuse (or lazily create) the Stripe Price mirroring a plan. Stripe Prices are
 * immutable, so if the plan's amount changed since we cached the id we mint a
 * fresh Price and re-cache — existing subscriptions keep billing on the old one.
 */
const ensureStripePrice = async (plan) => {
  const stripe = assertStripe();
  const currency = String(plan.currency || "JPY").toLowerCase();
  const unitAmount = toStripeAmount(plan.price, plan.currency);

  if (plan.stripePriceId) {
    try {
      const existing = await stripe.prices.retrieve(plan.stripePriceId);
      if (existing.active && existing.unit_amount === unitAmount && existing.currency === currency) {
        return plan.stripePriceId;
      }
    } catch {
      /* cached id is stale/deleted → fall through and create a new one */
    }
  }

  let productId = plan.stripeProductId;
  if (!productId) {
    const product = await stripe.products.create({
      name: `SHINY-SOMS ${plan.name}`,
      metadata: { planId: plan.id },
    });
    productId = product.id;
  }

  const price = await stripe.prices.create({
    product: productId,
    currency,
    unit_amount: unitAmount,
    // Tax-exclusive: Stripe adds the 10% tax rate on top at checkout.
    tax_behavior: "exclusive",
    recurring: { interval: plan.interval === "YEARLY" ? "year" : "month" },
    metadata: { planId: plan.id, interval: plan.interval },
  });

  await prisma.subscriptionPlan.update({
    where: { id: plan.id },
    data: { stripeProductId: productId, stripePriceId: price.id },
  });
  return price.id;
};

/** Reuse (or lazily create) the 10% Japanese consumption tax rate. */
let _taxRateId = null;
const ensureTaxRate = async () => {
  const stripe = assertStripe();
  if (_taxRateId) return _taxRateId;

  const existing = await stripe.taxRates.list({ active: true, limit: 100 });
  const found = existing.data.find(
    (r) => r.percentage === TAX_PERCENT && r.inclusive === false && r.country === "JP",
  );
  if (found) {
    _taxRateId = found.id;
    return _taxRateId;
  }

  const rate = await stripe.taxRates.create({
    display_name: "Consumption Tax",
    description: "Japanese consumption tax (消費税)",
    jurisdiction: "JP",
    country: "JP",
    percentage: TAX_PERCENT,
    inclusive: false, // plan prices are tax-exclusive
  });
  _taxRateId = rate.id;
  return _taxRateId;
};

const paymentService = {
  RECURRING_METHODS,
  ASYNC_METHODS,
  ALL_METHODS,

  /**
   * Start a checkout. Card → a real Stripe Subscription (auto-renews).
   * Konbini / bank transfer → a one-off payment for a single period (they
   * cannot be auto-charged), so the caller must renew manually next period.
   *
   * Returns { url } — the frontend redirects the admin to Stripe's hosted page.
   */
  createCheckoutSession: async (authUser, { planId, paymentMethod = "CARD" }) => {
    const stripe = assertStripe();

    const method = String(paymentMethod).toUpperCase();
    if (!ALL_METHODS.includes(method)) {
      throw new Error("paymentMethod must be CARD, KONBINI or BANK_TRANSFER");
    }

    const plan = await prisma.subscriptionPlan.findFirst({
      where: { id: planId, isActive: true },
    });
    if (!plan) throw new Error("Plan not found");
    // The Custom plan is per-head and carries `price: 0`, so selecting it here
    // would subscribe the organization for nothing. It is never chosen by a
    // customer — `autoUpgrade` applies it automatically at 71+ participants and
    // prices it from the live headcount.
    if (plan.isCustom) {
      throw new Error(
        "The Custom plan cannot be selected directly — it is applied automatically once your organization exceeds the Enterprise participant limit."
      );
    }


    const customerId = await ensureCustomer(authUser.organizationId);
    const taxRateId = await ensureTaxRate();
    const money = withTax(plan.price);

    const base = {
      customer: customerId,
      payment_method_types: [STRIPE_METHOD[method]],
      locale: "ja",
      success_url: `${FRONTEND_URL()}/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL()}/billing?checkout=cancelled`,
      metadata: {
        organizationId: authUser.organizationId,
        planId: plan.id,
        paymentMethod: method,
        actorId: authUser.id,
      },
    };

    let session;
    if (RECURRING_METHODS.includes(method)) {
      // Card → recurring subscription on the plan's Stripe Price.
      const priceId = await ensureStripePrice(plan);
      session = await stripe.checkout.sessions.create({
        ...base,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1, tax_rates: [taxRateId] }],
        subscription_data: {
          metadata: base.metadata,
        },
      });
    } else {
      // Konbini / bank transfer → single payment covering ONE period.
      session = await stripe.checkout.sessions.create({
        ...base,
        mode: "payment",
        payment_intent_data: { metadata: base.metadata },
        ...(method === "BANK_TRANSFER"
          ? {
              payment_method_options: {
                customer_balance: {
                  funding_type: "bank_transfer",
                  bank_transfer: { type: "jp_bank_transfer" },
                },
              },
            }
          : {}),
        line_items: [
          {
            quantity: 1,
            tax_rates: [taxRateId],
            price_data: {
              currency: String(plan.currency || "JPY").toLowerCase(),
              unit_amount: toStripeAmount(plan.price, plan.currency),
              tax_behavior: "exclusive",
              product_data: {
                name: `SHINY-SOMS ${plan.name}`,
                description:
                  plan.interval === "YEARLY" ? "1 year subscription" : "1 month subscription",
              },
            },
          },
        ],
      });
    }

    return {
      url: session.url,
      sessionId: session.id,
      isAsync: ASYNC_METHODS.includes(method),
      amount: money,
    };
  },

  /**
   * FALLBACK for when the webhook never arrives (misconfigured endpoint, local
   * dev without `stripe listen`, Stripe outage). Called from the success
   * redirect with the Checkout Session id.
   *
   * It re-reads the session from Stripe (never trusts the browser), checks the
   * session really belongs to the caller's org, and then routes through the
   * SAME activatePeriod() the webhook uses — whose UNIQUE paymentRef makes the
   * write exactly-once. So if the webhook already landed, this is a safe no-op;
   * if it never lands, the payment is still captured.
   */
  confirmSession: async (authUser, sessionId) => {
    const stripe = assertStripe();
    if (!sessionId) throw new Error("sessionId is required");

    const session = await stripe.checkout.sessions.retrieve(String(sessionId));
    const md = session.metadata || {};

    // Never let one org claim another org's checkout session.
    if (md.organizationId !== authUser.organizationId) {
      throw new Error("Session not found");
    }
    if (!md.planId) throw new Error("Session is missing plan information");

    const method = md.paymentMethod || "CARD";

    // Konbini / furikomi: the customer has only received payment instructions.
    // Nothing to capture yet — park it and let the async webhook (or a later
    // confirm) activate it once the money actually arrives.
    if (session.payment_status !== "paid") {
      await markPendingPayment({
        organizationId: md.organizationId,
        planId: md.planId,
        paymentMethod: method,
        stripeSessionId: session.id,
      });
      return { status: "PENDING_PAYMENT", activated: false };
    }

    const result = await activatePeriod({
      organizationId: md.organizationId,
      planId: md.planId,
      paymentMethod: method,
      stripeSubscriptionId: session.subscription || null,
      stripeSessionId: session.id,
      stripePaymentIntentId: session.payment_intent || null,
    });

    return {
      status: "ACTIVE",
      activated: !result.duplicate, // false when the webhook had already done it
      alreadyProcessed: !!result.duplicate,
    };
  },

  /** Stripe Billing Portal — manage card, view invoices, cancel. */
  createPortalSession: async (authUser) => {
    const stripe = assertStripe();
    const customerId = await ensureCustomer(authUser.organizationId);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${FRONTEND_URL()}/billing`,
      locale: "ja",
    });
    return { url: session.url };
  },
};

module.exports = paymentService;
module.exports.ensureCustomer = ensureCustomer;
module.exports.ensureStripePrice = ensureStripePrice;
module.exports.ensureTaxRate = ensureTaxRate;
