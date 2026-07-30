const prisma = require("../../config/db");
const notificationService = require("../notification/notification.service");

// Readable rows for the weekly digest email.
const BOOKING_STATUS_LABEL = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
  WAITLISTED: "Waitlisted",
};

const formatDay = (ms) =>
  new Date(Number(ms)).toLocaleDateString("en-GB", {
    timeZone: "Asia/Tokyo",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

// Parse a from/to date range (YYYY-MM-DD or ms) into a BigInt ms window.
// Defaults: last 30 days → now.
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

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const STD_HOURS_PER_DAY = 8; // fallback when a staff member has no contracted hours set
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // fallback: Mon–Fri

// Count days in a calendar month whose weekday is in `workingDays` (0=Sun…6=Sat).
// Client-confirmed: staff have individual schedules incl. weekends (Mon–Sun).
const workingDaysInMonth = (year, monthIndex, workingDays) => {
  const days = new Date(year, monthIndex + 1, 0).getDate();
  let count = 0;
  for (let d = 1; d <= days; d++) {
    if (workingDays.includes(new Date(year, monthIndex, d).getDay())) count++;
  }
  return count;
};

// List (year, monthIndex) buckets overlapping a [startMs, endMs] window.
const monthsInRange = (startMs, endMs) => {
  const out = [];
  const s = new Date(startMs);
  const e = new Date(endMs);
  let y = s.getFullYear();
  let m = s.getMonth();
  while (y < e.getFullYear() || (y === e.getFullYear() && m <= e.getMonth())) {
    out.push({ year: y, monthIndex: m });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return out;
};

const reportService = {
  bookingsReport: async (organizationId, query = {}) => {
    const range = parseRange(query);
    // Optional filters (client report has status/participant/service filters).
    const where = { organizationId, bookingDate: range };
    if (query.status) where.status = String(query.status);
    if (query.serviceType) where.serviceType = String(query.serviceType);
    if (query.participantId) where.participantId = String(query.participantId);

    const bookings = await prisma.booking.findMany({
      where,
      select: {
        id: true, bookingCode: true, status: true, serviceType: true,
        bookingDate: true, startTime: true, endTime: true, participantCount: true,
        pickupAddress: true, approvedBy: true, cancellationReason: true, notes: true,
        participant: { select: { id: true, fullName: true, nameKana: true, userCode: true } },
        guardian: { select: { fullName: true, nameKana: true } },
        venue: { select: { name: true, address: true } },
        slot: { select: { service: { select: { serviceName: true, serviceNameJa: true } } } },
      },
      orderBy: { startTime: "desc" },
      take: 1000,
    });

    // Resolve approver ids → names in one query (approvedBy stores a user id).
    const approverIds = [
      ...new Set(bookings.map((b) => b.approvedBy).filter(Boolean)),
    ];
    const approverMap = {};
    if (approverIds.length > 0) {
      const approvers = await prisma.user.findMany({
        where: { id: { in: approverIds }, organizationId },
        select: { id: true, fullName: true },
      });
      for (const u of approvers) approverMap[u.id] = u.fullName;
    }

    const byStatus = {};
    const byServiceType = {};
    let totalParticipants = 0;
    const rows = [];
    for (const b of bookings) {
      byStatus[b.status] = (byStatus[b.status] || 0) + 1;
      byServiceType[b.serviceType] = (byServiceType[b.serviceType] || 0) + 1;
      totalParticipants += b.participantCount || 0;
      const durationH = b.endTime && b.startTime
        ? Math.round(((Number(b.endTime) - Number(b.startTime)) / 3600000) * 10) / 10
        : null;
      rows.push({
        id: b.id,
        bookingCode: b.bookingCode || `#${b.id.slice(0, 8).toUpperCase()}`,
        participantId: b.participant?.id || null,
        participantCode: b.participant?.userCode || "",
        participantName: b.participant?.nameKana
          ? `${b.participant.fullName} / ${b.participant.nameKana}`
          : b.participant?.fullName || "",
        guardianName: b.guardian?.nameKana
          ? `${b.guardian.fullName} / ${b.guardian.nameKana}`
          : b.guardian?.fullName || "",
        serviceType: b.serviceType,
        serviceName: b.slot?.service?.serviceName || "",
        serviceNameJa: b.slot?.service?.serviceNameJa || "",
        bookingDate: Number(b.bookingDate),
        serviceDate: Number(b.startTime),
        status: b.status,
        pickup: b.pickupAddress || "",
        dropoff: b.venue?.name || b.venue?.address || "",
        duration: durationH != null ? `${durationH}h` : "",
        notes: b.notes || "",
        // Prefer the resolved approver name; fall back to whatever's stored
        // (older rows may already hold a name string).
        approvedBy: b.approvedBy ? (approverMap[b.approvedBy] || b.approvedBy) : "",
        rejectedReason: b.cancellationReason || "",
      });
    }

    return {
      from: Number(range.gte),
      to: Number(range.lte),
      total: bookings.length,
      totalParticipants,
      byStatus,
      byServiceType,
      rows,
    };
  },

  // Monthly per-staff attendance matrix: forecast (weekdays × 8h) vs actual,
  // absences, variance, and a day-by-day P/W/A grid. Matches the client's
  // report format. Actuals come from StaffAttendance check-in/out records.
  attendanceReport: async (organizationId, query = {}) => {
    const range = parseRange(query);
    const records = await prisma.staffAttendance.findMany({
      where: { organizationId, isDeleted: false, attendanceDate: range },
      include: {
        user: {
          select: {
            id: true, fullName: true, nameKana: true, email: true, userCode: true,
            contractedHoursPerDay: true, workingDays: true,
          },
        },
      },
    });

    // Roster: every staff with any record in the window (keeps the report to
    // people who were actually active in the period).
    const staff = {};
    // Attendance keyed by userId → { "YYYY-M-D": { minutes, present } }.
    // Present = any non-LEAVE record that day — a staff member who checked in
    // but never checked out (0 minutes) still attended, not absent.
    const worked = {};
    for (const r of records) {
      const id = r.userId;
      if (!staff[id]) {
        staff[id] = {
          userId: id,
          name: r.user?.nameKana
            ? `${r.user.fullName} / ${r.user.nameKana}`
            : r.user?.fullName || "Unknown",
          email: r.user?.email || "",
          userCode: r.user?.userCode || "",
          hoursPerDay: r.user?.contractedHoursPerDay ?? STD_HOURS_PER_DAY,
          workingDays:
            Array.isArray(r.user?.workingDays) && r.user.workingDays.length > 0
              ? r.user.workingDays
              : DEFAULT_WORKING_DAYS,
        };
      }
      // Bucket by UTC calendar day — server-timezone independent (Vercel runs
      // UTC; a local-tz bucket would shift evening check-ins to the next day).
      const d = new Date(Number(r.attendanceDate));
      const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
      worked[id] = worked[id] || {};
      const cell = (worked[id][key] = worked[id][key] || { minutes: 0, present: false });
      cell.minutes += r.totalWorkingMinutes || 0;
      if (r.attendanceStatus !== "LEAVE") cell.present = true;
    }

    const months = monthsInRange(Number(range.gte), Number(range.lte));
    const rows = [];
    const summary = { totalForecastDays: 0, totalActualDays: 0, totalAbsentDays: 0, totalForecastHours: 0, totalActualHours: 0 };

    for (const s of Object.values(staff)) {
      for (const { year, monthIndex } of months) {
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        // Forecast from the staff member's own contract: their working days
        // (Mon–Sun capable) × their contracted hours per day.
        const forecastDays = workingDaysInMonth(year, monthIndex, s.workingDays);
        const forecastHours = +(forecastDays * s.hoursPerDay).toFixed(1);

        const grid = [];
        let actualDays = 0;
        let actualMinutes = 0;
        let absentDays = 0;
        for (let day = 1; day <= daysInMonth; day++) {
          const wd = new Date(year, monthIndex, day).getDay();
          const isOffDay = !s.workingDays.includes(wd);
          const key = `${year}-${monthIndex}-${day}`;
          const cell = worked[s.userId]?.[key];
          if (cell?.present) {
            actualDays += 1;
            actualMinutes += cell.minutes;
            grid.push({ day, status: "P", hours: +(cell.minutes / 60).toFixed(1) });
          } else if (isOffDay) {
            // W = not a scheduled working day for this staff member
            grid.push({ day, status: "W", hours: 0 });
          } else {
            absentDays += 1;
            grid.push({ day, status: "A", hours: 0 });
          }
        }

        const actualHours = +(actualMinutes / 60).toFixed(1);
        // Skip months where this staff has zero activity (no records at all).
        if (actualDays === 0 && absentDays === forecastDays) continue;

        summary.totalForecastDays += forecastDays;
        summary.totalActualDays += actualDays;
        summary.totalAbsentDays += absentDays;
        summary.totalForecastHours += forecastHours;
        summary.totalActualHours += actualHours;

        rows.push({
          userId: s.userId,
          userCode: s.userCode,
          name: s.name,
          email: s.email,
          year,
          month: monthIndex + 1,
          monthName: MONTH_NAMES[monthIndex],
          forecastDays,
          actualDays,
          absentDays,
          forecastHours,
          actualHours,
          varianceDays: actualDays - forecastDays,
          varianceHours: +(actualHours - forecastHours).toFixed(1),
          days: grid,
        });
      }
    }

    const attendanceRate = summary.totalForecastDays > 0
      ? Math.round((summary.totalActualDays / summary.totalForecastDays) * 100)
      : 0;

    return {
      from: Number(range.gte),
      to: Number(range.lte),
      totalStaff: Object.keys(staff).length,
      summary: { ...summary, attendanceRate },
      rows,
    };
  },

  // Email a weekly booking digest to every active org's managers. Each org is
  // isolated in its own try/catch so one failure never aborts the sweep.
  // Idempotency is not enforced here — the cron schedule controls cadence.
  sendWeeklyDigests: async (windowMs = 7 * 24 * 60 * 60 * 1000) => {
    const orgs = await prisma.organization.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true },
    });

    const fromMs = Date.now() - windowMs;
    let sent = 0;
    const results = await Promise.allSettled(
      orgs.map(async (org) => {
        const report = await reportService.bookingsReport(org.id, { from: new Date(fromMs).toISOString() });
        // Skip silent orgs with no activity in the window.
        if (report.total === 0) return;

        const managers = await prisma.user.findMany({
          where: {
            organizationId: org.id,
            role: { in: ["NPO_ADMIN", "COORDINATOR"] },
            isDeleted: false,
            status: true,
          },
          select: { id: true, email: true, fullName: true },
        });
        if (managers.length === 0) return;

        const statusLines = Object.entries(report.byStatus)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ");
        const message =
          `Weekly summary for ${org.name}: ${report.total} bookings ` +
          `(${report.totalParticipants} participants). ${statusLines}.`;

        // The email gets the same numbers as readable rows rather than one
        // run-on sentence: totals first, then the status breakdown.
        const details = [
          ["Organization", org.name],
          ["Period", `${formatDay(fromMs)} – ${formatDay(Date.now())}`],
          ["Bookings", String(report.total)],
          ["Participants", String(report.totalParticipants)],
          ...Object.entries(report.byStatus)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => [BOOKING_STATUS_LABEL[k] || k, String(v)]),
        ];

        const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");

        await Promise.allSettled(
          managers.map((m) =>
            notificationService.notify({
              userId: m.id,
              organizationId: org.id,
              title: "Weekly booking report",
              message,
              type: "REPORT",
              email: m.email,
              emailData: {
                details,
                ...(frontendUrl
                  ? { actionUrl: `${frontendUrl}/reports`, actionText: "Open reports" }
                  : {}),
              },
            }),
          ),
        );
        sent += 1;
      }),
    );

    const failed = results.filter((r) => r.status === "rejected").length;
    return { orgs: orgs.length, digestsSent: sent, failed };
  },
};

module.exports = reportService;
