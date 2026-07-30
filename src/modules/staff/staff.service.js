const prisma = require("../../config/db");
const bcrypt = require("bcryptjs");
const { STAFF_MANAGEMENT_ROLES } = require("./staff.constants");
const {
  validateCreateStaff,
  validateUpdateStaff,
} = require("./staff.validation");

const assertStaffRole = (authUser) => {
  if (authUser.role !== "STAFF") {
    throw new Error("Only staff users can access this resource");
  }
};

const assertStaffManagementRole = (authUser) => {
  if (!STAFF_MANAGEMENT_ROLES.includes(authUser.role)) {
    throw new Error("Only NPO admin or coordinator can manage staff");
  }
};

const parseDateToMs = (value, endOfDay = false) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date filter");
  }

  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }

  return BigInt(date.getTime());
};

const getAgeFromDob = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(Number(dateOfBirth));
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age;
};

const STAFF_SAFE_SELECT = {
  id: true,
  fullName: true,
  profileImage: true,
  email: true,
  phone: true,
  emergencyContactPhone: true,
  role: true,
  serviceType: true,
  status: true,
  organizationId: true,
  designationId: true,
  dateOfBirth: true,
  dateOfJoining: true,
  address: true,
  createdAt: true,
  updatedAt: true,
  designation: {
    select: { id: true, name: true, serviceType: true, roleType: true },
  },
};

