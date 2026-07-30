const { now, getOrg, getAdmin } = require("./_shared");

// Sample operational data: booking + staff assignment + service slot + availability + incident
module.exports = async function seedOperations(prisma) {
  const t = now();
  const org = await getOrg(prisma);
  const admin = await getAdmin(prisma);
  if (!org) throw new Error("Run organization seeder first");

  const byEmail = (e) => prisma.user.findUnique({ where: { email: e } });
  const [guardian1, participant1, driver, support] = await Promise.all([
    byEmail("guardian@gmail.com"),
    byEmail("participant@gmail.com"),
    byEmail("driver@gmail.com"),
    byEmail("staff@gmail.com"),
  ]);
  const venue1 = await prisma.venue.findUnique({ where: { id: "venue-seed-001" } });
  const vehicle1 = await prisma.vehicle.findFirst({ where: { organizationId: org.id, vehicleNumber: "VIC-001-ABC" } });
  if (!guardian1 || !participant1) throw new Error("Run guardians + participants seeders first");

  // Booking (PENDING)
  const bookingDate = t + BigInt(2 * 24 * 60 * 60 * 1000);
  const startTime = bookingDate + BigInt(9 * 60 * 60 * 1000);
  const endTime = startTime + BigInt(2 * 60 * 60 * 1000);
  let booking = await prisma.booking.findFirst({ where: { guardianId: guardian1.id, participantId: participant1.id } });
  if (!booking) {
    const seq = await prisma.organization.update({
      where: { id: org.id }, data: { bookingSeq: { increment: 1 } }, select: { bookingSeq: true },
    });
    booking = await prisma.booking.create({
      data: {
        organizationId: org.id, bookingCode: `BK${String(seq.bookingSeq).padStart(4, "0")}`,
        participantId: participant1.id, guardianId: guardian1.id, serviceType: "MOBILITY",
        venueId: venue1?.id || null, vehicleId: vehicle1?.id || null, bookingDate, startTime, endTime,
        requiredSeats: 1, participantCount: 1, purpose: "Weekly mobility session", notes: "Wheelchair accessible vehicle required",
        status: "PENDING", createdAt: t, updatedAt: t,
      },
    });
  }

  // Staff assignment
  if (booking && driver) {
    const exists = await prisma.bookingStaffAssignment.findFirst({ where: { bookingId: booking.id, userId: driver.id } });
    if (!exists) {
      await prisma.bookingStaffAssignment.create({
        data: { bookingId: booking.id, userId: driver.id, organizationId: org.id, assignmentRole: "DRIVER", status: "ASSIGNED", assignedBy: admin?.id || null, assignedAt: t, createdAt: t, updatedAt: t },
      });
    }
  }

  // Future scheduled slots for EVERY service so guardians can pick a slot in the
  // demo (previously only Recreation had one). Three upcoming days per service.
  const DAY = BigInt(24 * 60 * 60 * 1000);
  const services = await prisma.service.findMany({ where: { organizationId: org.id } });
  for (const svc of services) {
    for (let d = 2; d <= 4; d++) {
      const slotDate = t + BigInt(d) * DAY;
      const startTime = slotDate + BigInt(10 * 60 * 60 * 1000); // 10:00
      const exists = await prisma.serviceSlot.findFirst({
        where: { serviceId: svc.id, startTime },
      });
      if (!exists) {
        await prisma.serviceSlot.create({
          data: {
            organizationId: org.id, serviceId: svc.id, venueId: venue1?.id || null,
            serviceType: svc.category, slotDate, startTime,
            endTime: startTime + BigInt(2 * 60 * 60 * 1000), capacity: 5, bookedCount: 0,
            notes: "Morning Batch", createdBy: admin?.id || null, createdAt: t, updatedAt: t,
          },
        });
      }
    }
  }

  // Staff availability (unavailable window)
  if (support) {
    const exists = await prisma.staffAvailability.findFirst({ where: { userId: support.id } });
    if (!exists) {
      const s = t + BigInt(24 * 60 * 60 * 1000);
      await prisma.staffAvailability.create({
        data: { organizationId: org.id, userId: support.id, startTime: s, endTime: s + BigInt(8 * 60 * 60 * 1000), reason: "Annual leave", createdAt: t, updatedAt: t },
      });
    }
  }

  // Incident
  if (booking && driver) {
    const exists = await prisma.incident.findFirst({ where: { organizationId: org.id } });
    if (!exists) {
      await prisma.incident.create({
        data: { organizationId: org.id, bookingId: booking.id, reportedBy: driver.id, type: "DELAY", severity: "MEDIUM", status: "OPEN", title: "Vehicle running 20 min late", description: "Traffic on pickup route", createdAt: t, updatedAt: t },
      });
    }
  }

  console.log("✅ Operations    → booking, assignment, slot, availability, incident");
};

if (require.main === module) {
  require("dotenv").config();
  const prisma = require("../../src/config/db");
  module.exports(prisma).finally(() => prisma.$disconnect());
}
