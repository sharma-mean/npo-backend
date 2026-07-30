const test = require("node:test");
const assert = require("node:assert");

/**
 * End-to-end lifecycle integration test:
 *   create booking → waitlist → approve → reject → assign staff →
 *   start (check-in) → end → complete (checkout) → cancel → waitlist
 *   auto-promotion → staff attendance check-in/out.
 *
 * Hits the real DB with an isolated throwaway org; every created row is
 * deleted in the final cleanup step. Emails are suppressed by the
 * NODE_ENV=test guard in sendEmail. Skips cleanly when no DB is reachable.
 */

const RUN = `lc${Date.now()}`;
const HOUR = 60 * 60 * 1000;

test("booking → approval → staff task → attendance lifecycle", async (t) => {
  let prisma;
  try {
    prisma = require("../src/config/db");
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    t.skip("no database reachable");
    return;
  }

  const bookingService = require("../src/modules/booking/booking.service");
  const assignmentService = require("../src/modules/bookingStaffAssignment/bookingStaffAssignment.service");
  const attendanceService = require("../src/modules/staffAttendance/staffAttendance.service");

  const now = BigInt(Date.now());
  const mkUser = ({ n, ...over }) => ({
    fullName: `T ${over.role} ${RUN}`,
    email: `${over.role.toLowerCase()}.${RUN}${n || ""}@test.local`,
    password: "not-a-real-hash",
    status: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  });

  // ── Fixture org + people ────────────────────────────────────────────────
  const org = await prisma.organization.create({
    data: {
      name: `Lifecycle Test Org ${RUN}`, code: RUN, email: `org.${RUN}@test.local`,
      phone: "0", address: "x", city: "x", state: "x", country: "x", postalCode: "0",
      status: "ACTIVE", createdAt: now, updatedAt: now,
    },
  });
  const orgId = org.id;

  try {
    const admin = await prisma.user.create({ data: mkUser({ role: "NPO_ADMIN", organizationId: orgId }) });
    const guardian = await prisma.user.create({ data: mkUser({ role: "GUARDIAN", organizationId: orgId }) });
    const participant1 = await prisma.user.create({ data: mkUser({ role: "PARTICIPANT", n: 1, organizationId: orgId, guardianUserId: guardian.id }) });
    const participant2 = await prisma.user.create({ data: mkUser({ role: "PARTICIPANT", n: 2, organizationId: orgId, guardianUserId: guardian.id }) });

    const designation = await prisma.staffRole.create({
      data: { name: `SUPPORT ${RUN}`, roleType: "SUPPORT_WORKER", organizationId: orgId, createdBy: admin.id, createdAt: now, updatedAt: now },
    });
    const staff1 = await prisma.user.create({ data: mkUser({ role: "STAFF", n: 1, organizationId: orgId, designationId: designation.id }) });
    const staff2 = await prisma.user.create({ data: mkUser({ role: "STAFF", n: 2, organizationId: orgId, designationId: designation.id }) });

    const service = await prisma.service.create({
      data: { organizationId: orgId, serviceName: `Svc ${RUN}`, category: "DAYCARE", defaultCapacity: 2, durationMinutes: 60, createdAt: now, updatedAt: now },
    });
    const startMs = Date.now() + 2 * HOUR;
    const endMs = startMs + HOUR;
    const slot = await prisma.serviceSlot.create({
      data: {
        organizationId: orgId, serviceId: service.id, serviceType: "DAYCARE",
        slotDate: BigInt(startMs), startTime: BigInt(startMs), endTime: BigInt(endMs),
        capacity: 2, createdAt: now, updatedAt: now,
      },
    });

    const adminAuth = { id: admin.id, role: "NPO_ADMIN", organizationId: orgId };
    const guardianAuth = { id: guardian.id, role: "GUARDIAN", organizationId: orgId };
    const staff1Auth = { id: staff1.id, role: "STAFF", organizationId: orgId, serviceType: null };
    const staff2Auth = { id: staff2.id, role: "STAFF", organizationId: orgId, serviceType: null };

    const rawBooking = (participantId, count) => ({
      participantId, serviceType: "DAYCARE",
      bookingDate: startMs, startTime: startMs, endTime: endMs,
      participantCount: count, requiredSeats: 0, slotId: slot.id,
    });

    // ── Create: PENDING + slot seat reserved ─────────────────────────────
    const bookingA = await bookingService.createBooking(rawBooking(participant1.id, 1), guardianAuth);
    assert.strictEqual(bookingA.status, "PENDING");
    let s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 1, "seat reserved on create");

    // Duplicate: same participant, overlapping time, same service → hard error
    await assert.rejects(
      bookingService.createBooking(rawBooking(participant1.id, 1), guardianAuth),
      /Duplicate booking/,
    );

    // Past start time → hard error
    await assert.rejects(
      bookingService.createBooking(
        { ...rawBooking(participant2.id, 1), startTime: Date.now() - HOUR, endTime: Date.now() },
        guardianAuth,
      ),
      /past/,
    );

    // End before start → hard error
    await assert.rejects(
      bookingService.createBooking(
        { ...rawBooking(participant2.id, 1), startTime: endMs, endTime: startMs },
        guardianAuth,
      ),
      /End time must be after start time/,
    );

    // Guardian booking someone else's participant → blocked
    const strangerParticipant = await prisma.user.create({ data: mkUser({ role: "PARTICIPANT", n: 3, organizationId: orgId, guardianUserId: admin.id }) });
    await assert.rejects(
      bookingService.createBooking(rawBooking(strangerParticipant.id, 1), guardianAuth),
      /own participant/,
    );

    // ── Waitlist entry: capacity overflow auto-waitlists ─────────────────
    const bookingB = await bookingService.createBooking(rawBooking(participant2.id, 2), guardianAuth);
    assert.strictEqual(bookingB.status, "WAITLISTED", "over-capacity booking waitlists");
    s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 1, "waitlisted booking holds no seats");

    // Waitlisted booking cannot be approved (must be promoted to PENDING first)
    await assert.rejects(bookingService.approveBooking(bookingB.id, admin.id, false, orgId), /pending/i);

    // ── Approve ──────────────────────────────────────────────────────────
    const approvedA = await bookingService.approveBooking(bookingA.id, admin.id, true, orgId);
    assert.strictEqual(approvedA.status, "APPROVED");
    await assert.rejects(bookingService.approveBooking(bookingA.id, admin.id, true, orgId), /pending/i);
    // Cross-tenant approve blocked (org-scoped findFirst)
    await assert.rejects(bookingService.approveBooking(bookingA.id, admin.id, true, "not-an-org"), /not found/i);

    // ── Staff assignment guards ──────────────────────────────────────────
    // Cannot assign onto a non-approved (waitlisted) booking
    await assert.rejects(
      assignmentService.createAssignment({ bookingId: bookingB.id, userId: staff1.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth),
      /approved/i,
    );
    // Role mismatch: designation SUPPORT_WORKER cannot take a DRIVER assignment
    await assert.rejects(
      assignmentService.createAssignment({ bookingId: bookingA.id, userId: staff1.id, assignmentRole: "DRIVER" }, adminAuth),
      /not a driver/i,
    );

    const assignment = await assignmentService.createAssignment(
      { bookingId: bookingA.id, userId: staff1.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth,
    );
    // A manager's assignment arrives unacknowledged: the staff member has to
    // accept it before it becomes workable.
    assert.strictEqual(assignment.status, "PENDING_ACCEPTANCE");

    // Starting before accepting is refused — this is the gate that made every
    // task unstartable while the mobile app had no Accept button.
    await assert.rejects(
      assignmentService.startTask(assignment.id, staff1Auth),
      /accept the task/i,
    );
    // Only the assigned staff member may accept.
    await assert.rejects(
      assignmentService.acceptAssignment(assignment.id, staff2Auth),
      /only the assigned staff/i,
    );
    const accepted = await assignmentService.acceptAssignment(assignment.id, staff1Auth);
    assert.strictEqual(accepted.status, "ASSIGNED");
    // Accepting twice is not a valid transition.
    await assert.rejects(
      assignmentService.acceptAssignment(assignment.id, staff1Auth),
      /not awaiting acceptance/i,
    );

    // Same staff cannot be assigned twice to one booking
    await assert.rejects(
      assignmentService.createAssignment({ bookingId: bookingA.id, userId: staff1.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth),
      /already assigned/i,
    );

    // ── Task check-in (start) / end / complete ───────────────────────────
    // Another staff member cannot drive someone else's task
    await assert.rejects(assignmentService.startTask(assignment.id, staff2Auth), /Not authorized/);
    // Ending before starting is blocked
    await assert.rejects(assignmentService.endTask(assignment.id, staff1Auth), /not started/i);

    const started = await assignmentService.startTask(assignment.id, staff1Auth);
    assert.strictEqual(started.status, "START");
    assert.ok(started.startedAt, "startedAt stamped");
    await assert.rejects(assignmentService.startTask(assignment.id, staff1Auth), /already started/i);
    // Completing before ending is blocked
    await assert.rejects(assignmentService.completeTask(assignment.id, staff1Auth), /ended first/i);

    const ended = await assignmentService.endTask(assignment.id, staff1Auth);
    assert.strictEqual(ended.status, "END");
    const completedTask = await assignmentService.completeTask(assignment.id, staff1Auth);
    assert.strictEqual(completedTask.status, "COMPLETED");
    // Completed task is immutable
    await assert.rejects(assignmentService.cancelTask(assignment.id, "x", adminAuth), /cannot be cancelled/i);
    await assert.rejects(assignmentService.deleteAssignment(assignment.id, adminAuth), /cannot be deleted/i);

    // ── Cancel approved booking → waitlist auto-promotion ────────────────
    const cancelledA = await bookingService.cancelBooking(bookingA.id, guardianAuth, "plans changed");
    assert.strictEqual(cancelledA.status, "CANCELLED");

    // The COMPLETED assignment record survives the booking cancellation
    const keptAssignment = await prisma.bookingStaffAssignment.findUnique({ where: { id: assignment.id } });
    assert.strictEqual(keptAssignment.status, "COMPLETED", "completed work record preserved");

    // Waitlisted B (2 seats) fits the freed capacity → auto-promoted to PENDING
    const promotedB = await prisma.booking.findUnique({ where: { id: bookingB.id } });
    assert.strictEqual(promotedB.status, "PENDING", "waitlist auto-promotes on cancel");
    s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 2, "promotion reserved its seats");

    // Cancelled booking cannot be cancelled again
    await assert.rejects(bookingService.cancelBooking(bookingA.id, guardianAuth, "x"), /pending, waitlisted or approved/i);

    // Guardian cannot cancel another guardian's booking
    const otherGuardianAuth = { id: admin.id, role: "GUARDIAN", organizationId: orgId };
    await assert.rejects(bookingService.cancelBooking(bookingB.id, otherGuardianAuth, "x"), /own booking/i);

    // ── Reject flow releases seats ───────────────────────────────────────
    const rejectedB = await bookingService.rejectBooking(bookingB.id, admin.id, "capacity review", orgId);
    assert.strictEqual(rejectedB.status, "REJECTED");
    s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 0, "reject releases reserved seats");
    await assert.rejects(bookingService.rejectBooking(bookingB.id, admin.id, "x", orgId), /pending/i);

    // ── Task on a dead booking is blocked ────────────────────────────────
    const bookingC = await bookingService.createBooking(rawBooking(participant1.id, 1), guardianAuth);
    await bookingService.approveBooking(bookingC.id, admin.id, true, orgId);
    const assignC = await assignmentService.createAssignment(
      { bookingId: bookingC.id, userId: staff1.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth,
    );
    await bookingService.cancelBooking(bookingC.id, adminAuth, "ops");
    const assignCAfter = await prisma.bookingStaffAssignment.findUnique({ where: { id: assignC.id } });
    assert.strictEqual(assignCAfter.status, "CANCELLED", "active assignment cancelled with its booking");
    await assert.rejects(assignmentService.startTask(assignC.id, staff1Auth), /already started|no longer active/i);

    // ── Complete booking path ────────────────────────────────────────────
    const bookingD = await bookingService.createBooking(rawBooking(participant2.id, 1), guardianAuth);
    await bookingService.approveBooking(bookingD.id, admin.id, true, orgId);
    const completedD = await bookingService.completeBooking(bookingD.id, orgId);
    assert.strictEqual(completedD.status, "COMPLETED");
    s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 0, "complete releases reserved seats");
    await assert.rejects(bookingService.completeBooking(bookingD.id, orgId), /approved/i);

    // ── Rejecting straight off the waitlist ──────────────────────────────
    const bookingF = await bookingService.createBooking(rawBooking(participant1.id, 2), guardianAuth);
    assert.strictEqual(bookingF.status, "PENDING"); // fills the slot (2/2)
    const bookingG = await bookingService.createBooking(rawBooking(participant2.id, 1), guardianAuth);
    assert.strictEqual(bookingG.status, "WAITLISTED");
    const rejectedG = await bookingService.rejectBooking(bookingG.id, admin.id, "no capacity", orgId);
    assert.strictEqual(rejectedG.status, "REJECTED", "waitlisted booking is rejectable");
    s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 2, "rejecting a waitlisted booking releases no seats");

    // A completed booking can never be rejected
    await assert.rejects(bookingService.rejectBooking(bookingD.id, admin.id, "x", orgId), /pending or waitlisted/i);

    // ── Cancelling straight off the waitlist ─────────────────────────────
    const bookingH = await bookingService.createBooking(rawBooking(participant2.id, 1), guardianAuth);
    assert.strictEqual(bookingH.status, "WAITLISTED"); // slot still full (2/2)
    const cancelledH = await bookingService.cancelBooking(bookingH.id, guardianAuth, "changed mind");
    assert.strictEqual(cancelledH.status, "CANCELLED");
    s = await prisma.serviceSlot.findUnique({ where: { id: slot.id } });
    assert.strictEqual(s.bookedCount, 2, "cancelling a waitlisted booking releases no seats");

    // ── Garbage input is rejected before it can 500 ──────────────────────
    await assert.rejects(
      bookingService.createBooking({ ...rawBooking(participant2.id, 1), startTime: "not-a-time" }, guardianAuth),
      /valid timestamps/,
    );

    // ── Vehicle rules (MOBILITY, no slot) ────────────────────────────────
    const vehicle = await prisma.vehicle.create({
      data: {
        organizationId: orgId, vehicleName: "T Van", vehicleNumber: `VAN-${RUN}`,
        vehicleType: "minivan", capacity: 3, status: true,
        createdBy: admin.id, createdAt: now, updatedAt: now,
      },
    });
    const rawMobility = (participantId, over = {}) => ({
      participantId, serviceType: "MOBILITY",
      bookingDate: startMs, startTime: startMs, endTime: endMs,
      participantCount: 1, requiredSeats: 2, vehicleId: vehicle.id, ...over,
    });

    // Required seats beyond vehicle capacity → hard error
    await assert.rejects(
      bookingService.createBooking(rawMobility(participant1.id, { requiredSeats: 4 }), guardianAuth),
      /capacity/i,
    );

    const bookingV = await bookingService.createBooking(rawMobility(participant1.id), guardianAuth);
    assert.strictEqual(bookingV.status, "PENDING");

    // Same vehicle, overlapping window, other participant → vehicle conflict
    await assert.rejects(
      bookingService.createBooking(rawMobility(participant2.id), guardianAuth),
      /Vehicle conflict/,
    );

    // ── forceApprove: warnings block plain approve, override passes ──────
    const bookingW = await bookingService.createBooking(
      { ...rawMobility(participant2.id), vehicleId: null, requiredSeats: 0 },
      guardianAuth,
    );
    assert.match(bookingW.operationalNotes, /No vehicle assigned/);
    await assert.rejects(bookingService.approveBooking(bookingW.id, admin.id, false, orgId), /operational warnings/);
    const forcedW = await bookingService.approveBooking(bookingW.id, admin.id, true, orgId);
    assert.strictEqual(forcedW.status, "APPROVED");

    // ── Staff double-booking + unavailability guards ─────────────────────
    const assignW = await assignmentService.createAssignment(
      { bookingId: bookingW.id, userId: staff1.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth,
    );
    assert.strictEqual(assignW.status, "PENDING_ACCEPTANCE");

    await bookingService.approveBooking(bookingV.id, admin.id, true, orgId);
    // staff1 already has an active assignment in this window → conflict
    await assert.rejects(
      assignmentService.createAssignment({ bookingId: bookingV.id, userId: staff1.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth),
      /conflicting booking/,
    );

    // staff2 marked unavailable for the window → blocked
    const availabilityService = require("../src/modules/staffAvailability/staffAvailability.service");
    await availabilityService.createAvailability(
      { userId: staff2.id, startTime: startMs - HOUR, endTime: endMs + HOUR, reason: "leave" },
      adminAuth,
    );
    await assert.rejects(
      assignmentService.createAssignment({ bookingId: bookingV.id, userId: staff2.id, assignmentRole: "SUPPORT_WORKER" }, adminAuth),
      /unavailable/,
    );

    // ── Recurring series create + series cancel ──────────────────────────
    const recStart = startMs + 10 * 24 * HOUR;
    const series = await bookingService.createRecurringBookings(
      {
        participantId: participant2.id, serviceType: "DAYCARE",
        bookingDate: recStart, startTime: recStart, endTime: recStart + HOUR,
        participantCount: 1, requiredSeats: 0,
        recurrence: { frequency: "DAILY", count: 3 },
      },
      guardianAuth,
    );
    assert.strictEqual(series.created.length, 3, "all 3 occurrences created");
    assert.strictEqual(series.skipped.length, 0);
    assert.ok(series.created.every((b) => b.status === "PENDING" && b.recurrenceGroupId === series.recurrenceGroupId));

    const seriesCancel = await bookingService.cancelSeries(series.recurrenceGroupId, guardianAuth, "trip cancelled");
    const seriesAfter = await prisma.booking.findMany({ where: { recurrenceGroupId: series.recurrenceGroupId } });
    assert.ok(seriesAfter.every((b) => b.status === "CANCELLED"), "whole series cancelled");

    // ── Staff attendance check-in / check-out ────────────────────────────
    // Non-staff cannot check in
    await assert.rejects(attendanceService.checkIn({}, { ...guardianAuth }), /Only staff/i);
    // Check-out with no open attendance → told to check in first
    await assert.rejects(attendanceService.checkOut(staff2Auth, {}), /check in first/i);

    const att = await attendanceService.checkIn({ remarks: "shift" }, staff1Auth);
    assert.strictEqual(att.attendanceStatus, "CHECKED_IN");
    await assert.rejects(attendanceService.checkIn({}, staff1Auth), /already checked-in/i);

    const out = await attendanceService.checkOut(staff1Auth, {});
    assert.strictEqual(out.attendanceStatus, "CHECKED_OUT");
    assert.ok(out.totalWorkingMinutes >= 0);
    // Second check-out: no open row remains → check-in-first error, not a
    // silent close of an older record
    await assert.rejects(attendanceService.checkOut(staff1Auth, {}), /check in first/i);
  } finally {
    // ── Cleanup: remove every row belonging to the throwaway org ─────────
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.staffAttendance.deleteMany({ where: { organizationId: orgId } });
    await prisma.staffAvailability.deleteMany({ where: { organizationId: orgId } });
    await prisma.bookingStaffAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.booking.deleteMany({ where: { organizationId: orgId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: orgId } });
    await prisma.serviceSlot.deleteMany({ where: { organizationId: orgId } });
    await prisma.service.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.staffRole.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
});
