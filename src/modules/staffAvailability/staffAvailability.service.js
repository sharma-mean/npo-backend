const prisma = require("../../config/db");
const { overlapWhere } = require("../../utils/timeOverlap");
const { logAudit } = require("../../utils/auditLogger");

const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

/**
 * Resolve which staff a record applies to. Staff manage their own; managers
 * may manage anyone's in their org.
 */
const resolveTargetUser = async (requestedUserId, authData) => {
  if (!requestedUserId || requestedUserId === authData.id) {
    return authData.id;
  }
  if (!MANAGER_ROLES.includes(authData.role)) {
    throw new Error("You can only manage your own availability");
  }
  const target = await prisma.user.findFirst({
    where: {
      id: requestedUserId,
      organizationId: authData.organizationId,
      isDeleted: false,
    },
  });
  if (!target) throw new Error("Staff user not found");
  return target.id;
};

const createAvailability = async (data, authData) => {
  if (!data.startTime || !data.endTime) {
    throw new Error("startTime and endTime are required");
  }
  if (Number(data.endTime) <= Number(data.startTime)) {
    throw new Error("endTime must be after startTime");
  }

  const userId = await resolveTargetUser(data.userId, authData);
  const now = BigInt(Date.now());

  const record = await prisma.staffAvailability.create({
    data: {
      organizationId: authData.organizationId,
      userId,
      startTime: BigInt(data.startTime),
      endTime: BigInt(data.endTime),
      reason: data.reason || null,
      createdAt: now,
      updatedAt: now,
    },
  });

  await logAudit({
    authData,
    action: "CREATE",
    entity: "StaffAvailability",
    entityId: record.id,
    after: record,
  });

  // Conflict check: if this new unavailable window overlaps bookings the staff
  // is ALREADY assigned to, flag managers so they can re-assign (we don't auto-
  // cancel — the manager decides). Best-effort; never blocks the record.
  try {
    const conflicts = await prisma.bookingStaffAssignment.findMany({
      where: {
        userId,
        organizationId: authData.organizationId,
        status: { not: "CANCELLED" },
        booking: {
          status: { in: ["PENDING", "APPROVED"] },
          ...overlapWhere(BigInt(data.startTime), BigInt(data.endTime)),
        },
      },
      select: { bookingId: true, booking: { select: { bookingCode: true } } },
    });
    if (conflicts.length > 0) {
      const staff = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
      const managers = await prisma.user.findMany({
        where: { organizationId: authData.organizationId, role: { in: ["NPO_ADMIN", "COORDINATOR"] }, status: true, isDeleted: false },
        select: { id: true },
      });
      if (managers.length > 0) {
        const notificationService = require("../notification/notification.service");
        await notificationService.notifyMany(
          managers.map((m) => m.id),
          {
            organizationId: authData.organizationId,
            type: "STAFF_UNAVAILABLE",
            title: "Staff unavailability conflicts with assignments",
            message: `${staff?.fullName || "A staff member"} marked unavailable but is assigned to ${conflicts.length} booking(s) in that window (${conflicts.map((c) => c.booking?.bookingCode).filter(Boolean).join(", ")}). Please re-assign.`,
            relatedBookingId: conflicts[0].bookingId,
          },
        );
      }
    }
  } catch (err) {
    console.error("[availability] conflict flag failed:", err.message);
  }

  return record;
};

const getAvailability = async (authData, filters = {}) => {
  const where = {
    organizationId: authData.organizationId,
    isDeleted: false,
  };
  // Staff see own; managers may filter by userId or see all
  if (!MANAGER_ROLES.includes(authData.role)) {
    where.userId = authData.id;
  } else if (filters.userId) {
    where.userId = filters.userId;
  }

  return prisma.staffAvailability.findMany({
    where,
    include: { user: { select: { id: true, fullName: true } } },
    orderBy: { startTime: "asc" },
    take: 200,
  });
};

const deleteAvailability = async (id, authData) => {
  const existing = await prisma.staffAvailability.findFirst({
    where: { id, organizationId: authData.organizationId, isDeleted: false },
  });
  if (!existing) throw new Error("Availability record not found");

  if (
    existing.userId !== authData.id &&
    !MANAGER_ROLES.includes(authData.role)
  ) {
    throw new Error("Not authorized to delete this record");
  }

  const deleted = await prisma.staffAvailability.update({
    where: { id },
    data: { isDeleted: true, updatedAt: BigInt(Date.now()) },
  });

  await logAudit({
    authData,
    action: "DELETE",
    entity: "StaffAvailability",
    entityId: id,
    before: existing,
  });
  return deleted;
};

/**
 * Is a staff member marked unavailable during [startTime, endTime)?
 * Reused by booking-staff-assignment to block assignment.
 */
const isUnavailable = async (userId, startTime, endTime, organizationId) => {
  const hit = await prisma.staffAvailability.findFirst({
    where: {
      userId,
      organizationId,
      isDeleted: false,
      ...overlapWhere(startTime, endTime),
    },
  });
  return !!hit;
};

module.exports = {
  createAvailability,
  getAvailability,
  deleteAvailability,
  isUnavailable,
};
