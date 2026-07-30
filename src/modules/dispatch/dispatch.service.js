const prisma = require("../../config/db");

// Staff-to-participant ratio (same rule as booking validation): 1 staff per
// 5 participants, minimum 1.
const requiredStaffFor = (participantCount) =>
  Math.max(1, Math.ceil((participantCount || 1) / 5));

/**
 * Dispatch board data for one calendar day: active staff (with designation),
 * active vehicles, and that day's PENDING/APPROVED bookings with their live
 * assignments — everything the timeline needs in one round-trip.
 */
const getBoard = async (organizationId, dateMs) => {
  const day = new Date(Number(dateMs) || Date.now());
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(day);
  end.setHours(23, 59, 59, 999);

  const [staff, vehicles, bookings] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId, role: "STAFF", status: true, isDeleted: false },
      select: {
        id: true,
        fullName: true,
        userCode: true,
        designation: { select: { name: true, roleType: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.vehicle.findMany({
      where: { organizationId, status: true, isDeleted: false },
      select: { id: true, vehicleName: true, vehicleNumber: true, capacity: true },
      orderBy: { vehicleName: "asc" },
    }),
    prisma.booking.findMany({
      where: {
        organizationId,
        status: { in: ["PENDING", "APPROVED"] },
        startTime: { gte: BigInt(start.getTime()), lte: BigInt(end.getTime()) },
      },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        serviceType: true,
        startTime: true,
        endTime: true,
        participantCount: true,
        requiredSeats: true,
        pickupAddress: true,
        vehicleId: true,
        participant: { select: { id: true, fullName: true } },
        venue: { select: { id: true, name: true } },
        staffAssignments: {
          // Exclude DECLINED too — a declined assignment leaves nobody working
          // the task, so it must not count toward staffing on the board.
          where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
          select: {
            id: true,
            userId: true,
            assignmentRole: true,
            status: true,
          },
        },
      },
      orderBy: { startTime: "asc" },
    }),
  ]);

  return {
    date: start.getTime(),
    staff,
    vehicles,
    bookings: bookings.map((b) => ({
      ...b,
      requiredStaff: requiredStaffFor(b.participantCount),
    })),
  };
};

module.exports = { getBoard };
