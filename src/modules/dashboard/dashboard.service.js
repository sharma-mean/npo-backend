const prisma = require("../../config/db");

const dashboardService = {
  // Single round-trip: all counts via subqueries (much faster over high-latency DB)
  getStats: async (organizationId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    const ts = todayStart.getTime();
    const te = todayEnd.getTime();

    const rows = await prisma.$queryRaw`
      SELECT
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId})::int AS "totalBookings",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'PENDING')::int AS "pendingBookings",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'APPROVED')::int AS "approvedBookings",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'COMPLETED')::int AS "completedBookings",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'WAITLISTED')::int AS "waitlistedBookings",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND "bookingDate" >= ${ts} AND "bookingDate" <= ${te})::int AS "todayBookings",
        (SELECT count(*) FROM "User" WHERE "organizationId" = ${organizationId} AND role = 'STAFF' AND status = true AND "isDeleted" = false)::int AS "activeStaff",
        (SELECT count(*) FROM "Vehicle" WHERE "organizationId" = ${organizationId} AND status = true AND "isDeleted" = false)::int AS "activeVehicles",
        (SELECT count(*) FROM "Venue" WHERE "organizationId" = ${organizationId} AND status = true AND "isDeleted" = false)::int AS "activeVenues",
        (SELECT count(*) FROM "User" WHERE "organizationId" = ${organizationId} AND role = 'PARTICIPANT' AND "isDeleted" = false)::int AS "totalParticipants",
        (SELECT count(*) FROM "User" WHERE "organizationId" = ${organizationId} AND role = 'GUARDIAN' AND "isDeleted" = false)::int AS "totalGuardians",
        (SELECT count(*) FROM "Incident" WHERE "organizationId" = ${organizationId} AND status <> 'RESOLVED' AND "isDeleted" = false)::int AS "openIncidents",
        (SELECT count(*) FROM "Service" WHERE "organizationId" = ${organizationId})::int AS "servicesCount",
        (SELECT count(*) FROM "ServiceSlot" WHERE "organizationId" = ${organizationId})::int AS "slotsCount",
        (SELECT count(*) FROM "StaffRole" WHERE "organizationId" = ${organizationId})::int AS "staffRolesCount"
    `;
    return rows[0];
  },

  // Lightweight counts for the nav-tab action badges (Approvals / Dispatch /
  // Incidents). Single round-trip, subqueries only for the actionable metrics —
  // kept separate from getStats so it stays cheap enough to poll.
  getNavCounts: async (organizationId) => {
    const rows = await prisma.$queryRaw`
      SELECT
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'PENDING')::int AS "pendingApprovals",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'WAITLISTED')::int AS "waitlisted",
        (SELECT count(*) FROM "Booking" WHERE "organizationId" = ${organizationId} AND status = 'APPROVED' AND "requiredSeats" > 0 AND "vehicleId" IS NULL)::int AS "dispatchPending",
        (SELECT count(*) FROM "Incident" WHERE "organizationId" = ${organizationId} AND status <> 'RESOLVED' AND "isDeleted" = false)::int AS "openIncidents",
        (SELECT count(*) FROM "AccountDeletionRequest" WHERE "organizationId" = ${organizationId} AND status = 'PENDING')::int AS "pendingDeletions"
    `;
    return rows[0];
  },

  // Live operations snapshot for the dashboard widgets (client Figma flow):
  // staff deployment, vehicle utilization, operational readiness and the
  // real-time attendance board for today.
  getOps: async (organizationId) => {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date();
    dayEnd.setHours(23, 59, 59, 999);
    const ts = BigInt(dayStart.getTime());
    const te = BigInt(dayEnd.getTime());

    const [activeStaff, activeVehicles, attendance, todayApproved] = await Promise.all([
      prisma.user.count({
        where: { organizationId, role: "STAFF", status: true, isDeleted: false },
      }),
      prisma.vehicle.count({
        where: { organizationId, status: true, isDeleted: false },
      }),
      prisma.staffAttendance.findMany({
        where: { organizationId, isDeleted: false, attendanceDate: { gte: ts, lte: te } },
        include: { user: { select: { id: true, fullName: true, userCode: true } } },
        orderBy: { checkInAt: "desc" },
        take: 100,
      }),
      prisma.booking.findMany({
        where: {
          organizationId,
          status: "APPROVED",
          startTime: { gte: ts, lte: te },
        },
        select: {
          id: true,
          vehicleId: true,
          staffAssignments: {
            where: { status: { not: "CANCELLED" } },
            select: { id: true },
          },
        },
      }),
    ]);

    const checkedIn = attendance.filter(
      (a) => a.attendanceStatus !== "LEAVE" && a.checkInAt && !a.checkOutAt,
    ).length;
    const vehiclesInUse = new Set(
      todayApproved.map((b) => b.vehicleId).filter(Boolean),
    ).size;
    const staffed = todayApproved.filter((b) => b.staffAssignments.length > 0).length;
    const readiness = todayApproved.length > 0
      ? Math.round((staffed / todayApproved.length) * 100)
      : 100;

    return {
      staffDeployment: { checkedIn, total: activeStaff },
      vehicleUtilization: { inUse: vehiclesInUse, total: activeVehicles },
      operationalReadiness: readiness,
      todayApprovedBookings: todayApproved.length,
      attendance: attendance.map((a) => ({
        userId: a.userId,
        name: a.user?.fullName || "",
        userCode: a.user?.userCode || "",
        status: a.attendanceStatus,
        checkInAt: a.checkInAt,
        checkOutAt: a.checkOutAt,
      })),
    };
  },

  // Legacy multi-query version (kept for reference)
  _getStatsSlow: async (organizationId) => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const [
      totalBookings,
      pendingBookings,
      approvedBookings,
      completedBookings,
      todayBookings,
      activeStaff,
      activeVehicles,
      activeVenues,
      totalParticipants,
      totalGuardians,
      waitlistedBookings,
      openIncidents,
      servicesCount,
      slotsCount,
      staffRolesCount,
    ] = await Promise.all([
      prisma.booking.count({ where: { organizationId } }),
      prisma.booking.count({ where: { organizationId, status: "PENDING" } }),
      prisma.booking.count({ where: { organizationId, status: "APPROVED" } }),
      prisma.booking.count({ where: { organizationId, status: "COMPLETED" } }),
      prisma.booking.count({
        where: {
          organizationId,
          bookingDate: {
            gte: BigInt(todayStart.getTime()),
            lte: BigInt(todayEnd.getTime()),
          },
        },
      }),
      prisma.user.count({
        where: { organizationId, role: "STAFF", status: true, isDeleted: false },
      }),
      prisma.vehicle.count({ where: { organizationId, status: true } }),
      prisma.venue.count({ where: { organizationId, status: true } }),
      prisma.user.count({
        where: { organizationId, role: "PARTICIPANT", isDeleted: false },
      }),
      prisma.user.count({
        where: { organizationId, role: "GUARDIAN", isDeleted: false },
      }),
      prisma.booking.count({ where: { organizationId, status: "WAITLISTED" } }),
      prisma.incident.count({
        where: { organizationId, status: { not: "RESOLVED" }, isDeleted: false },
      }),
      prisma.service.count({ where: { organizationId } }),
      prisma.serviceSlot.count({ where: { organizationId } }),
      prisma.staffRole.count({ where: { organizationId } }),
    ]);

    return {
      totalBookings,
      pendingBookings,
      approvedBookings,
      completedBookings,
      todayBookings,
      activeStaff,
      activeVehicles,
      activeVenues,
      totalParticipants,
      totalGuardians,
      waitlistedBookings,
      openIncidents,
      servicesCount,
      slotsCount,
      staffRolesCount,
    };
  },
};

module.exports = dashboardService;
