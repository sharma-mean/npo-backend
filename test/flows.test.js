const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

/**
 * Integration tests for the non-booking flows:
 *   incidents (report → scope → update authz → resolve → lock),
 *   user management privilege guards, self-service password reset,
 *   guardian cascade delete, recurring service slots,
 *   vehicle/venue delete guards, venue-capacity waitlist + promotion.
 *
 * Same conventions as bookingLifecycle.test.js: real DB, one throwaway org,
 * full cleanup in finally, emails suppressed by the NODE_ENV=test guard.
 */

const RUN = `fl${Date.now()}`;
const HOUR = 60 * 60 * 1000;

test("incidents · user guards · password reset · cascades · slots · venue waitlist", async (t) => {
  let prisma;
  try {
    prisma = require("../src/config/db");
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    t.skip("no database reachable");
    return;
  }

  const bookingService = require("../src/modules/booking/booking.service");
  const incidentService = require("../src/modules/incident/incident.service");
  const userService = require("../src/modules/user/user.service");
  const guardianService = require("../src/modules/guardian/guardian.service");
  const slotService = require("../src/modules/serviceSlot/serviceSlot.service");
  const vehicleService = require("../src/modules/vehicle/vehicle.service");
  const venueService = require("../src/modules/venue/venue.service");
  const bcrypt = require("bcryptjs");

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

  const org = await prisma.organization.create({
    data: {
      name: `Flows Test Org ${RUN}`, code: RUN, email: `org.${RUN}@test.local`,
      phone: "0", address: "x", city: "x", state: "x", country: "x", postalCode: "0",
      status: "ACTIVE", createdAt: now, updatedAt: now,
    },
  });
  const orgId = org.id;

  try {
    const admin = await prisma.user.create({ data: mkUser({ role: "NPO_ADMIN", organizationId: orgId }) });
    const coordinator = await prisma.user.create({ data: mkUser({ role: "COORDINATOR", organizationId: orgId }) });
    const guardian = await prisma.user.create({ data: mkUser({ role: "GUARDIAN", organizationId: orgId }) });
    const participant = await prisma.user.create({ data: mkUser({ role: "PARTICIPANT", organizationId: orgId, guardianUserId: guardian.id }) });
    const staff1 = await prisma.user.create({ data: mkUser({ role: "STAFF", n: 1, organizationId: orgId }) });
    const staff2 = await prisma.user.create({ data: mkUser({ role: "STAFF", n: 2, organizationId: orgId }) });

    const adminAuth = { id: admin.id, role: "NPO_ADMIN", organizationId: orgId };
    const coordAuth = { id: coordinator.id, role: "COORDINATOR", organizationId: orgId };
    const guardianAuth = { id: guardian.id, role: "GUARDIAN", organizationId: orgId };
    const staff1Auth = { id: staff1.id, role: "STAFF", organizationId: orgId };
    const staff2Auth = { id: staff2.id, role: "STAFF", organizationId: orgId };

    const startMs = Date.now() + 3 * HOUR;
    const endMs = startMs + HOUR;
    const booking = await bookingService.createBooking(
      {
        participantId: participant.id, serviceType: "DAYCARE",
        bookingDate: startMs, startTime: startMs, endTime: endMs,
        participantCount: 1, requiredSeats: 0,
      },
      guardianAuth,
    );

    // ── Incident flow ─────────────────────────────────────────────────────
    // Guardians cannot report
    await assert.rejects(
      incidentService.createIncident({ type: "DELAY", title: "x" }, guardianAuth),
      /Not authorized/,
    );
    const incident = await incidentService.createIncident(
      { type: "DELAY", severity: "HIGH", title: "Van stuck in traffic", bookingId: booking.id },
      staff1Auth,
    );
    assert.strictEqual(incident.status, "OPEN");

    // Staff scoping: reporter sees it, another staff member does not
    const staff1List = await incidentService.getAllIncidents(staff1Auth);
    assert.ok(staff1List.some((i) => i.id === incident.id));
    const staff2List = await incidentService.getAllIncidents(staff2Auth);
    assert.ok(!staff2List.some((i) => i.id === incident.id), "other staff can't see it in list");
    await assert.rejects(incidentService.getIncidentById(incident.id, staff2Auth), /not found/i);

    // Update authz: stranger staff blocked; owner can edit fields but not status
    await assert.rejects(
      incidentService.updateIncident(incident.id, { title: "hijack" }, staff2Auth),
      /Not authorized/,
    );
    await assert.rejects(
      incidentService.updateIncident(incident.id, { status: "IN_PROGRESS" }, staff1Auth),
      /Only managers/,
    );
    const ownerEdit = await incidentService.updateIncident(
      incident.id, { description: "ETA 30 min" }, staff1Auth,
    );
    assert.strictEqual(ownerEdit.description, "ETA 30 min");

    // Managers drive status; RESOLVED only via resolve endpoint
    await assert.rejects(
      incidentService.updateIncident(incident.id, { status: "RESOLVED" }, adminAuth),
      /use resolve/i,
    );
    const inProgress = await incidentService.updateIncident(incident.id, { status: "IN_PROGRESS" }, adminAuth);
    assert.strictEqual(inProgress.status, "IN_PROGRESS");

    await assert.rejects(incidentService.resolveIncident(incident.id, "n", staff1Auth), /Not authorized/);
    const resolved = await incidentService.resolveIncident(incident.id, "Van arrived", coordAuth);
    assert.strictEqual(resolved.status, "RESOLVED");
    assert.strictEqual(resolved.resolvedBy, coordinator.id);
    // Resolved is locked + double-resolve blocked
    await assert.rejects(incidentService.updateIncident(incident.id, { title: "late edit" }, adminAuth), /no longer be edited/);
    await assert.rejects(incidentService.resolveIncident(incident.id, "again", adminAuth), /already resolved/);

    // ── User management privilege guards ──────────────────────────────────
    // Privileged roles can never be created through the API
    for (const role of ["SUPER_ADMIN", "NPO_ADMIN"]) {
      await assert.rejects(
        userService.createUser({ fullName: "x", email: `esc.${RUN}@test.local`, password: "longenough1", role }, adminAuth),
        /Invalid role/,
      );
    }
    // A coordinator can't reset an admin's password (target outranks actor)
    await assert.rejects(
      userService.userResetPassword(admin.id, "newpassword123", coordAuth),
      /permission to manage/,
    );
    // …but an admin can reset a staff member's
    await userService.userResetPassword(staff2.id, "newpassword123", adminAuth);

    // Self status-change / self delete blocked
    await assert.rejects(userService.toggleUserStatus(admin.id, adminAuth), /own account status/);
    await assert.rejects(userService.deleteUser(admin.id, adminAuth), /your own account/);
    // Coordinator can't disable the admin either
    await assert.rejects(userService.toggleUserStatus(admin.id, coordAuth), /permission to manage/);

    // ── Self-service password reset ───────────────────────────────────────
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await prisma.user.update({
      where: { id: staff1.id },
      data: { resetToken: tokenHash, resetTokenExpiry: BigInt(Date.now() + HOUR) },
    });
    await assert.rejects(userService.resetPasswordWithToken("wrong-token", "freshpass123"), /invalid or has expired/);
    await assert.rejects(userService.resetPasswordWithToken(rawToken, "short"), /8 characters/);
    await userService.resetPasswordWithToken(rawToken, "freshpass123");
    const staff1After = await prisma.user.findUnique({ where: { id: staff1.id } });
    assert.ok(await bcrypt.compare("freshpass123", staff1After.password), "new password stored hashed");
    assert.strictEqual(staff1After.resetToken, null, "token single-use");
    // Expired token rejected
    await prisma.user.update({
      where: { id: staff1.id },
      data: { resetToken: tokenHash, resetTokenExpiry: BigInt(Date.now() - 1000) },
    });
    await assert.rejects(userService.resetPasswordWithToken(rawToken, "anotherpass123"), /invalid or has expired/);

    // ── Recurring service slots (WEEKLY, daysOfWeek, dedupe) ─────────────
    const service = await prisma.service.create({
      data: { organizationId: orgId, serviceName: `Svc ${RUN}`, category: "DAYCARE", defaultCapacity: 5, durationMinutes: 60, createdAt: now, updatedAt: now },
    });
    const slotStart = Date.now() + 7 * 24 * HOUR;
    const recur = {
      serviceId: service.id, serviceType: "DAYCARE", capacity: 3,
      startTime: slotStart, endTime: slotStart + HOUR,
      recurrence: { frequency: "WEEKLY", daysOfWeek: [1, 3], count: 4 },
    };
    const gen = await slotService.generateRecurringSlots(recur, adminAuth);
    assert.strictEqual(gen.created.length, 4, "4 weekday slots generated");
    assert.ok(
      gen.created.every((sl) => [1, 3].includes(new Date(Number(sl.startTime)).getDay())),
      "only Mon/Wed occurrences",
    );
    // Re-running the same template skips duplicates instead of double-creating
    const gen2 = await slotService.generateRecurringSlots(recur, adminAuth);
    assert.strictEqual(gen2.created.length, 0);
    assert.strictEqual(gen2.skipped.length, 4, "duplicates skipped on re-run");
    // Non-managers can't create slots
    await assert.rejects(slotService.generateRecurringSlots(recur, staff1Auth), /Not authorized/);

    // ── Vehicle / venue delete guards (soft delete, blocked while in use) ─
    const vehicle = await prisma.vehicle.create({
      data: { organizationId: orgId, vehicleName: "T Van", vehicleNumber: `VAN-${RUN}`, vehicleType: "minivan", capacity: 4, status: true, createdBy: admin.id, createdAt: now, updatedAt: now },
    });
    const vBooking = await bookingService.createBooking(
      {
        participantId: participant.id, serviceType: "MOBILITY",
        bookingDate: startMs, startTime: startMs, endTime: endMs,
        participantCount: 1, requiredSeats: 1, vehicleId: vehicle.id,
      },
      guardianAuth,
    );
    await assert.rejects(vehicleService.deleteVehicle(vehicle.id, orgId), /active booking/);
    await bookingService.cancelBooking(vBooking.id, guardianAuth, "test");
    const deletedVehicle = await vehicleService.deleteVehicle(vehicle.id, orgId);
    assert.strictEqual(deletedVehicle.isDeleted, true, "soft-deleted, not hard-deleted");

    // ── Venue capacity → waitlist → promotion on cancel ──────────────────
    const venue = await prisma.venue.create({
      data: { organizationId: orgId, name: `Hall ${RUN}`, address: "x", capacity: 2, status: true, createdAt: now, updatedAt: now },
    });
    const venueStart = Date.now() + 5 * HOUR;
    const rawVenueBooking = (count) => ({
      participantId: participant.id, serviceType: "RECREATION",
      bookingDate: venueStart, startTime: venueStart, endTime: venueStart + HOUR,
      participantCount: count, requiredSeats: 0, venueId: venue.id,
    });
    const vb1 = await bookingService.createBooking(rawVenueBooking(2), guardianAuth);
    assert.strictEqual(vb1.status, "PENDING"); // fills the venue

    // Second participant so the duplicate-participant guard doesn't trip
    const participant2 = await prisma.user.create({ data: mkUser({ role: "PARTICIPANT", n: 2, organizationId: orgId, guardianUserId: guardian.id }) });
    const vb2 = await bookingService.createBooking(
      { ...rawVenueBooking(1), participantId: participant2.id },
      guardianAuth,
    );
    assert.strictEqual(vb2.status, "WAITLISTED", "venue-full booking waitlists");

    // Venue can't be deleted while active bookings reference it
    await assert.rejects(venueService.deleteVenue(venue.id, orgId), /active booking/);

    await bookingService.cancelBooking(vb1.id, guardianAuth, "freed");
    const vb2After = await prisma.booking.findUnique({ where: { id: vb2.id } });
    assert.strictEqual(vb2After.status, "PENDING", "venue waitlist auto-promotes on cancel");

    // ── Guardian cascade delete ───────────────────────────────────────────
    const guardian2 = await prisma.user.create({ data: mkUser({ role: "GUARDIAN", n: 2, organizationId: orgId }) });
    const participant3 = await prisma.user.create({ data: mkUser({ role: "PARTICIPANT", n: 3, organizationId: orgId, guardianUserId: guardian2.id }) });
    const g2Auth = { id: guardian2.id, role: "GUARDIAN", organizationId: orgId };
    const g2Booking = await bookingService.createBooking(
      {
        participantId: participant3.id, serviceType: "DAYCARE",
        bookingDate: startMs + 24 * HOUR, startTime: startMs + 24 * HOUR, endTime: endMs + 24 * HOUR,
        participantCount: 1, requiredSeats: 0,
      },
      g2Auth,
    );
    await guardianService.deleteGuardian(guardian2.id, orgId);
    const g2After = await prisma.user.findUnique({ where: { id: guardian2.id } });
    const p3After = await prisma.user.findUnique({ where: { id: participant3.id } });
    const g2BookingAfter = await prisma.booking.findUnique({ where: { id: g2Booking.id } });
    assert.strictEqual(g2After.isDeleted, true, "guardian soft-deleted");
    assert.strictEqual(p3After.isDeleted, true, "their participants soft-deleted");
    assert.strictEqual(g2BookingAfter.status, "CANCELLED", "their active bookings cancelled");
  } finally {
    await prisma.notification.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.incident.deleteMany({ where: { organizationId: orgId } });
    await prisma.bookingStaffAssignment.deleteMany({ where: { organizationId: orgId } });
    await prisma.booking.deleteMany({ where: { organizationId: orgId } });
    await prisma.serviceSlot.deleteMany({ where: { organizationId: orgId } });
    await prisma.service.deleteMany({ where: { organizationId: orgId } });
    await prisma.vehicle.deleteMany({ where: { organizationId: orgId } });
    await prisma.venue.deleteMany({ where: { organizationId: orgId } });
    await prisma.user.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.delete({ where: { id: orgId } });
  }
});
