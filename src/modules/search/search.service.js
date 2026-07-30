const prisma = require("../../config/db");

// Global org-scoped search. Role-aware: guardians only see their own
// participants + bookings; staff see operational resources; managers see all.
// Every query filters by organizationId — never leaks across tenants.

const LIMIT = 5; // per result group

const insensitive = (q) => ({ contains: q, mode: "insensitive" });

const searchService = {
  search: async (authUser, rawQuery) => {
    // Coerce first — a duplicated ?q=a&q=b makes Express parse q as an array,
    // and `.trim` would be undefined on it.
    const q = String(rawQuery ?? "").trim();
    const { organizationId, role, id: userId } = authUser;

    if (q.length < 2) {
      return { query: q, results: {} };
    }

    const isManager = ["NPO_ADMIN", "COORDINATOR"].includes(role);
    const isGuardian = role === "GUARDIAN";
    const isStaff = role === "STAFF";

    const results = {};

    // --- Participants ---
    const participantWhere = {
      organizationId,
      role: "PARTICIPANT",
      isDeleted: false,
      OR: [{ fullName: insensitive(q) }, { email: insensitive(q) }],
    };
    // Guardians only see their own participants
    if (isGuardian) participantWhere.guardianUserId = userId;

    if (isManager || isGuardian || isStaff) {
      results.participants = await prisma.user.findMany({
        where: participantWhere,
        select: { id: true, fullName: true, profileImage: true, email: true, serviceType: true },
        take: LIMIT,
      });
    }

    // --- Guardians (managers only) ---
    if (isManager) {
      results.guardians = await prisma.user.findMany({
        where: {
          organizationId,
          role: "GUARDIAN",
          isDeleted: false,
          OR: [{ fullName: insensitive(q) }, { email: insensitive(q) }, { phone: insensitive(q) }],
        },
        select: { id: true, fullName: true, profileImage: true, email: true, phone: true },
        take: LIMIT,
      });
    }

    // --- Staff (managers only) ---
    if (isManager) {
      results.staff = await prisma.user.findMany({
        where: {
          organizationId,
          role: { in: ["STAFF", "COORDINATOR", "NPO_ADMIN"] },
          isDeleted: false,
          OR: [{ fullName: insensitive(q) }, { email: insensitive(q) }],
        },
        select: { id: true, fullName: true, profileImage: true, email: true, role: true },
        take: LIMIT,
      });
    }

    // --- Vehicles (managers + staff) ---
    if (isManager || isStaff) {
      results.vehicles = await prisma.vehicle.findMany({
        where: {
          organizationId,
          isDeleted: false,
          OR: [{ vehicleName: insensitive(q) }, { vehicleNumber: insensitive(q) }],
        },
        select: { id: true, vehicleName: true, vehicleNumber: true, capacity: true },
        take: LIMIT,
      });
    }

    // --- Venues (managers + staff) ---
    if (isManager || isStaff) {
      results.venues = await prisma.venue.findMany({
        where: {
          organizationId,
          isDeleted: false,
          OR: [{ name: insensitive(q) }, { address: insensitive(q) }],
        },
        select: { id: true, name: true, address: true, capacity: true },
        take: LIMIT,
      });
    }

    // --- Bookings (by participant name; guardian → own only) ---
    const bookingWhere = {
      organizationId,
      participant: { fullName: insensitive(q) },
    };
    if (isGuardian) bookingWhere.guardianId = userId;

    if (isManager || isGuardian) {
      results.bookings = await prisma.booking.findMany({
        where: bookingWhere,
        select: {
          id: true,
          status: true,
          serviceType: true,
          bookingDate: true,
          participant: { select: { fullName: true, profileImage: true } },
        },
        orderBy: { bookingDate: "desc" },
        take: LIMIT,
      });
    }

    return { query: q, results };
  },
};

module.exports = searchService;
