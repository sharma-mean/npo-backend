const { now, hashPw } = require("./_shared");

// Platform super admin (no organization)
module.exports = async function seedSuperAdmin(prisma) {
  const t = now();
  const user = await prisma.user.upsert({
    where: { email: "superadmin@gmail.com" },
    update: {},
    create: {
      fullName: "Super Admin",
      email: "superadmin@gmail.com",
      password: await hashPw(),
      role: "SUPER_ADMIN",
      phone: "9000000000",
      status: true,
      emailVerifiedAt: t,
      createdAt: t,
      updatedAt: t,
    },
  });
  console.log("✅ SUPER_ADMIN   →", user.email);
  return user;
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
