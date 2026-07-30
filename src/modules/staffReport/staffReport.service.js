const prisma = require("../../config/db");
const notificationService = require("../notification/notification.service");

const STAFF_REPORT_STATUS = {
  DRAFT: "DRAFT",
  SUBMITTED: "SUBMITTED",
};

const assertStaff = (authUser) => {
  if (authUser.role !== "STAFF") {
    throw new Error("Only staff can manage reports");
  }
};

const parseDate = (value) => {
  if (!value) return BigInt(Date.now());
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid report date");
  return BigInt(date.getTime());
};

const includeReportDetails = {
  booking: {
    select: {
      id: true,
      serviceType: true,
      bookingDate: true,
      startTime: true,
      endTime: true,
      participant: {
        select: {
          id: true,
          fullName: true,
          gender: true,
          medicalNotes: true,
          allergyNotes: true,
          emergencyInstructions: true,
        },
      },
      guardian: { select: { id: true, fullName: true } },
    },
  },
};

const getCompletedAssignment = async (bookingId, authUser) => {
  const assignment = await prisma.bookingStaffAssignment.findFirst({
    where: {
      bookingId,
      userId: authUser.id,
      organizationId: authUser.organizationId,
      status: "COMPLETED",
    },
    include: { booking: true },
  });

  if (!assignment) {
    throw new Error("A report can be created only after completing this task");
  }

  return assignment;
};

const staffReportService = {
  listReports: async (authUser, query = {}) => {
    const where = {
      organizationId: authUser.organizationId,
      isDeleted: false,
    };

    if (authUser.role === "STAFF") {
      where.userId = authUser.id;
    } else if (!["NPO_ADMIN", "COORDINATOR"].includes(authUser.role)) {
      throw new Error("Not authorized to view reports");
    }

    if (query.status) where.status = query.status.toUpperCase();
    if (query.date) {
      const day = new Date(query.date);
      if (Number.isNaN(day.getTime())) throw new Error("Invalid date filter");
      day.setHours(0, 0, 0, 0);
      where.reportDate = {
        gte: BigInt(day.getTime()),
        lte: BigInt(day.getTime() + 24 * 60 * 60 * 1000 - 1),
      };
    }

    if (query.bookingId) where.bookingId = { contains: query.bookingId };

    // Search DB-side (was a post-fetch JS .filter over the whole result set).
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { bookingId: { contains: query.search, mode: "insensitive" } },
        { booking: { participant: { fullName: { contains: query.search, mode: "insensitive" } } } },
      ];
    }

    const take = Math.min(Math.max(Number(query.take) || 50, 1), 200);
    const skip = Math.max(Number(query.skip) || 0, 0);

    return prisma.staffReport.findMany({
      where,
      include: includeReportDetails,
      orderBy: { createdAt: "desc" },
      take,
      skip,
    });
  },

  createReport: async (data, authUser) => {
    assertStaff(authUser);
    if (!data.title) throw new Error("Report title is required");
    if (!data.bookingId) throw new Error("Booking ID is required");
    if (!data.description) throw new Error("Description is required");

    await getCompletedAssignment(data.bookingId, authUser);

    const existing = await prisma.staffReport.findFirst({
      where: {
        bookingId: data.bookingId,
        userId: authUser.id,
        organizationId: authUser.organizationId,
        isDeleted: false,
      },
    });
    if (existing) throw new Error("A report already exists for this booking");

    const now = BigInt(Date.now());
    return prisma.staffReport.create({
      data: {
        organizationId: authUser.organizationId,
        userId: authUser.id,
        bookingId: data.bookingId,
        title: data.title,
        reportDate: parseDate(data.reportDate),
        description: data.description,
        remarks: data.remarks || null,
        incidentDetails: data.incidentDetails || null,
        delayInformation: data.delayInformation || null,
        status: STAFF_REPORT_STATUS.DRAFT,
        createdAt: now,
        updatedAt: now,
      },
      include: includeReportDetails,
    });
  },

  updateReport: async (id, data, authUser) => {
    assertStaff(authUser);
    const report = await prisma.staffReport.findFirst({
      where: {
        id,
        userId: authUser.id,
        organizationId: authUser.organizationId,
        isDeleted: false,
      },
    });
    if (!report) throw new Error("Report not found");
    if (report.status !== STAFF_REPORT_STATUS.DRAFT) {
      throw new Error("Submitted reports cannot be edited");
    }

    return prisma.staffReport.update({
      where: { id },
      data: {
        title: data.title || undefined,
        reportDate: data.reportDate ? parseDate(data.reportDate) : undefined,
        description: data.description || undefined,
        remarks: data.remarks !== undefined ? data.remarks : undefined,
        incidentDetails:
          data.incidentDetails !== undefined ? data.incidentDetails : undefined,
        delayInformation:
          data.delayInformation !== undefined ? data.delayInformation : undefined,
        updatedAt: BigInt(Date.now()),
      },
      include: includeReportDetails,
    });
  },

  submitReport: async (id, authUser) => {
    assertStaff(authUser);
    const report = await prisma.staffReport.findFirst({
      where: {
        id,
        userId: authUser.id,
        organizationId: authUser.organizationId,
        isDeleted: false,
      },
      include: includeReportDetails,
    });
    if (!report) throw new Error("Report not found");
    if (report.status !== STAFF_REPORT_STATUS.DRAFT) {
      throw new Error("Report is already submitted");
    }

    const now = BigInt(Date.now());
    const updated = await prisma.staffReport.update({
      where: { id },
      data: {
        status: STAFF_REPORT_STATUS.SUBMITTED,
        submittedAt: now,
        updatedAt: now,
      },
      include: includeReportDetails,
    });

    await notificationService.notify({
      organizationId: authUser.organizationId,
      userId: authUser.id,
      title: "Report submitted",
      message: `Report "${updated.title}" was submitted successfully.`,
      type: "REPORT_SUBMITTED",
      relatedBookingId: updated.bookingId,
      relatedParticipantId: updated.booking?.participant?.id,
    });

    return updated;
  },

  getReportById: async (id, authUser) => {
    const where = {
      id,
      organizationId: authUser.organizationId,
      isDeleted: false,
    };

    if (authUser.role === "STAFF") {
      where.userId = authUser.id;
    } else if (!["NPO_ADMIN", "COORDINATOR"].includes(authUser.role)) {
      throw new Error("Not authorized to view reports");
    }

    const report = await prisma.staffReport.findFirst({
      where,
      include: includeReportDetails,
    });
    if (!report) throw new Error("Report not found");
    return report;
  },
};

module.exports = staffReportService;
