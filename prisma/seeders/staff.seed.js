const { now, hashPw, getOrg } = require("./_shared");

// NPO admin + coordinator + staff (driver, support, nurse)
module.exports = async function seedStaff(prisma) {
  const t = now();
  const pw = await hashPw();
  const org = await getOrg(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const role = (id) => prisma.staffRole.findUnique({ where: { id } });
  const [driverRole, supportRole, coordinatorRole, nurseRole] = await Promise.all([
    role("role-driver-001"),
    role("role-support-001"),
    role("role-coordinator-001"),
    role("role-nurse-001"),
  ]);

  const users = [
    { fullName: "NPO Admin", email: "admin@gmail.com", role: "NPO_ADMIN", phone: "9111111111", designationId: null, serviceType: null },
    { fullName: "Sam Coordinator", email: "coordinator@gmail.com", role: "COORDINATOR", phone: "9222222222", designationId: coordinatorRole?.id, serviceType: null },
    { fullName: "Mike Driver", email: "driver@gmail.com", role: "STAFF", phone: "9333333333", designationId: driverRole?.id, serviceType: "MOBILITY" },
    { fullName: "Jane Support", email: "staff@gmail.com", role: "STAFF", phone: "9444444444", designationId: supportRole?.id, serviceType: null },
    { fullName: "Dr. Priya Nurse", email: "nurse@gmail.com", role: "STAFF", phone: "9555555555", designationId: nurseRole?.id, serviceType: "DAYCARE" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        ...u,
        password: pw,
        organizationId: org.id,
        dateOfJoining: t,
        status: true,
        emailVerifiedAt: t,
        createdAt: t,
        updatedAt: t,
      },
    });
  }
  console.log("✅ Staff users   → admin, coordinator, driver, support, nurse");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
