const prisma = require("../../config/db");

const {
  validateCreatePlan,
  validateUpdatePlan
} = require("./subscriptionPlan.validation");

// Whitelist + coerce plan fields — never spread the raw request body into
// Prisma (mass-assignment / wrong types straight to the DB).
const PLAN_NUM_FIELDS = ["durationDays", "price", "maxUsers", "maxParticipants"];
const PLAN_STR_FIELDS = ["name", "nameJa", "currency"];
const PLAN_BOOL_FIELDS = ["isActive", "isRecommended"];
const PLAN_INTERVALS = ["MONTHLY", "YEARLY"];
const pickPlanData = (data) => {
  const out = {};
  for (const k of PLAN_STR_FIELDS) {
    if (data[k] !== undefined) out[k] = data[k] === null ? null : String(data[k]);
  }
  // Enum — only ever accept a known value (a bad string would 500 in Prisma).
  if (data.interval !== undefined) {
    const iv = String(data.interval).toUpperCase();
    if (!PLAN_INTERVALS.includes(iv)) throw new Error("interval must be MONTHLY or YEARLY");
    out.interval = iv;
  }
  for (const k of PLAN_NUM_FIELDS) {
    if (data[k] === undefined) continue;
    out[k] = data[k] === null ? null : Number(data[k]);
  }
  for (const k of PLAN_BOOL_FIELDS) {
    if (data[k] !== undefined) out[k] = !!data[k];
  }
  if (Array.isArray(data.features)) {
    out.features = data.features.map((f) => String(f)).slice(0, 20);
  }
  return out;
};

// Japanese consumption tax. Plan prices are stored TAX-EXCLUSIVE; the tax is
// added on top at checkout and shown on the invoice/receipt.
const TAX_PERCENT = 10;

const subscriptionPlanService = {
  /**
   * Public (unauthenticated) plan list for the landing page. Active plans only,
   * marketing-safe fields only, with the tax-inclusive figure precomputed so
   * the UI never has to know the tax rule.
   */
  getPublicPlans: async () => {
    // Custom is an auto-assigned per-head plan (71+ participants) — never a
    // self-serve card on the pricing page.
    const plans = await prisma.subscriptionPlan.findMany({
      where: { isActive: true, isCustom: false },
      select: {
        id: true,
        name: true,
        nameJa: true,
        interval: true,
        durationDays: true,
        price: true,
        currency: true,
        maxUsers: true,
        maxParticipants: true,
        features: true,
        isRecommended: true,
      },
      orderBy: [{ interval: "asc" }, { price: "asc" }],
    });

    return {
      taxPercent: TAX_PERCENT,
      plans: plans.map((p) => ({
        ...p,
        // JPY is a zero-decimal currency — round, never show fractional yen.
        priceWithTax: Math.round(p.price * (1 + TAX_PERCENT / 100)),
      })),
    };
  },

  createPlan: async (data) => {
    validateCreatePlan(data);

    return await prisma.subscriptionPlan.create({
      data: {
        ...pickPlanData(data),
        createdAt: BigInt(Date.now()),
        updatedAt: BigInt(Date.now())
      }
    });
  },

  getPlans: async () => {
    return await prisma.subscriptionPlan.findMany({
      where: { isActive: true }
    });
  },

  getPlanById: async (id) => {
    return await prisma.subscriptionPlan.findUnique({
      where: { id }
    });
  },

  updatePlan: async (id, data) => {
    validateUpdatePlan(data);

    return await prisma.subscriptionPlan.update({
      where: { id },
      data: {
        ...pickPlanData(data),
        updatedAt: BigInt(Date.now())
      }
    });
  },

  deletePlan: async (id) => {
    return await prisma.subscriptionPlan.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: BigInt(Date.now())
      }
    });
  }
};

module.exports = subscriptionPlanService;