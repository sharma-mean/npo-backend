const { now, getOrg } = require("./_shared");

// Service offerings (Mobility, Recreation, Daycare)
module.exports = async function seedServices(prisma) {
  const t = now();
  const org = await getOrg(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const defs = [
    { category: "MOBILITY", serviceName: "Mobility Transport", defaultCapacity: 10, durationMinutes: 60, description: "Door-to-door transport for participants with mobility needs", requiresTransport: true },
    { category: "RECREATION", serviceName: "Recreation Program", defaultCapacity: 20, durationMinutes: 120, description: "Group recreational activities and social programs", requiresTransport: false },
    { category: "DAYCARE", serviceName: "Daycare Support", defaultCapacity: 15, durationMinutes: 480, description: "Full-day structured care and activity program", requiresTransport: false },
  ];
  for (const d of defs) {
    const exists = await prisma.service.findFirst({ where: { organizationId: org.id, category: d.category } });
    if (!exists) {
      await prisma.service.create({
        data: { ...d, organizationId: org.id, requiresStaff: true, status: true, createdAt: t, updatedAt: t },
      });
    }
  }
  console.log("✅ Services      → Mobility, Recreation, Daycare");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
