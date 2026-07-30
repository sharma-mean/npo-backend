const { now, getOrg, getSuperAdmin } = require("./_shared");

// Staff role designations
module.exports = async function seedStaffRoles(prisma) {
  const t = now();
  const org = await getOrg(prisma);
  // createdBy is required; super admin exists before staff are seeded
  const creator = await getSuperAdmin(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const roles = [
    { id: "role-driver-001", name: "Driver", roleType: "DRIVER", serviceType: "MOBILITY", description: "Operates transport vehicles" },
    { id: "role-support-001", name: "Support Worker", roleType: "SUPPORT_WORKER", serviceType: null, description: "Personal care and support" },
    { id: "role-coordinator-001", name: "Coordinator", roleType: "COORDINATOR", serviceType: null, description: "Manages bookings, staff, participants" },
    { id: "role-nurse-001", name: "Nurse", roleType: "NURSE", serviceType: "DAYCARE", description: "Medical support during sessions" },
  ];
  for (const r of roles) {
    await prisma.staffRole.upsert({
      where: { id: r.id },
      update: {},
      create: {
        ...r,
        organizationId: org.id,
        createdBy: creator?.id || null,
        status: true,
        createdAt: t,
        updatedAt: t,
      },
    });
  }
  console.log("✅ Staff Roles   → Driver, Support Worker, Coordinator, Nurse");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
