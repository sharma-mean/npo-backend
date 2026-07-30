const { now, PLAN_ID } = require("./_shared");

// Client-specified plans: participant-based, JPY, prices are TAX-EXCLUSIVE
// (10% Japanese consumption tax is added on top at checkout).
//   Basic ¥29,800 (10) / Professional ¥59,800 (30, recommended) / Enterprise ¥99,800 (70)
// Yearly = monthly × 12 with NO discount (client's explicit instruction).
// Fixed ids reuse the legacy rows so existing subscriptions keep their FK.
const TIERS = [
  {
    id: PLAN_ID,
    yearlyId: "plan-basic-yearly",
    name: "Basic",
    nameJa: "ベーシック",
    monthly: 29800,
    maxUsers: 15,
    maxParticipants: 10,
    isRecommended: false,
    features: [
      "Up to 10 participants / 最大10名の利用者",
      "All 3 service types / 全3サービス対応",
      "Basic reporting / 基本レポート",
      "Email support / メールサポート",
      "Mobile app access / モバイルアプリ",
    ],
  },
  {
    id: "plan-monthly-001",
    yearlyId: "plan-professional-yearly",
    name: "Professional",
    nameJa: "プロフェッショナル",
    monthly: 59800,
    maxUsers: 50,
    maxParticipants: 30,
    isRecommended: true,
    features: [
      "Up to 30 participants / 最大30名の利用者",
      "All 3 service types / 全3サービス対応",
      "Advanced analytics / 高度な分析機能",
      "Priority support / 優先サポート",
      "Custom branding / カスタムブランディング",
      "API access / API連携",
    ],
  },
  {
    id: "plan-yearly-001",
    yearlyId: "plan-enterprise-yearly",
    name: "Enterprise",
    nameJa: "エンタープライズ",
    monthly: 99800,
    maxUsers: 200,
    maxParticipants: 70,
    isRecommended: false,
    features: [
      "Up to 100 participants / 最大100名の利用者",
      "All 3 service types / 全3サービス対応",
      "Enterprise analytics / エンタープライズ分析",
      "Dedicated support / 専任サポート",
      "White-label option / ホワイトラベル",
      "SLA guarantee / SLA保証",
      "Custom integrations / カスタム連携",
    ],
  },
];

module.exports = async function seedPlans(prisma) {
  const t = now();

  const plans = TIERS.flatMap((tier) => {
    const base = {
      name: tier.name,
      nameJa: tier.nameJa,
      currency: "JPY",
      maxUsers: tier.maxUsers,
      maxParticipants: tier.maxParticipants,
      isRecommended: tier.isRecommended,
      features: tier.features,
    };
    return [
      { id: tier.id, ...base, interval: "MONTHLY", durationDays: 30, price: tier.monthly },
      // No yearly discount — exactly 12 × the monthly price.
      { id: tier.yearlyId, ...base, interval: "YEARLY", durationDays: 365, price: tier.monthly * 12 },
    ];
  });

  for (const p of plans) {
    const { id, ...data } = p;
    await prisma.subscriptionPlan.upsert({
      where: { id },
      update: { ...data, isActive: true, updatedAt: t },
      create: { id, ...data, isActive: true, createdAt: t, updatedAt: t },
    });
  }

  console.log(
    "✅ Plans         → Basic ¥29,800 / Professional ¥59,800 / Enterprise ¥99,800 per month " +
      "(+ yearly = ×12, no discount). Prices are tax-exclusive (+10%).",
  );
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
