const prisma = require("../../config/db");

const {
  ASSIGNMENT_STATUS,
  ASSIGNMENT_ROLES,
  INACTIVE_STATUSES,
} = require("./bookingStaffAssignment.constants");
const availabilityService = require("../staffAvailability/staffAvailability.service");
const notificationService = require("../notification/notification.service");
const complianceService = require("../document/compliance.service");
const { logAudit } = require("../../utils/auditLogger");
const { clearLocation } = require("./location.service");

// assignments in these states block the staff member's time slot. A
// PENDING_ACCEPTANCE assignment already holds the slot (soft gate) so the staff
// member can't be double-booked while a task awaits their acknowledgement.
const ACTIVE_STATUSES = [
  ASSIGNMENT_STATUS.PENDING_ACCEPTANCE,
  ASSIGNMENT_STATUS.ASSIGNED,
  ASSIGNMENT_STATUS.START,
];

// Block a lifecycle transition when the parent booking has been killed
// (CANCELLED/REJECTED) — staff shouldn't progress / notify on a dead booking.
const assertBookingNotDead = async (bookingId) => {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { status: true },
  });
  if (!booking || ["CANCELLED", "REJECTED"].includes(booking.status)) {
    throw new Error("This booking is no longer active");
  }
};

// Notify the booking's guardian when staff advance the task lifecycle.
// Best-effort: never throws into the status transition.
const TASK_PHASE_COPY = {
  START: { title: "Service started", message: "is now on the way / has started" },
  END: { title: "Service ended", message: "has ended" },
  COMPLETED: { title: "Service completed", message: "is complete" },
};
// Enum values read as shouting in a message body ("Your MOBILITY service …").
const SERVICE_LABEL = {
  MOBILITY: "mobility",
  RECREATION: "recreation",
  DAYCARE: "daycare",
};
const notifyGuardianTask = async (bookingId, phase) => {
  try {
    const copy = TASK_PHASE_COPY[phase];
    if (!copy) return;
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, organizationId: true, guardianId: true, serviceType: true },
    });
    if (!booking) return;
    const guardian = await prisma.user.findUnique({
      where: { id: booking.guardianId },
      select: { id: true, email: true },
    });
    if (!guardian) return;
    await notificationService.notify({
      userId: guardian.id,
      organizationId: booking.organizationId,
      type: "BOOKING_PROGRESS",
      title: copy.title,
      message: `Your ${SERVICE_LABEL[booking.serviceType] || booking.serviceType} service ${copy.message}.`,
      relatedBookingId: booking.id,
      email: guardian.email,
      emailSubject: copy.title,
    });
  } catch (err) {
    console.error("[assignment] guardian notify failed:", err.message);
  }
};

// Tell every manager (NPO_ADMIN/COORDINATOR) in the org that a staff member
// declined a task, so it can be reassigned. Best-effort — never throws.
const notifyManagersOfDecline = async (assignment, staff, reason) => {
  try {
    const booking = await prisma.booking.findUnique({
      where: { id: assignment.bookingId },
      select: { id: true, serviceType: true, bookingCode: true },
    });
    const managers = await prisma.user.findMany({
      where: {
        organizationId: assignment.organizationId,
        role: { in: ["NPO_ADMIN", "COORDINATOR"] },
        status: true,
        isDeleted: false,
      },
      select: { id: true, email: true },
    });
    const staffName = staff?.fullName || "A staff member";
    await Promise.allSettled(
      managers.map((m) =>
        notificationService.notify({
          userId: m.id,
          organizationId: assignment.organizationId,
          type: "ASSIGNMENT_DECLINED",
          title: "Staff declined a task",
          message: `${staffName} declined a ${booking?.serviceType || ""} booking. Reason: ${reason}. Please reassign.`,
          relatedBookingId: assignment.bookingId,
          email: m.email,
          emailSubject: "A staff member declined a task",
        }),
      ),
    );
  } catch (err) {
    console.error("[assignment] manager decline notify failed:", err.message);
  }
};

