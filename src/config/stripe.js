const Stripe = require("stripe");

// Stripe client singleton. Absent keys are NOT fatal at boot (the rest of the
// app must still run in dev/test); every payment path calls assertStripe()
// first and fails with a clear message instead of a cryptic Stripe error.
const SECRET = process.env.STRIPE_SECRET_KEY;

// No apiVersion pin — use the account's default so we don't silently run an
// outdated API surface as the SDK moves forward.
const stripe = SECRET ? new Stripe(SECRET) : null;

const isStripeEnabled = () => Boolean(stripe);

const assertStripe = () => {
  if (!stripe) {
    throw new Error("Payments are not configured (STRIPE_SECRET_KEY is missing)");
  }
  return stripe;
};

// Japan: 10% consumption tax, and plan prices are stored TAX-EXCLUSIVE.
const TAX_PERCENT = 10;

// JPY is a zero-decimal currency — Stripe expects whole yen, never *100.
const ZERO_DECIMAL = ["JPY", "KRW", "VND", "CLP", "ISK", "BIF", "DJF", "GNF", "KMF", "MGA", "PYG", "RWF", "UGX", "VUV", "XAF", "XOF", "XPF"];

const toStripeAmount = (amount, currency = "JPY") => {
  const cur = String(currency).toUpperCase();
  const n = Number(amount) || 0;
  return ZERO_DECIMAL.includes(cur) ? Math.round(n) : Math.round(n * 100);
};

const fromStripeAmount = (amount, currency = "JPY") => {
  const cur = String(currency).toUpperCase();
  const n = Number(amount) || 0;
  return ZERO_DECIMAL.includes(cur) ? n : n / 100;
};

/** Net → { tax, total } for a tax-exclusive price. */
const withTax = (net) => {
  const subtotal = Math.round(Number(net) || 0);
  const taxAmount = Math.round(subtotal * (TAX_PERCENT / 100));
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount, taxPercent: TAX_PERCENT };
};

module.exports = {
  stripe,
  isStripeEnabled,
  assertStripe,
  toStripeAmount,
  fromStripeAmount,
  withTax,
  TAX_PERCENT,
};
