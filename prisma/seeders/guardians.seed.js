const { now, hashPw, getOrg } = require("./_shared");

// Guardian users
module.exports = async function seedGuardians(prisma) {
  const t = now();
  const pw = await hashPw();
  const org = await getOrg(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const guardians = [
    { fullName: "David Guardian", email: "guardian@gmail.com", phone: "9666666666", alternatePhone: "9666666677", relationshipType: "Parent", city: "Melbourne", state: "Victoria", postalCode: "3001" },
    { fullName: "Sarah Guardian", email: "guardian2@gmail.com", phone: "9777777777", alternatePhone: "9777777788", relationshipType: "Sibling", city: "Sydney", state: "New South Wales", postalCode: "2000" },
  ];
  for (const g of guardians) {
    await prisma.user.upsert({
      where: { email: g.email },
      update: {},
      create: {
        ...g,
        password: pw,
        role: "GUARDIAN",
        organizationId: org.id,
        country: "Australia",
        status: true,
        emailVerifiedAt: t,
        createdAt: t,
        updatedAt: t,
      },
    });
  }
  console.log("✅ Guardians     → David, Sarah");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