const staffService = {
  createStaff: async (data, authUser) => {
    assertStaffManagementRole(authUser);
    validateCreateStaff(data);

    const now = BigInt(Date.now());

    const existingStaff = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingStaff) throw new Error("Staff email already exists");

    if (data.designationId) {
      const designation = await prisma.staffRole.findFirst({
        where: {
          id: data.designationId,
          organizationId: authUser.organizationId,
          status: true,
        },
      });
      if (!designation) throw new Error("Invalid designation");
    }

    const staffPassword = await bcrypt.hash(data.phone, 10);

    return prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email,
        password: staffPassword,
        phone: data.phone,
        alternatePhone: data.alternatePhone || null,
        role: "STAFF",
        designationId: data.designationId || null,
        organizationId: authUser.organizationId,
        createdBy: authUser.id,
        status: true,
        emailVerifiedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      select: STAFF_SAFE_SELECT,
    });
  },

  getStaff: async (authUser) => {
    assertStaffManagementRole(authUser);

    const where = {
      role: "STAFF",
      isDeleted: false,
      organizationId: authUser.organizationId,
    };

    if (authUser.role === "COORDINATOR" && authUser.designationId) {
      where.designationId = authUser.designationId;
    }

    return prisma.user.findMany({
      where,
      select: STAFF_SAFE_SELECT,
      orderBy: { createdAt: "desc" },
    });
  },

  getStaffById: async (id, authUser) => {
    assertStaffManagementRole(authUser);

    const staff = await prisma.user.findFirst({
      where: {
        id,
        role: "STAFF",
        isDeleted: false,
        organizationId: authUser.organizationId,
      },
      select: STAFF_SAFE_SELECT,
    });

    if (!staff) throw new Error("Staff not found");
    return staff;
  },

  updateStaff: async (id, data, authUser) => {
    assertStaffManagementRole(authUser);
    validateUpdateStaff(data);

    const staff = await prisma.user.findFirst({
      where: {
        id,
        role: "STAFF",
        isDeleted: false,
        organizationId: authUser.organizationId,
      },
    });
    if (!staff) throw new Error("Staff not found");

    if (data.designationId) {
      const designation = await prisma.staffRole.findFirst({
        where: {
          id: data.designationId,
          organizationId: authUser.organizationId,
          status: true,
        },
      });
      if (!designation) throw new Error("Invalid designation");
    }

    return prisma.user.update({
      where: { id },
      data: {
        fullName: data.fullName || undefined,
        phone: data.phone || undefined,
        alternatePhone:
          data.alternatePhone !== undefined ? data.alternatePhone : undefined,
        designationId:
          data.designationId !== undefined ? data.designationId : undefined,
        status: data.status !== undefined ? data.status : undefined,
        updatedAt: BigInt(Date.now()),
      },
      select: STAFF_SAFE_SELECT,
    });
  },

  deleteStaff: async (id, authUser) => {
    assertStaffManagementRole(authUser);

    const staff = await prisma.user.findFirst({
      where: {
        id,
        role: "STAFF",
        isDeleted: false,
        organizationId: authUser.organizationId,
      },
    });
    if (!staff) throw new Error("Staff not found");

    return prisma.user.update({
      where: { id },
      data: {
        isDeleted: true,
        status: false,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  getMyTasks: async (authUser, query = {}) => {
    assertStaffRole(authUser);

    const bookingDateFilter = {};

    if (query.date) {
      bookingDateFilter.gte = parseDateToMs(query.date);
      bookingDateFilter.lte = parseDateToMs(query.date, true);
    } else {
      if (query.from) {
        bookingDateFilter.gte = parseDateToMs(query.from);
      }
      if (query.to) {
        bookingDateFilter.lte = parseDateToMs(query.to, true);
      }
    }

    const bookingFilter = {};
    if (Object.keys(bookingDateFilter).length > 0) {
      bookingFilter.bookingDate = bookingDateFilter;
    }

    return prisma.bookingStaffAssignment.findMany({
      where: {
        userId: authUser.id,
        organizationId: authUser.organizationId,
        status: { not: "CANCELLED" },
        booking: bookingFilter,
      },
      include: {
        booking: {
          select: {
            id: true,
            bookingCode: true,
            serviceType: true,
            bookingDate: true,
            startTime: true,
            endTime: true,
            // The driver needs the pickup point and someone to call from the
            // field — a task card without these sends them back to the office.
            pickupAddress: true,
            pickupLat: true,
            pickupLng: true,
            requiredSeats: true,
            notes: true,
            participant: {
              select: { id: true, fullName: true, phone: true },
            },
            guardian: {
              select: { id: true, fullName: true, phone: true },
            },
            venue: {
              select: { id: true, name: true, address: true },
            },
            vehicle: {
              select: {
                id: true,
                vehicleName: true,
                vehicleNumber: true,
                capacity: true,
              },
            },
          },
        },
      },
      orderBy: [{ booking: { bookingDate: "asc" } }, { createdAt: "asc" }],
    });
  },

  getMyParticipants: async (authUser) => {
    assertStaffRole(authUser);

    const assignments = await prisma.bookingStaffAssignment.findMany({
      where: {
        userId: authUser.id,
        organizationId: authUser.organizationId,
        status: { not: "CANCELLED" },
      },
      include: {
        booking: {
          select: {
            serviceType: true,
            participant: {
              select: {
                id: true,
                fullName: true,
                gender: true,
                dateOfBirth: true,
                medicalNotes: true,
                allergyNotes: true,
                emergencyInstructions: true,
              },
            },
            guardian: { select: { fullName: true } },
          },
        },
      },
    });

    const participantsMap = new Map();

    assignments.forEach((assignment) => {
      const participant = assignment.booking?.participant;
      if (!participant || participantsMap.has(participant.id)) return;

      participantsMap.set(participant.id, {
        id: participant.id,
        fullName: participant.fullName,
        age: getAgeFromDob(participant.dateOfBirth),
        gender: participant.gender,
        guardianName: assignment.booking?.guardian?.fullName || null,
        serviceType: assignment.booking?.serviceType || null,
        supportRequirements:
          participant.medicalNotes ||
          participant.allergyNotes ||
          participant.emergencyInstructions ||
          null,
      });
    });

    return Array.from(participantsMap.values());
  },

  getStaffDashboard: async (authUser) => {
    assertStaffRole(authUser);

    const staff = await prisma.user.findFirst({
      where: {
        id: authUser.id,
        role: "STAFF",
        organizationId: authUser.organizationId,
      },
      select: {
        fullName: true,
        role: true,
        designation: {
          select: { id: true, name: true, serviceType: true, roleType: true },
        },
      },
    });
    if (!staff) throw new Error("Staff not found");

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const todayStart = BigInt(dayStart.getTime());
    const tomorrowStart = BigInt(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [
      allAssignments,
      todayTasks,
      pendingTasks,
      inProgressTasks,
      completedTasks,
      upcomingSchedules,
      attendance,
    ] = await Promise.all([
      prisma.bookingStaffAssignment.findMany({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          status: { not: "CANCELLED" },
        },
        select: {
          booking: { select: { participantId: true } },
        },
      }),
      prisma.bookingStaffAssignment.count({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          status: { not: "CANCELLED" },
          booking: {
            bookingDate: {
              gte: todayStart,
              lt: tomorrowStart,
            },
          },
        },
      }),
      prisma.bookingStaffAssignment.count({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          status: "ASSIGNED",
        },
      }),
      prisma.bookingStaffAssignment.count({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          startedAt: { not: null },
          completedAt: null,
          status: { not: "CANCELLED" },
        },
      }),
      prisma.bookingStaffAssignment.count({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          OR: [{ status: "COMPLETED" }, { completedAt: { not: null } }],
        },
      }),
      prisma.bookingStaffAssignment.findMany({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          status: { not: "CANCELLED" },
          booking: {
            bookingDate: { gt: todayStart },
          },
        },
        include: {
          booking: {
            select: {
              id: true,
              serviceType: true,
              bookingDate: true,
              startTime: true,
              endTime: true,
              participant: { select: { id: true, fullName: true } },
              guardian: { select: { id: true, fullName: true } },
              venue: { select: { id: true, name: true, address: true } },
              vehicle: {
                select: { id: true, vehicleName: true, vehicleNumber: true },
              },
            },
          },
        },
        orderBy: [{ booking: { bookingDate: "asc" } }, { createdAt: "asc" }],
        take: 5,
      }),
      prisma.staffAttendance.findFirst({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          attendanceDate: todayStart,
          isDeleted: false,
        },
      }),
    ]);

    const assignedParticipants = new Set(
      allAssignments
        .map((assignment) => assignment.booking?.participantId)
        .filter(Boolean),
    );

    return {
      staffName: staff.fullName,
      role: staff.role,
      designation: staff.designation || null,
      todayTasks,
      pendingTasks,
      inProgressTasks,
      completedTasks,
      assignedParticipants: assignedParticipants.size,
      attendanceStatus: attendance?.attendanceStatus || null,
      upcomingSchedules,
    };
  },
};

module.exports = staffService;
