const prisma = require("../../config/db");

const { WORKING_HOURS } = require("./staffAttendance.constants");

/**
 * Midnight of the current attendance day, as a BigInt epoch-ms.
 *
 * This is the ONE definition of "today" for attendance. It must be, because the
 * value is stored on the row and later compared for exact equality: a client
 * that computes its own midnight gets a different number (the phone is in JST,
 * the server runs UTC on Vercel), never matches today's row, and shows "Check
 * in" to somebody who already checked in.
 */
const attendanceDayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return BigInt(d.getTime());
};


const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

const staffAttandanceService = {
  checkIn: async (data, authData) => {
    const user = await prisma.user.findUnique({
      where: {
        id: authData.id,
      },
    });

    if (!user) {
      throw new Error("Staff not found");
    }

    if (user.role !== "STAFF") {
      throw new Error("Only staff can check-in");
    }

    if (!user.status) {
      throw new Error("Inactive staff cannot check-in");
    }

    const attendanceDate = attendanceDayStart();

    const alreadyCheckedIn = await prisma.staffAttendance.findFirst({
      where: {
        userId: authData.id,
        organizationId: authData.organizationId,
        attendanceDate,
        isDeleted: false,
      },
    });

    if (alreadyCheckedIn) {
      throw new Error("Staff already checked-in today");
    }

    const now = BigInt(Date.now());

    const attendance = await prisma.staffAttendance.create({
      data: {
        organizationId: authData.organizationId,

        userId: authData.id,

        serviceType: authData.serviceType,

        attendanceDate,

        checkInAt: now,

        attendanceStatus: "CHECKED_IN",

        checkInLatitude: data.checkInLatitude,

        checkInLongitude: data.checkInLongitude,

        checkInAddress: data.checkInAddress,

        remarks: data.remarks,

        createdAt: now,

        updatedAt: now,
      },
    });

    return attendance;
  },

  // checkOut: async (attendanceId, data) => {
  //   const attendance = await prisma.staffAttendance.findUnique({
  //     where: {
  //       id: attendanceId,
  //     },
  //   });

  //   if (!attendance) {
  //     throw new Error("Attendance not found");
  //   }

  //   if (attendance.checkOutAt) {
  //     throw new Error("Already checked-out");
  //   }

  //   const now = BigInt(Date.now());

  //   const totalWorkingMinutes = Math.floor(
  //     Number(now - attendance.checkInAt) / 60000,
  //   );

  //   const overtimeMinutes =
  //     totalWorkingMinutes > WORKING_HOURS.DAILY_WORKING_MINUTES
  //       ? totalWorkingMinutes - WORKING_HOURS.DAILY_WORKING_MINUTES
  //       : 0;

  //   return await prisma.staffAttendance.update({
  //     where: {
  //       id: attendanceId,
  //     },

  //     data: {
  //       checkOutAt: now ,

  //       checkOutLatitude: data.checkOutLatitude,

  //       checkOutLongitude: data.checkOutLongitude,

  //       checkOutAddress: data.checkOutAddress,

  //       totalWorkingMinutes,

  //       attendanceStatus: "CHECKED_OUT",

  //       overtimeMinutes,

  //       updatedAt: now,
  //     },
  //   });
  // },

  checkOut: async (authData, data) => {
    // Close the latest OPEN attendance (checked in, not yet checked out).
    // Filtering on the open row — not just the latest row — means a staff
    // member who never checked in today gets "check in first" instead of the
    // stale previous row's "already checked out"; an open overnight shift
    // (checked in yesterday evening) still checks out correctly.
    const attendance = await prisma.staffAttendance.findFirst({
      where: {
        userId: authData.id,
        organizationId: authData.organizationId,
        isDeleted: false,
        checkInAt: { not: null },
        checkOutAt: null,
      },
      orderBy: {
        attendanceDate: "desc",
      },
    });
    if (!attendance) {
      throw new Error("Please check in first");
    }

    const now = BigInt(Date.now());

    const totalWorkingMinutes = Math.floor(
      Number(now - attendance.checkInAt) / 60000,
    );

    const overtimeMinutes =
      totalWorkingMinutes > WORKING_HOURS.DAILY_WORKING_MINUTES
        ? totalWorkingMinutes - WORKING_HOURS.DAILY_WORKING_MINUTES
        : 0;

    return await prisma.staffAttendance.update({
      where: {
        id: attendance.id,
      },
      data: {
        checkOutAt: now,
        checkOutLatitude: data.checkOutLatitude,
        checkOutLongitude: data.checkOutLongitude,
        checkOutAddress: data.checkOutAddress,
        totalWorkingMinutes,
        overtimeMinutes,
        attendanceStatus: "CHECKED_OUT",
        updatedAt: now,
      },
    });
  },
  getMyAttendance: async (userId, authData) => {
    // Only managers may view another user's attendance; everyone else is
    // restricted to their own records.
    if (!MANAGER_ROLES.includes(authData.role) && authData.id !== userId) {
      throw new Error("Not authorized to view this attendance");
    }

    const records = await prisma.staffAttendance.findMany({
      where: {
        userId,
        organizationId: authData.organizationId,
        isDeleted: false,
      },

      orderBy: {
        attendanceDate: "desc",
      },
    });

    // The server owns what "today" means (see attendanceDayStart) — say so
    // explicitly rather than letting each client re-derive it from its own
    // clock and timezone.
    const today = attendanceDayStart();
    return records.map((r) => ({ ...r, isToday: r.attendanceDate === today }));
  },

  getAllStaffAttendance: async (authData, filters = {}) => {
    // Org-wide attendance is a manager-only view.
    if (!MANAGER_ROLES.includes(authData.role)) {
      throw new Error("Not authorized to view all attendance");
    }

    const take = Math.min(Math.max(Number(filters.take) || 100, 1), 200);
    const skip = Math.max(Number(filters.skip) || 0, 0);

    return await prisma.staffAttendance.findMany({
      where: {
        organizationId: authData.organizationId,
        isDeleted: false,
      },
      take,
      skip,
      orderBy: {
        attendanceDate: "desc",
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            designation: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });
  },

  getMonthlySummary: async (userId, authData) => {
    if (!MANAGER_ROLES.includes(authData.role) && authData.id !== userId) {
      throw new Error("Not authorized to view this attendance");
    }

    const attendances = await prisma.staffAttendance.findMany({
      where: {
        userId,
        organizationId: authData.organizationId,

        isDeleted: false,
      },

      orderBy: {
        attendanceDate: "desc",
      },
    });

    let presentDays = 0;

    let leaveDays = 0;

    let totalWorkingMinutes = 0;

    let totalOvertimeMinutes = 0;

    const attendanceHistory = [];

    let halfDays = 0;
    attendances.forEach((item) => {
      if (item.attendanceStatus === "CHECKED_OUT") {
        presentDays += 1;
      }

      if (item.attendanceStatus === "LEAVE") {
        leaveDays += 1;
      }

      // A half-day counts as half present + half leave (SOW §12 / payroll).
      if (item.attendanceStatus === "HALF_DAY") {
        halfDays += 1;
        presentDays += 0.5;
        leaveDays += 0.5;
      }

      totalWorkingMinutes += item.totalWorkingMinutes;

      totalOvertimeMinutes += item.overtimeMinutes;

      attendanceHistory.push({
        attendanceDate: item.attendanceDate,

        serviceType: item.serviceType,

        attendanceStatus: item.attendanceStatus,

        checkInAt: item.checkInAt,

        checkOutAt: item.checkOutAt,

        totalWorkingMinutes: item.totalWorkingMinutes,

        overtimeMinutes: item.overtimeMinutes,

        leaveReason: item.leaveReason,

        operationalRemark: item.operationalRemark,
      });
    });

    return {
      presentDays,

      leaveDays,

      halfDays,

      totalWorkingMinutes,

      totalOvertimeMinutes,

      attendanceHistory,
    };
  },

  applyEmergencyLeave: async (data, authData) => {
    // Org + actor come from the authenticated user — never the request body
    // (prevents cross-tenant writes / applying leave for arbitrary users).
    // Managers may file leave for a staff member in their org; staff for self.
    const isManager = MANAGER_ROLES.includes(authData.role);
    const targetUserId = isManager && data.userId ? data.userId : authData.id;

    const user = await prisma.user.findFirst({
      where: {
        id: targetUserId,
        organizationId: authData.organizationId,
        role: "STAFF",
        isDeleted: false,
      },
    });
    if (!user) throw new Error("Staff not found");
    if (!isManager && authData.id !== targetUserId) {
      throw new Error("Not authorized to apply leave for another user");
    }
    if (!data.leaveReason) throw new Error("leaveReason is required");

    // Status can be a full-day LEAVE or a HALF_DAY (SOW §12); an optional
    // structured operational tag categorises it for reports/payroll.
    const ALLOWED_STATUS = ["LEAVE", "HALF_DAY"];
    const ALLOWED_REMARKS = [
      "ON_LEAVE", "EMERGENCY_ABSENCE", "REDUCED_HOURS",
      "SHIFT_REPLACEMENT", "SICK_LEAVE", "HALF_DAY",
    ];
    const status = ALLOWED_STATUS.includes(data.status) ? data.status : "LEAVE";
    let operationalRemark = null;
    if (data.operationalRemark) {
      if (!ALLOWED_REMARKS.includes(data.operationalRemark)) {
        throw new Error("Invalid operationalRemark");
      }
      operationalRemark = data.operationalRemark;
    }

    let attendanceDate = null;
    if (data.date) {
      const parsed = new Date(data.date);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error("Invalid date format");
      }
      parsed.setHours(0, 0, 0, 0);
      attendanceDate = BigInt(parsed.getTime());
    } else {
      attendanceDate = attendanceDayStart();
    }

    const existingAttendance = await prisma.staffAttendance.findFirst({
      where: {
        userId: targetUserId,
        organizationId: authData.organizationId,
        attendanceDate,
      },
    });
    if (existingAttendance) {
      throw new Error("Attendance already exists for this date");
    }

    const now = BigInt(Date.now());

    return await prisma.staffAttendance.create({
      data: {
        organizationId: authData.organizationId,
        userId: targetUserId,
        serviceType: user.serviceType,
        attendanceDate,
        attendanceStatus: status,
        leaveReason: data.leaveReason,
        operationalRemark,
        createdAt: now,
        updatedAt: now,
      },
    });
  },

  deleteAttendance: async (id, authData) => {
    if (!MANAGER_ROLES.includes(authData.role)) {
      throw new Error("Not authorized to delete attendance records");
    }

    const record = await prisma.staffAttendance.findFirst({
      where: {
        id,
        organizationId: authData.organizationId,
        isDeleted: false,
      },
    });

    if (!record) {
      throw new Error("Attendance record not found");
    }

    if (record.attendanceDate < attendanceDayStart()) {
      throw new Error("Cannot delete past attendance records");
    }

    const now = BigInt(Date.now());
    return await prisma.staffAttendance.update({
      where: { id },
      data: {
        isDeleted: true,
        updatedAt: now,
      },
    });
  },

  createOperationalReport: async (data, authData, reportType) => {
    const user = await prisma.user.findFirst({
      where: {
        id: authData.id,
        organizationId: authData.organizationId,
        role: "STAFF",
        isDeleted: false,
      },
    });

    if (!user) {
      throw new Error("Staff not found");
    }

    if (!data.title) {
      throw new Error("title is required");
    }

    if (!data.description) {
      throw new Error("description is required");
    }

    return {
      id: `${reportType}-${Date.now()}`,
      reportType,
      organizationId: authData.organizationId,
      userId: authData.id,
      title: data.title,
      description: data.description,
      remarks: data.remarks || null,
      createdAt: BigInt(Date.now()),
      persisted: false,
    };
  },
};
module.exports = staffAttandanceService;
