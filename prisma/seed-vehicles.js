const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const now = BigInt(Date.now());

  const org = await prisma.organization.findFirst({
    where: { isDeleted: false },
  });

  if (!org) {
    console.error("No organization found. Run seed.js first.");
    process.exit(1);
  }

  const admin = await prisma.user.findFirst({
    where: { organizationId: org.id, role: "NPO_ADMIN" },
  });

  console.log("Adding vehicles to org:", org.name);

  const vehicles = [
    {
      serviceType: "MOBILITY",
      vehicleName: "Wheelchair Van 01",
      vehicleNumber: "DL01AB1234",
      vehicleType: "Van",
      capacity: 8,
      wheelchairCapacity: 3,
      wheelchairAccessible: true,
      equipmentDetails: ["Wheelchair Ramp", "Seat Belts", "Hand Rails"],
      Notes: "Suitable for heavy mobility support participants",
      GPSId: "GPS001",
    },
    {
      serviceType: "MOBILITY",
      vehicleName: "Mini Bus 01",
      vehicleNumber: "DL02CD5678",
      vehicleType: "Mini Bus",
      capacity: 15,
      wheelchairCapacity: 2,
      wheelchairAccessible: true,
      equipmentDetails: ["Wheelchair Lift", "AC", "First Aid Kit"],
      Notes: "Group transport for mobility program",
      GPSId: "GPS002",
    },
    {
      serviceType: "DAYCARE",
      vehicleName: "Daycare Van 01",
      vehicleNumber: "DL03EF9012",
      vehicleType: "Van",
      capacity: 10,
      wheelchairCapacity: 1,
      wheelchairAccessible: false,
      equipmentDetails: ["AC", "Child Safety Locks", "First Aid Kit"],
      Notes: "Morning and evening daycare pickup/drop",
      GPSId: "GPS003",
    },
    {
      serviceType: "RECREATION",
      vehicleName: "Activity Bus 01",
      vehicleNumber: "DL04GH3456",
      vehicleType: "Bus",
      capacity: 25,
      wheelchairCapacity: 0,
      wheelchairAccessible: false,
      equipmentDetails: ["AC", "Entertainment System", "First Aid Kit"],
      Notes: "Used for recreation outings and events",
      GPSId: "GPS004",
    },
  ];

  for (const v of vehicles) {
    const existing = await prisma.vehicle.findUnique({
      where: { vehicleNumber: v.vehicleNumber },
    });
    if (existing) {
      console.log(`Skipped (already exists): ${v.vehicleName}`);
      continue;
    }
    await prisma.vehicle.create({
      data: {
        organizationId:      org.id,
        serviceType:         v.serviceType,
        vehicleName:         v.vehicleName,
        vehicleNumber:       v.vehicleNumber,
        vehicleType:         v.vehicleType,
        capacity:            v.capacity,
        wheelchairCapacity:  v.wheelchairCapacity,
        wheelchairAccessible: v.wheelchairAccessible,
        equipmentDetails:    v.equipmentDetails,
        Notes:               v.Notes,
        GPSId:               v.GPSId,
        status:              true,
        createdBy:           admin?.id ?? null,
        createdAt:           now,
        updatedAt:           now,
      },
    });
    console.log(`Created: ${v.vehicleName} (${v.vehicleNumber}) — ${v.serviceType}`);
  }

  console.log("\nDone!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
