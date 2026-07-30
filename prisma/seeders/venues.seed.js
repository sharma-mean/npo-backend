const { now, getOrg, getAdmin } = require("./_shared");

// Venues
module.exports = async function seedVenues(prisma) {
  const t = now();
  const org = await getOrg(prisma);
  const admin = await getAdmin(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const venues = [
    { id: "venue-seed-001", name: "Sunrise Main Hall", address: "45 Sunrise Avenue, Melbourne VIC 3000", capacity: 50, availableCapacity: 50, serviceType: "RECREATION", contactPerson: "John Manager", contactPhone: "9100000011" },
    { id: "venue-seed-002", name: "Daycare Activity Room", address: "45 Sunrise Avenue, Room B, Melbourne VIC 3000", capacity: 20, availableCapacity: 20, serviceType: "DAYCARE", contactPerson: "Lisa Coordinator", contactPhone: "9100000022" },
  ];
  for (const v of venues) {
    await prisma.venue.upsert({
      where: { id: v.id },
      update: {},
      create: { ...v, organizationId: org.id, isOccupied: false, status: true, createdBy: admin?.id || null, createdAt: t, updatedAt: t },
    });
  }
  console.log("✅ Venues        → Sunrise Main Hall, Daycare Activity Room");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
