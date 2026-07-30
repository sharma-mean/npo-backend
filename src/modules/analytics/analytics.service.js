const prisma = require("../../config/db");

// Parse from/to (YYYY-MM-DD or ms) into a BigInt ms window. Default last 30d.
const parseRange = ({ from, to }) => {
  const now = Date.now();
  const start = from ? new Date(from) : new Date(now - 30 * 24 * 60 * 60 * 1000);
  const end = to ? new Date(to) : new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range");
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  if (start.getTime() > end.getTime()) {
    throw new Error("'from' date must be on or before 'to' date");
  }
  return { gte: BigInt(start.getTime()), lte: BigInt(end.getTime()) };
};

// Local YYYY-MM-DD bucket key for a BigInt ms timestamp.
const dayKey = (ms) => {
  const d = new Date(Number(ms));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const pct = (num, den) => (den > 0 ? +((num / den) * 100).toFixed(1) : 0);

const analyticsService = {
  kpi: async (organizationId, query = {}) => {
    const range = parseRange(query);

    const [bookings, slots, incidents, attendance] = await Promise.all([
      prisma.booking.findMany({
        where: { organizationId, bookingDate: range },
        select: { status: true, serviceType: true, bookingDate: true, participantCount: true },
      }),
      prisma.serviceSlot.findMany({
        where: { organizationId, isDeleted: false, slotDate: range },
        select: { capacity: true, bookedCount: true, serviceType: true },
      }),
      prisma.incident.findMany({
        where: { organizationId, isDeleted: false, createdAt: range },
        select: { type: true, severity: true, status: true, bookingId: true },
      }),
      prisma.staffAttendance.findMany({
        where: { organizationId, isDeleted: false, attendanceDate: range },
        select: { totalWorkingMinutes: true },
      }),
    ]);

    // --- Booking breakdowns ---
    const byStatus = {};
    const byServiceType = {};
    const volumeByDay = {};
    let totalParticipants = 0;
    let completed = 0;
    let noShowBookings = 0;
    for (const b of bookings) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      byServiceType[b.serviceType] = (byServiceType[b.serviceType] || 0) + 1;
      totalParticipants += b.participantCount || 0;
      if (b.status === "COMPLETED") completed += 1;
      const k = dayKey(b.bookingDate);
      volumeByDay[k] = (volumeByDay[k] || 0) + 1;
    }

    // --- Slot utilization ---
    let capacitySum = 0;
    let bookedSum = 0;
    const utilByService = {};
    for (const s of slots) {
      capacitySum += s.capacity || 0;
      bookedSum += s.bookedCount || 0;
      const u = (utilByService[s.serviceType] = utilByService[s.serviceType] || { capacity: 0, booked: 0 });
      u.capacity += s.capacity || 0;
      u.booked += s.bookedCount || 0;
    }

    // --- Incidents ---
    const incidentByType = {};
    // No-show rate = share of bookings that had a NO_SHOW incident. Count
    // DISTINCT bookings (a booking can have multiple NO_SHOW incidents) so the
    // rate can never exceed 100%; incidents with no bookingId are ignored.
    const noShowBookingIds = new Set();
    for (const i of incidents) {
      incidentByType[i.type] = (incidentByType[i.type] || 0) + 1;
      if (i.type === "NO_SHOW" && i.bookingId) noShowBookingIds.add(i.bookingId);
    }
    noShowBookings = noShowBookingIds.size;

    // --- Staff hours ---
    const totalStaffMinutes = attendance.reduce((sum, a) => sum + (a.totalWorkingMinutes || 0), 0);

    const totalBookings = bookings.length;

    return {
      from: Number(range.gte),
      to: Number(range.lte),
      summary: {
        totalBookings,
        completedBookings: completed,
        totalParticipants,
        utilizationRate: pct(bookedSum, capacitySum),
        noShowRate: Math.min(100, pct(noShowBookings, totalBookings)),
        completionRate: pct(completed, totalBookings),
        totalStaffHours: +(totalStaffMinutes / 60).toFixed(1),
        totalSlots: slots.length,
        totalIncidents: incidents.length,
      },
      byStatus,
      byServiceType,
      incidentByType,
      utilizationByService: Object.entries(utilByService).map(([serviceType, v]) => ({
        serviceType,
        capacity: v.capacity,
        booked: v.booked,
        rate: pct(v.booked, v.capacity),
      })),
      volumeByDay: Object.entries(volumeByDay)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([date, count]) => ({ date, count })),
    };
  },
};

module.exports = analyticsService;