const canManageAssignment = (assignment, authUser) => {
  if (assignment.organizationId !== authUser.organizationId) {
    return false;
  }

  if (["NPO_ADMIN", "COORDINATOR"].includes(authUser.role)) {
    return true;
  }

  if (authUser.role === "STAFF") {
    return assignment.userId === authUser.id;
  }

  return false;
};

const bookingStaffAssignmentService = {
  createAssignment: async (data, authUser) => {
    const { bookingId, userId, assignmentRole, remarks } = data;

    if (!bookingId) throw new Error("Booking is required");
    if (!userId) throw new Error("Staff is required");
    if (!assignmentRole || !ASSIGNMENT_ROLES[assignmentRole]) {
      throw new Error("Valid assignment role is required");
    }

    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, organizationId: authUser.organizationId },
    });

    if (!booking) {
      throw new Error("Booking not found");
    }

    if (booking.status !== "APPROVED") {
      throw new Error("Booking must be approved first");
    }

    const user = await prisma.user.findFirst({
      where: {
        id: userId,
        organizationId: authUser.organizationId,
        isDeleted: false,
      },
      include: {
        designation: true,
      },
    });

    if (!user) {
      throw new Error("Staff not found");
    }

    if (user.role !== "STAFF") {
      throw new Error("Selected user is not staff");
    }

    if (!user.status) {
      throw new Error("Staff is inactive");
    }

    // staff's designation must match the assignment role (OTHER accepts anyone)
    if (
      assignmentRole !== ASSIGNMENT_ROLES.OTHER &&
      user.designation?.roleType !== assignmentRole
    ) {
      throw new Error(
        `Selected staff is not a ${assignmentRole.replace("_", " ").toLowerCase()}`,
      );
    }

    // Compliance gate: never put someone behind the wheel on an expired licence.
    // Only blocks when a licence is actually on file and has lapsed — an org
    // that hasn't uploaded one yet is not locked out.
    if (assignmentRole === ASSIGNMENT_ROLES.DRIVER) {
      await complianceService.assertStaffCanDrive(authUser.organizationId, userId);
    }

    const alreadyAssigned = await prisma.bookingStaffAssignment.findFirst({
      where: {
        bookingId,
        userId,
        status: { notIn: INACTIVE_STATUSES },
      },
    });

    if (alreadyAssigned) {
      throw new Error("Staff already assigned to this booking");
    }

    // time conflict: staff already has an active assignment on an approved
    // booking whose time window overlaps this one
    const conflict = await prisma.bookingStaffAssignment.findFirst({
      where: {
        userId,
        status: { in: ACTIVE_STATUSES },
        booking: {
          status: "APPROVED",
          startTime: { lt: booking.endTime },
          endTime: { gt: booking.startTime },
        },
      },
      include: {
        booking: true,
      },
    });

    if (conflict) {
      const from = new Date(Number(conflict.booking.startTime));
      const to = new Date(Number(conflict.booking.endTime));
      throw new Error(
        `Staff has a conflicting booking from ${from.toLocaleString()} to ${to.toLocaleString()}`,
      );
    }

    // staff must not have marked themselves unavailable for this window
    const unavailable = await availabilityService.isUnavailable(
      userId,
      booking.startTime,
      booking.endTime,
      authUser.organizationId,
    );
    if (unavailable) {
      throw new Error("Staff is marked unavailable during this time window");
    }

    const now = BigInt(Date.now());

    const assignment = await prisma.bookingStaffAssignment.create({
      data: {
        organizationId: authUser.organizationId,
        bookingId,
        userId,
        assignmentRole,
        status: ASSIGNMENT_STATUS.PENDING_ACCEPTANCE,
        assignedBy: authUser.id,
        remarks,
        assignedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      include: {
        user: { select: { id: true, fullName: true, profileImage: true, email: true, phone: true, role: true, serviceType: true, status: true, organizationId: true, designationId: true, designation: true } },
      },
    });

    // Tell the staff member they've been assigned (in-app + email).
    try {
      await notificationService.notify({
        userId,
        organizationId: authUser.organizationId,
        type: "ASSIGNMENT_CREATED",
        title: "New task — please accept or decline",
        message: `You've been assigned to a ${booking.serviceType} booking. Open the task to accept or decline it.`,
        relatedBookingId: bookingId,
        email: assignment.user?.email,
        emailSubject: "You have a new assigned task",
      });
    } catch (err) {
      console.error("[assignment] staff notify failed:", err.message);
    }

    return assignment;
  },

  // staff of this org eligible for a booking slot, annotated with availability
  getAvailableStaff: async (bookingId, assignmentRole, authUser) => {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, organizationId: authUser.organizationId },
    });

    if (!booking) {
      throw new Error("Booking not found");
    }

    const staffWhere = {
      organizationId: authUser.organizationId,
      role: "STAFF",
      status: true,
      isDeleted: false,
    };

    if (assignmentRole && assignmentRole !== ASSIGNMENT_ROLES.OTHER) {
      staffWhere.designation = { roleType: assignmentRole };
    }

    const staff = await prisma.user.findMany({
      where: staffWhere,
      include: { designation: true },
      orderBy: { fullName: "asc" },
    });

    if (staff.length === 0) return [];

    const staffIds = staff.map((s) => s.id);

    const [conflicts, existingAssignments] = await Promise.all([
      prisma.bookingStaffAssignment.findMany({
        where: {
          userId: { in: staffIds },
          status: { in: ACTIVE_STATUSES },
          booking: {
            status: "APPROVED",
            startTime: { lt: booking.endTime },
            endTime: { gt: booking.startTime },
          },
        },
        select: { userId: true, bookingId: true },
      }),
      prisma.bookingStaffAssignment.findMany({
        where: {
          bookingId,
          userId: { in: staffIds },
          // A staff member who DECLINED can be re-offered the task, so a
          // declined row must not mark them isAlreadyAssigned.
          status: { notIn: INACTIVE_STATUSES },
        },
        select: { userId: true },
      }),
    ]);

    const busyIds = new Set(
      conflicts.filter((c) => c.bookingId !== bookingId).map((c) => c.userId),
    );
    const assignedIds = new Set(existingAssignments.map((a) => a.userId));

    // staff who marked themselves unavailable for this booking's window
    const unavailableRecords = await prisma.staffAvailability.findMany({
      where: {
        userId: { in: staffIds },
        organizationId: authUser.organizationId,
        isDeleted: false,
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
      },
      select: { userId: true },
    });
    const unavailableIds = new Set(unavailableRecords.map((u) => u.userId));

    return staff.map((s) => ({
      id: s.id,
      fullName: s.fullName,
      email: s.email,
      phone: s.phone,
      serviceType: s.serviceType,
      designation: s.designation
        ? { name: s.designation.name, roleType: s.designation.roleType }
        : null,
      isBusy: busyIds.has(s.id),
      isAlreadyAssigned: assignedIds.has(s.id),
      isUnavailable: unavailableIds.has(s.id),
    }));
  },

  getBookingAssignments: async (bookingId, authUser) => {
    return await prisma.bookingStaffAssignment.findMany({
      where: {
        bookingId,
        organizationId: authUser.organizationId,
      },
      include: {
        user: { select: { id: true, fullName: true, profileImage: true, email: true, phone: true, role: true, serviceType: true, status: true, organizationId: true, designationId: true, designation: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  getMyTasks: async (authUser, targetUserId) => {
    // Prevent IDOR: a non-manager can only read their OWN tasks regardless of
    // the :userId in the URL. Managers may query a specific staff member.
    const isManager = ["NPO_ADMIN", "COORDINATOR"].includes(authUser.role);
    const userId = isManager && targetUserId ? targetUserId : authUser.id;
    return await prisma.bookingStaffAssignment.findMany({
      where: {
        userId,
        organizationId: authUser.organizationId,
      },
      include: {
        booking: {
          include: {
            participant: { select: { id: true, fullName: true, profileImage: true } },
            venue: true,
            vehicle: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  // Staff acknowledges a task. Owner-only — a manager can't accept on a staff
  // member's behalf (that would defeat the point of the acknowledgement).
  acceptAssignment: async (id, authUser) => {
    const assignment = await prisma.bookingStaffAssignment.findUnique({
      where: { id },
    });
    if (!assignment) throw new Error("Assignment not found");
    if (assignment.organizationId !== authUser.organizationId ||
        assignment.userId !== authUser.id) {
      throw new Error("Only the assigned staff member can accept this task");
    }
    if (assignment.status !== ASSIGNMENT_STATUS.PENDING_ACCEPTANCE) {
      throw new Error("This task is not awaiting acceptance");
    }
    await assertBookingNotDead(assignment.bookingId);

    const now = BigInt(Date.now());
    const updated = await prisma.bookingStaffAssignment.update({
      where: { id },
      data: {
        status: ASSIGNMENT_STATUS.ASSIGNED,
        acceptedAt: now,
        updatedAt: now,
      },
    });
    await logAudit({
      authData: authUser,
      action: "STATUS_CHANGE",
      entity: "BookingStaffAssignment",
      entityId: id,
      before: { status: assignment.status },
      after: { status: updated.status },
    });
    return updated;
  },

  // Staff refuses a task, with a mandatory reason. Owner-only. Allowed while the
  // task is still PENDING_ACCEPTANCE or ASSIGNED (not once it's running). Flags
  // the booking for manager reassignment and drops out of the staffing tally.
  declineAssignment: async (id, reason, authUser) => {
    const trimmed = (reason || "").trim();
    if (!trimmed) throw new Error("A reason is required to decline a task");

    const assignment = await prisma.bookingStaffAssignment.findUnique({
      where: { id },
    });
    if (!assignment) throw new Error("Assignment not found");
    if (assignment.organizationId !== authUser.organizationId ||
        assignment.userId !== authUser.id) {
      throw new Error("Only the assigned staff member can decline this task");
    }
    if (![ASSIGNMENT_STATUS.PENDING_ACCEPTANCE, ASSIGNMENT_STATUS.ASSIGNED].includes(assignment.status)) {
      throw new Error("This task can no longer be declined");
    }

    const now = BigInt(Date.now());
    const updated = await prisma.bookingStaffAssignment.update({
      where: { id },
      data: {
        status: ASSIGNMENT_STATUS.DECLINED,
        declinedAt: now,
        declineReason: trimmed,
        updatedAt: now,
      },
      include: {
        user: { select: { id: true, fullName: true } },
      },
    });
    // Free the position if one was somehow shared, then flag managers.
    await clearLocation(id, { recordEnd: false });
    await notifyManagersOfDecline(assignment, updated.user, trimmed);
    await logAudit({
      authData: authUser,
      action: "STATUS_CHANGE",
      entity: "BookingStaffAssignment",
      entityId: id,
      before: { status: assignment.status },
      after: { status: updated.status },
      metadata: { declineReason: trimmed },
    });
    return updated;
  },

  startTask: async (id, authUser) => {
    const assignment = await prisma.bookingStaffAssignment.findUnique({
      where: { id },
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }
    if (!canManageAssignment(assignment, authUser)) {
      throw new Error("Not authorized for this assignment");
    }

    if (assignment.status === ASSIGNMENT_STATUS.PENDING_ACCEPTANCE) {
      throw new Error("Accept the task before starting it");
    }
    if (assignment.status === ASSIGNMENT_STATUS.DECLINED) {
      throw new Error("This task was declined");
    }
    if (assignment.status !== ASSIGNMENT_STATUS.ASSIGNED) {
      throw new Error("Task already started");
    }

    // Staff must check in first before starting a task
    if (authUser.role === "STAFF" && process.env.NODE_ENV !== "test") {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      const attendanceDate = BigInt(d.getTime());

      const checkedInToday = await prisma.staffAttendance.findFirst({
        where: {
          userId: authUser.id,
          organizationId: authUser.organizationId,
          attendanceDate,
          isDeleted: false,
          checkInAt: { not: null },
          checkOutAt: null,
        },
      });

      if (!checkedInToday) {
        throw new Error("You have to check in first");
      }
    }

    // Don't let a task start on a booking that's no longer active.
    const booking = await prisma.booking.findUnique({
      where: { id: assignment.bookingId },
      select: { status: true },
    });
    if (!booking || booking.status !== "APPROVED") {
      throw new Error("This booking is no longer active");
    }

    // ONE TASK AT A TIME. A staff member physically cannot be on two trips at
    // once, and a second START would leave the first one running forever (its
    // guardian still tracking a driver who has moved on) and make the live
    // location ambiguous. Keyed on the ASSIGNMENT's owner, so a manager pressing
    // Start on the staff member's behalf hits the same rule.
    const alreadyRunning = await prisma.bookingStaffAssignment.findFirst({
      where: {
        userId: assignment.userId,
        organizationId: assignment.organizationId,
        status: ASSIGNMENT_STATUS.START,
        id: { not: id },
      },
      select: { id: true },
    });
    if (alreadyRunning) {
      throw new Error(
        "You already have a task in progress — end it before starting another",
      );
    }

    const now = BigInt(Date.now());

    const updated = await prisma.bookingStaffAssignment.update({
      where: { id },
      data: {
        status: ASSIGNMENT_STATUS.START,
        startedAt: now,
        updatedAt: now,
      },
    });
    await notifyGuardianTask(assignment.bookingId, "START");
    return updated;
  },

  endTask: async (id, authUser) => {
    const assignment = await prisma.bookingStaffAssignment.findUnique({
      where: { id },
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }
    if (!canManageAssignment(assignment, authUser)) {
      throw new Error("Not authorized for this assignment");
    }

    if (assignment.status !== "START") {
      throw new Error("Task not started yet");
    }
    await assertBookingNotDead(assignment.bookingId);

    const now = BigInt(Date.now());

    const updated = await prisma.bookingStaffAssignment.update({
      where: { id },
      data: {
        status: ASSIGNMENT_STATUS.END,
        endedAt: now,
        updatedAt: now,
      },
    });
    // Task over → stop sharing the staff member's position. Best-effort: a
    // failure here must not fail the status change the staff member asked for.
    await clearLocation(id);
    await notifyGuardianTask(assignment.bookingId, "END");
    return updated;
  },

  completeTask: async (id, authUser) => {
    const assignment = await prisma.bookingStaffAssignment.findUnique({
      where: { id },
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }
    if (!canManageAssignment(assignment, authUser)) {
      throw new Error("Not authorized for this assignment");
    }

    if (assignment.status !== "END") {
      throw new Error("Task must be ended first");
    }
    await assertBookingNotDead(assignment.bookingId);

    const now = BigInt(Date.now());

    const updated = await prisma.bookingStaffAssignment.update({
      where: { id },
      data: {
        status: ASSIGNMENT_STATUS.COMPLETED,
        completedAt: now,
        updatedAt: now,
      },
    });
    await clearLocation(id);
    await notifyGuardianTask(assignment.bookingId, "COMPLETED");
    return updated;
  },

  cancelTask: async (id, cancellationReason, authUser) => {
    const assignment = await prisma.bookingStaffAssignment.findUnique({
      where: { id },
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }
    if (!canManageAssignment(assignment, authUser)) {
      throw new Error("Not authorized for this assignment");
    }
    if (
      [ASSIGNMENT_STATUS.COMPLETED, ASSIGNMENT_STATUS.CANCELLED].includes(
        assignment.status,
      )
    ) {
      throw new Error("A completed or cancelled assignment cannot be cancelled");
    }

    const now = BigInt(Date.now());

    const cancelled = await prisma.bookingStaffAssignment.update({
      where: { id },
      data: {
        status: ASSIGNMENT_STATUS.CANCELLED,
        cancellationReason,
        updatedAt: now,
      },
    });
    // Cancel = aborted, not finished — don't record it as an "end location".
    await clearLocation(id, { recordEnd: false });
    return cancelled;
  },

  deleteAssignment: async (id, authUser) => {
    const assignment = await prisma.bookingStaffAssignment.findFirst({
      where: { id, organizationId: authUser.organizationId },
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    if (assignment.status === "COMPLETED") {
      throw new Error("Completed assignment cannot be deleted");
    }

    await prisma.bookingStaffAssignment.delete({
      where: { id },
    });

    return true;
  },
};

module.exports = bookingStaffAssignmentService;
