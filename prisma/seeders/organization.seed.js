const { now, ORG_CODE, PLAN_ID, getSuperAdmin } = require("./_shared");

// Organization "Sunrise Care NPO" + its active subscription
module.exports = async function seedOrganization(prisma) {
  const t = now();
  const org = await prisma.organization.upsert({
    where: { code: ORG_CODE },
    update: {},
    create: {
      name: "Sunrise Care NPO",
      code: ORG_CODE,
      email: "contact@sunrisecnpo.org",
      phone: "9100000000",
      address: "45 Sunrise Avenue",
      city: "Melbourne",
      state: "Victoria",
      country: "Australia",
      postalCode: "3000",
      status: "ACTIVE",
      createdAt: t,
      updatedAt: t,
    },
  });

  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: PLAN_ID } });
  const superAdmin = await getSuperAdmin(prisma);
  const existing = await prisma.organizationSubscription.findFirst({ where: { organizationId: org.id } });
  if (!existing && plan) {
    await prisma.organizationSubscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        planName: plan.name,
        amount: plan.price,
        isTrial: false,
        paymentRef: "SEED-INIT",
        createdBy: superAdmin?.id || null,
        startAt: t,
        endAt: t + BigInt(365 * 24 * 60 * 60 * 1000),
        status: "ACTIVE",
        createdAt: t,
        updatedAt: t,
      },
    });
  }
  console.log("✅ Organization  →", org.name, `(${org.code}) + subscription`);
  return org;
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
