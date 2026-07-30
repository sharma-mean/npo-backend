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

  console.log("Adding services to org:", org.name);

  const services = [
    {
      category: "MOBILITY",
      serviceName: "Transport & Mobility Support",
      defaultCapacity: 10,
      durationMinutes: 60,
      description: "Door-to-door transport service for participants with mobility needs. Includes wheelchair accessible vehicles.",
      requiresTransport: true,
      requiresStaff: true,
      slotTemplates: [
        { slotType: "MORNING", startTime: "09:00", endTime: "12:00", capacity: 10 },
        { slotType: "AFTERNOON", startTime: "13:00", endTime: "16:00", capacity: 10 },
      ],
    },
    {
      category: "RECREATION",
      serviceName: "Recreation & Activities Program",
      defaultCapacity: 20,
      durationMinutes: 120,
      description: "Recreational activities including arts, crafts, sports, and social events designed for participants of all abilities.",
      requiresTransport: false,
      requiresStaff: true,
      slotTemplates: [
        { slotType: "MORNING", startTime: "10:00", endTime: "12:00", capacity: 20 },
        { slotType: "FULL_DAY", startTime: "09:00", endTime: "17:00", capacity: 20 },
      ],
    },
    {
      category: "DAYCARE",
      serviceName: "Daycare Support Service",
      defaultCapacity: 15,
      durationMinutes: 480,
      description: "Full-day supervised care and support for participants. Includes meals, therapy sessions, and skill-building activities.",
      requiresTransport: true,
      requiresStaff: true,
      slotTemplates: [
        { slotType: "FULL_DAY", startTime: "09:00", endTime: "17:00", capacity: 15 },
        { slotType: "MORNING", startTime: "09:00", endTime: "12:00", capacity: 15 },
        { slotType: "AFTERNOON", startTime: "13:00", endTime: "17:00", capacity: 15 },
      ],
    },
  ];

  for (const s of services) {
    const existing = await prisma.service.findFirst({
      where: { organizationId: org.id, serviceName: s.serviceName, isDeleted: false },
    });
    if (existing) {
      console.log(`Skipped (already exists): ${s.serviceName}`);
      continue;
    }
    await prisma.service.create({
      data: {
        organizationId: org.id,
        category:         s.category,
        serviceName:      s.serviceName,
        defaultCapacity:  s.defaultCapacity,
        durationMinutes:  s.durationMinutes,
        description:      s.description,
        requiresTransport: s.requiresTransport,
        requiresStaff:    s.requiresStaff,
        slotTemplates:    s.slotTemplates,
        status:           true,
        createdAt:        now,
        updatedAt:        now,
      },
    });
    console.log(`Created: ${s.serviceName} (${s.category})`);
  }

  console.log("\nDone!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
