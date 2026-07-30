const prisma = require("../../config/db");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Seed starter example data for a brand-new organization so the admin doesn't
 * face empty screens. Idempotent-ish: skips if the org already has the data.
 * Best-effort — callers should not fail if this throws.
 */
async function seedOrgStarterData(orgId, adminId) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) return;
  const now = BigInt(Date.now());
  const suffix = (org.code || orgId.slice(0, 6)).toUpperCase();

  // ── Staff roles ──────────────────────────────────────────────
  const roleCount = await prisma.staffRole.count({ where: { organizationId: orgId } });
  if (roleCount === 0) {
    await prisma.staffRole.createMany({
      data: [
        { name: "Driver", description: "Operates transport vehicles", roleType: "DRIVER", serviceType: "MOBILITY", organizationId: orgId, createdBy: adminId, status: true, createdAt: now, updatedAt: now },
        { name: "Support Worker", description: "Personal care and support", roleType: "SUPPORT_WORKER", serviceType: null, organizationId: orgId, createdBy: adminId, status: true, createdAt: now, updatedAt: now },
        { name: "Coordinator", description: "Manages bookings and staff", roleType: "COORDINATOR", serviceType: null, organizationId: orgId, createdBy: adminId, status: true, createdAt: now, updatedAt: now },
      ],
    });
  }

  // ── Services ─────────────────────────────────────────────────
  const svcCount = await prisma.service.count({ where: { organizationId: orgId } });
  if (svcCount === 0) {
    await prisma.service.createMany({
      data: [
        { organizationId: orgId, category: "MOBILITY", serviceName: "Mobility Transport", defaultCapacity: 10, durationMinutes: 60, description: "Door-to-door transport for participants with mobility needs", requiresTransport: true, requiresStaff: true, status: true, createdAt: now, updatedAt: now },
        { organizationId: orgId, category: "RECREATION", serviceName: "Recreation Program", defaultCapacity: 20, durationMinutes: 120, description: "Group recreational activities and social programs", requiresTransport: false, requiresStaff: true, status: true, createdAt: now, updatedAt: now },
        { organizationId: orgId, category: "DAYCARE", serviceName: "Daycare Support", defaultCapacity: 15, durationMinutes: 480, description: "Full-day structured care and activity program", requiresTransport: false, requiresStaff: true, status: true, createdAt: now, updatedAt: now },
      ],
    });
  }

  // ── Vehicles (vehicleNumber is globally unique → suffix with org code) ──
  const vehCount = await prisma.vehicle.count({ where: { organizationId: orgId } });
  if (vehCount === 0) {
    await prisma.vehicle.createMany({
      data: [
        { organizationId: orgId, serviceType: "MOBILITY", vehicleName: "Example Van", vehicleNumber: `${suffix}-VAN-01`, vehicleType: "Van", capacity: 12, wheelchairCapacity: 2, wheelchairAccessible: true, GPSId: null, equipmentDetails: ["Wheelchair ramp", "First aid kit"], Notes: "Sample vehicle — edit or delete", createdBy: adminId, status: true, createdAt: now, updatedAt: now },
        { organizationId: orgId, serviceType: null, vehicleName: "Example Minibus", vehicleNumber: `${suffix}-BUS-01`, vehicleType: "Minibus", capacity: 15, wheelchairCapacity: 0, wheelchairAccessible: false, GPSId: null, equipmentDetails: ["Air conditioning"], Notes: "Sample vehicle — edit or delete", createdBy: adminId, status: true, createdAt: now, updatedAt: now },
      ],
    });
  }

  // ── Venues ───────────────────────────────────────────────────
  const venueCount = await prisma.venue.count({ where: { organizationId: orgId } });
  if (venueCount === 0) {
    await prisma.venue.createMany({
      data: [
        { organizationId: orgId, name: "Main Hall", address: "Your main address", capacity: 50, availableCapacity: 50, serviceType: "RECREATION", contactPerson: "Front Desk", contactPhone: org.phone || "", status: true, isOccupied: false, createdBy: adminId, createdAt: now, updatedAt: now },
        { organizationId: orgId, name: "Activity Room", address: "Your secondary address", capacity: 20, availableCapacity: 20, serviceType: "DAYCARE", contactPerson: "Front Desk", contactPhone: org.phone || "", status: true, isOccupied: false, createdBy: adminId, createdAt: now, updatedAt: now },
      ],
    });
  }

  // ── A sample service slot (needs a service + venue) ───────────
  const slotCount = await prisma.serviceSlot.count({ where: { organizationId: orgId } });
  if (slotCount === 0) {
    const recreation = await prisma.service.findFirst({ where: { organizationId: orgId, category: "RECREATION" } });
    const venue = await prisma.venue.findFirst({ where: { organizationId: orgId } });
    if (recreation) {
      const start = now + BigInt(2 * DAY_MS) + BigInt(10 * 60 * 60 * 1000);
      await prisma.serviceSlot.create({
        data: {
          organizationId: orgId, serviceId: recreation.id, venueId: venue?.id || null, serviceType: "RECREATION",
          slotDate: now + BigInt(2 * DAY_MS), startTime: start, endTime: start + BigInt(2 * 60 * 60 * 1000),
          capacity: 10, bookedCount: 0, createdBy: adminId, createdAt: now, updatedAt: now,
        },
      });
    }
  }
}

module.exports = { seedOrgStarterData };
