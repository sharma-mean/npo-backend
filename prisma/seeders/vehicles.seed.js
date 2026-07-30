const { now, getOrg, getAdmin } = require("./_shared");

// Fleet vehicles
module.exports = async function seedVehicles(prisma) {
  const t = now();
  const org = await getOrg(prisma);
  const admin = await getAdmin(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const vehicles = [
    {
      vehicleNumber: "VIC-001-ABC", serviceType: "MOBILITY", vehicleName: "Toyota HiAce", vehicleType: "Van",
      capacity: 12, wheelchairCapacity: 2, wheelchairAccessible: true, GPSId: "GPS-001",
      equipmentDetails: ["Wheelchair ramp", "Seatbelt harness", "First aid kit"], Notes: "Primary mobility transport",
    },
    {
      vehicleNumber: "NSW-002-XYZ", serviceType: null, vehicleName: "Ford Transit", vehicleType: "Minibus",
      capacity: 15, wheelchairCapacity: 0, wheelchairAccessible: false, GPSId: "GPS-002",
      equipmentDetails: ["Air conditioning", "First aid kit"], Notes: "General purpose transport",
    },
  ];
  for (const v of vehicles) {
    await prisma.vehicle.upsert({
      where: { organizationId_vehicleNumber: { organizationId: org.id, vehicleNumber: v.vehicleNumber } },
      update: {},
      create: { ...v, organizationId: org.id, createdBy: admin?.id || null, status: true, createdAt: t, updatedAt: t },
    });
  }
  console.log("✅ Vehicles      → Toyota HiAce, Ford Transit");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
