const prisma = require("../../config/db");
const notificationService = require("../notification/notification.service");
const { logAudit } = require("../../utils/auditLogger");
const {
  VIGOR_MIN,
  VIGOR_MAX,
  STATES,
  NIGHT_WAKINGS,
  BELONGINGS,
  TRANSPORT,
  MANAGER_ROLES,
} = require("./dailyReport.constants");

// User relations resolve to User rows — never bare-include (would leak password
// + reset/verify tokens). Safe selects only.
const PERSON = { select: { id: true, fullName: true, profileImage: true } };
const REPORT_SELECT = {
  id: true,
  organizationId: true,
  bookingId: true,
  participantId: true,
  guardianId: true,
  staffId: true,
  reportDate: true,
  vigorLevel: true,
  states: true,
  bodyTemp: true,
  bedtime: true,
  wakeTime: true,
  nightWakings: true,
  belongings: true,
  pickup: true,
  dropoff: true,
  notes: true,
  status: true,
  finalizedAt: true,
  createdAt: true,
  updatedAt: true,
  participant: PERSON,
  guardian: PERSON,
  staff: PERSON,
  booking: { select: { id: true, bookingCode: true, serviceType: true, startTime: true } },
};

const isManager = (role) => MANAGER_ROLES.includes(role);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Coerce + validate the caller-supplied report fields into a clean data object.
// Throws a readable error on the first invalid value.
const cleanFields = (body) => {
  const data = {};

  if (body.vigorLevel !== undefined && body.vigorLevel !== null && body.vigorLevel !== "") {
    const v = Number(body.vigorLevel);
    if (!Number.isInteger(v) || v < VIGOR_MIN || v > VIGOR_MAX) {
      throw new Error(`vigorLevel must be ${VIGOR_MIN}-${VIGOR_MAX}`);
    }
    data.vigorLevel = v;
  }

  if (body.states !== undefined) {
    const arr = Array.isArray(body.states) ? body.states : [];
    for (const s of arr) if (!STATES.includes(s)) throw new Error(`Invalid state: ${s}`);
    data.states = [...new Set(arr)];
  }

  if (body.bodyTemp !== undefined && body.bodyTemp !== null && body.bodyTemp !== "") {
    const t = Number(body.bodyTemp);
    if (!Number.isFinite(t) || t < 30 || t > 45) throw new Error("bodyTemp is out of range");
    data.bodyTemp = t;
  }

  for (const key of ["bedtime", "wakeTime"]) {
    if (body[key] !== undefined) {
      const val = body[key];
      if (val && !HHMM.test(String(val))) throw new Error(`${key} must be HH:MM`);
      data[key] = val || null;
    }
  }

  if (body.nightWakings !== undefined) {
    if (body.nightWakings && !NIGHT_WAKINGS.includes(body.nightWakings)) {
      throw new Error("Invalid nightWakings");
    }
    data.nightWakings = body.nightWakings || null;
  }

  if (body.belongings !== undefined) {
    const arr = Array.isArray(body.belongings) ? body.belongings : [];
    for (const b of arr) if (!BELONGINGS.includes(b)) throw new Error(`Invalid belonging: ${b}`);
    data.belongings = [...new Set(arr)];
  }

  for (const key of ["pickup", "dropoff"]) {
    if (body[key] !== undefined) {
      if (body[key] && !TRANSPORT.includes(body[key])) throw new Error(`Invalid ${key}`);
      data[key] = body[key] || null;
    }
  }

  if (body.notes !== undefined) data.notes = body.notes ? String(body.notes).slice(0, 2000) : null;

  return data;
};

// Notify the participant's guardian that a finalized report is ready — ONLY that
// guardian, never the whole org. Best-effort (notify never throws into caller).
const notifyGuardian = async (report) => {
  if (!report.guardianId) return;
  const guardian = await prisma.user.findUnique({
    where: { id: report.guardianId },
    select: { id: true, email: true },
  });
  if (!guardian) return;
  await notificationService.notify({
    userId: guardian.id,
    organizationId: report.organizationId,
    type: "DAILY_REPORT",
    title: "Today's report is ready",
    message: `A daily report for ${report.participant?.fullName || "your participant"} is now available.`,
    relatedBookingId: report.bookingId || undefined,
    email: guardian.email,
    emailSubject: "Today's report for your participant",
  });
};

const dailyReportService = {
  /**
   * Create a report. Staff/managers only. The participant + guardian are resolved
   * from the booking when given, else from the participant's own guardian link.
   * `status: "FINALIZED"` finalizes immediately (and notifies the guardian).
   */
  createReport: async (body, authUser) => {
    const organizationId = authUser.organizationId;
    if (!body.participantId) throw new Error("participantId is required");

    // Participant must belong to the caller's org.
    const participant = await prisma.user.findFirst({
      where: { id: body.participantId, organizationId, isDeleted: false },
      select: { id: true, fullName: true, guardianUserId: true },
    });
    if (!participant) throw new Error("Participant not found");

    // Guardian comes from the booking (authoritative) or the participant's link.
    let bookingId = null;
    let guardianId = participant.guardianUserId || null;
    if (body.bookingId) {
      const booking = await prisma.booking.findFirst({
        where: { id: body.bookingId, organizationId },
        select: { id: true, guardianId: true, participantId: true, startTime: true },
      });
      if (!booking) throw new Error("Booking not found");
      if (booking.participantId !== participant.id) {
        throw new Error("Booking does not belong to this participant");
      }
      bookingId = booking.id;
      guardianId = booking.guardianId || guardianId;
    }

    const now = BigInt(Date.now());
    const finalize = body.status === "FINALIZED";
    const data = cleanFields(body);

    const reportDate = body.reportDate ? BigInt(Number(body.reportDate)) : now;

    const created = await prisma.dailyReport.create({
      data: {
        organizationId,
        bookingId,
        participantId: participant.id,
        guardianId,
        staffId: authUser.id,
        reportDate,
        ...data,
        status: finalize ? "FINALIZED" : "DRAFT",
        finalizedAt: finalize ? now : null,
        createdAt: now,
        updatedAt: now,
      },
      select: REPORT_SELECT,
    });

    logAudit({ actorId: authUser.id, organizationId, entity: "DailyReport", entityId: created.id, action: "CREATE" });
    if (finalize) await notifyGuardian(created);
    return created;
  },

  /** Edit a DRAFT report. Only the author or a manager; finalized reports lock. */
  updateReport: async (id, body, authUser) => {
    const organizationId = authUser.organizationId;
    const existing = await prisma.dailyReport.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, staffId: true, status: true },
    });
    if (!existing) throw new Error("Report not found");
    if (!isManager(authUser.role) && existing.staffId !== authUser.id) {
      throw new Error("You can only edit your own reports");
    }
    if (existing.status === "FINALIZED") throw new Error("A finalized report cannot be edited");

    const data = cleanFields(body);
    const updated = await prisma.dailyReport.update({
      where: { id },
      data: { ...data, updatedAt: BigInt(Date.now()) },
      select: REPORT_SELECT,
    });
    logAudit({ actorId: authUser.id, organizationId, entity: "DailyReport", entityId: id, action: "UPDATE" });
    return updated;
  },

  /** Finalize a report → notify the participant's guardian. Idempotent-ish. */
  finalizeReport: async (id, authUser) => {
    const organizationId = authUser.organizationId;
    const existing = await prisma.dailyReport.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, staffId: true, status: true },
    });
    if (!existing) throw new Error("Report not found");
    if (!isManager(authUser.role) && existing.staffId !== authUser.id) {
      throw new Error("You can only finalize your own reports");
    }
    if (existing.status === "FINALIZED") throw new Error("Report is already finalized");

    const now = BigInt(Date.now());
    const finalized = await prisma.dailyReport.update({
      where: { id },
      data: { status: "FINALIZED", finalizedAt: now, updatedAt: now },
      select: REPORT_SELECT,
    });
    logAudit({ actorId: authUser.id, organizationId, entity: "DailyReport", entityId: id, action: "STATUS_CHANGE" });
    await notifyGuardian(finalized);
    return finalized;
  },

  /**
   * List reports, role-scoped:
   * - GUARDIAN: only FINALIZED reports for their own participants
   * - STAFF: only reports they authored
   * - manager: all org reports
   */
  getReports: async (authUser, query = {}) => {
    const organizationId = authUser.organizationId;
    const where = { organizationId, isDeleted: false };

    if (authUser.role === "GUARDIAN") {
      where.guardianId = authUser.id;
      where.status = "FINALIZED";
    } else if (authUser.role === "PARTICIPANT") {
      where.participantId = authUser.id;
      where.status = "FINALIZED";
    } else if (!isManager(authUser.role)) {
      where.staffId = authUser.id; // STAFF
    }

    if (query.participantId) where.participantId = query.participantId;
    if (query.bookingId) where.bookingId = query.bookingId;
    if (query.status && ["DRAFT", "FINALIZED"].includes(query.status)) where.status = query.status;

    const take = Math.min(Math.max(Number(query.take) || 50, 1), 200);
    const skip = Math.max(Number(query.skip) || 0, 0);

    return prisma.dailyReport.findMany({
      where,
      select: REPORT_SELECT,
      orderBy: { reportDate: "desc" },
      take,
      skip,
    });
  },

  getReportById: async (id, authUser) => {
    const organizationId = authUser.organizationId;
    const report = await prisma.dailyReport.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: REPORT_SELECT,
    });
    if (!report) throw new Error("Report not found");

    // Guardians/participants may only read their own finalized reports; staff
    // may read what they authored; managers see all.
    if (authUser.role === "GUARDIAN") {
      if (report.guardianId !== authUser.id || report.status !== "FINALIZED") {
        throw new Error("Not authorized to view this report");
      }
    } else if (authUser.role === "PARTICIPANT") {
      if (report.participantId !== authUser.id || report.status !== "FINALIZED") {
        throw new Error("Not authorized to view this report");
      }
    } else if (!isManager(authUser.role) && report.staffId !== authUser.id) {
      throw new Error("Not authorized to view this report");
    }
    return report;
  },

  /** Soft-delete — author (draft only) or manager. */
  deleteReport: async (id, authUser) => {
    const organizationId = authUser.organizationId;
    const existing = await prisma.dailyReport.findFirst({
      where: { id, organizationId, isDeleted: false },
      select: { id: true, staffId: true, status: true },
    });
    if (!existing) throw new Error("Report not found");
    const manager = isManager(authUser.role);
    if (!manager && existing.staffId !== authUser.id) {
      throw new Error("You can only delete your own reports");
    }
    if (!manager && existing.status === "FINALIZED") {
      throw new Error("A finalized report can only be removed by a manager");
    }
    await prisma.dailyReport.update({
      where: { id },
      data: { isDeleted: true, updatedAt: BigInt(Date.now()) },
    });
    logAudit({ actorId: authUser.id, organizationId, entity: "DailyReport", entityId: id, action: "DELETE" });
    return { success: true };
  },
};

module.exports = dailyReportService;
