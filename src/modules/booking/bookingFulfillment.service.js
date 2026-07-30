const prisma = require("../../config/db");
const { BOOKING_STATUS } = require("./bookig.constants");
const { logAudit } = require("../../utils/auditLogger");
const notificationService = require("../notification/notification.service");
const availabilityService = require("../staffAvailability/staffAvailability.service");
const { staffingRequirement } = require("./booking.service");

// Staff assignments in these states block the person's time slot. A
// PENDING_ACCEPTANCE assignment holds the slot too (staff hasn't declined yet).
const ACTIVE_ASSIGNMENT_STATUSES = ["PENDING_ACCEPTANCE", "ASSIGNED", "START"];

// Tally a proposed staff list (from the fulfill payload) by role bucket, the
// same way staffingShortfall tallies committed assignments.
const tallyProposedStaff = (staffList) => {
  const have = { support: 0, drivers: 0, assistants: 0 };
  for (const s of staffList) {
    const r = String(s.assignmentRole || "").toUpperCase();
    if (r.includes("DRIVER")) have.drivers++;
    else if (r.includes("ASSISTANT")) have.assistants++;
    else have.support++;
  }
  return have;
};

// Returns a shortfall string if the proposed staff fall below the slot service's
// configured minimum, else null. Mirrors booking.service.staffingShortfall but
// against the not-yet-committed fulfill payload.
const proposedStaffingShortfall = async (booking, staffList) => {
  if (!booking.slotId) return null;
  const slot = await prisma.serviceSlot.findUnique({
    where: { id: booking.slotId },
    select: {
      service: {
        select: {
          requiresStaff: true,
          minSupportStaff: true,
          minDrivers: true,
          minAssistants: true,
          ratioParticipantsPer: true,
          ratioSupportStaff: true,
          ratioDrivers: true,
          ratioAssistants: true,
        },
      },
    },
  });
  const svc = slot?.service;
  if (!svc || !svc.requiresStaff) return null;
  const req = staffingRequirement(svc, booking.participantCount);
  if (req.support === 0 && req.drivers === 0 && req.assistants === 0) return null;
  const have = tallyProposedStaff(staffList);
  const short = [];
  if (have.support < req.support) short.push(`support ${have.support}/${req.support}`);
  if (have.drivers < req.drivers) short.push(`drivers ${have.drivers}/${req.drivers}`);
  if (have.assistants < req.assistants) short.push(`assistants ${have.assistants}/${req.assistants}`);
  return short.length ? short.join(", ") : null;
};

/*
|--------------------------------------------------------------------------
| Resource requirements per service type
|--------------------------------------------------------------------------
| Returns the staff roles + whether a vehicle / venue is needed for a booking.
*/
const getRequirements = (booking) => {
  const needsTransport =
    booking.serviceType === "MOBILITY" ||
    (booking.requiredSeats && booking.requiredSeats > 0);

  const needsVenue =
    booking.serviceType === "DAYCARE" || booking.serviceType === "RECREATION";

  const staffRoles = [];
  if (needsTransport) {
    staffRoles.push({ key: "drivers", roleType: "DRIVER", label: "Driver", required: true });
  }
  if (booking.serviceType === "DAYCARE") {
    staffRoles.push({ key: "supportWorkers", roleType: "SUPPORT_WORKER", label: "Support Worker", required: true });
    staffRoles.push({ key: "nurses", roleType: "NURSE", label: "Nurse", required: false });
  }
  if (booking.serviceType === "RECREATION") {
    staffRoles.push({ key: "activityLeaders", roleType: "ACTIVITY_LEADER", label: "Activity Leader", required: true });
    staffRoles.push({ key: "supportWorkers", roleType: "SUPPORT_WORKER", label: "Support Worker", required: false });
  }

  return { needsTransport, needsVenue, staffRoles };
};

/*
|--------------------------------------------------------------------------
| Available staff of a given role for the booking's time window
|--------------------------------------------------------------------------
*/
const getAvailableStaffByRole = async (booking, roleType, organizationId) => {
  const staff = await prisma.user.findMany({
    where: {
      organizationId,
      role: "STAFF",
      status: true,
      isDeleted: false,
      designation: { roleType },
    },
    include: { designation: true },
    orderBy: { fullName: "asc" },
  });

  if (staff.length === 0) return [];

  const staffIds = staff.map((s) => s.id);

  const conflicts = await prisma.bookingStaffAssignment.findMany({
    where: {
      userId: { in: staffIds },
      status: { in: ACTIVE_ASSIGNMENT_STATUSES },
      bookingId: { not: booking.id },
      booking: {
        status: BOOKING_STATUS.APPROVED,
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
      },
    },
    select: { userId: true },
  });

  const busy = new Set(conflicts.map((c) => c.userId));

  return staff.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    designation: s.designation?.name || null,
    isBusy: busy.has(s.id),
  }));
};

/*
|--------------------------------------------------------------------------
| Available vehicles for the booking's time window
|--------------------------------------------------------------------------
*/
const getAvailableVehicles = async (booking, participant, organizationId) => {
  const vehicles = await prisma.vehicle.findMany({
    where: {
      organizationId,
      status: true,
      OR: [{ serviceType: null }, { serviceType: booking.serviceType }],
    },
    orderBy: { vehicleName: "asc" },
  });

  if (vehicles.length === 0) return [];

  const vehicleIds = vehicles.map((v) => v.id);

  // A vehicle is busy if it's on another approved booking that overlaps
  const conflicts = await prisma.booking.findMany({
    where: {
      organizationId,
      status: BOOKING_STATUS.APPROVED,
      id: { not: booking.id },
      vehicleId: { in: vehicleIds },
      startTime: { lt: booking.endTime },
      endTime: { gt: booking.startTime },
    },
    select: { vehicleId: true },
  });

  const busy = new Set(conflicts.map((c) => c.vehicleId));
  const needsWheelchair = !!participant?.needsWheelchair;
  const seatsNeeded = booking.requiredSeats || 1;

  return vehicles.map((v) => ({
    id: v.id,
    vehicleName: v.vehicleName,
    vehicleNumber: v.vehicleNumber,
    capacity: v.capacity,
    wheelchairAccessible: v.wheelchairAccessible,
    isBusy: busy.has(v.id),
    fitsWheelchair: !needsWheelchair || v.wheelchairAccessible,
    hasCapacity: v.capacity == null || v.capacity >= seatsNeeded,
  }));
};

/*
|--------------------------------------------------------------------------
| Available venues for the booking's time window
|--------------------------------------------------------------------------
*/
const getAvailableVenues = async (booking, organizationId, designatedVenueId = null) => {
  const venues = await prisma.venue.findMany({
    where: {
      organizationId,
      status: true,
      OR: [{ serviceType: null }, { serviceType: booking.serviceType }],
    },
    orderBy: { name: "asc" },
  });

  if (venues.length === 0) return [];

  const venueIds = venues.map((v) => v.id);

  const overlaps = await prisma.booking.findMany({
    where: {
      organizationId,
      status: BOOKING_STATUS.APPROVED,
      id: { not: booking.id },
      venueId: { in: venueIds },
      startTime: { lt: booking.endTime },
      endTime: { gt: booking.startTime },
    },
    select: { venueId: true, participantCount: true },
  });
  const peopleCount = booking.participantCount || 1;

  return venues.map((v) => {
    const usedSeats = overlaps
      .filter((o) => o.venueId === v.id)
      .reduce((sum, o) => sum + (o.participantCount || 1), 0);
    const hasCapacity =
      v.capacity == null || usedSeats + peopleCount <= v.capacity;
    return {
      id: v.id,
      name: v.name,
      address: v.address,
      capacity: v.capacity,
      isBusy: !hasCapacity,
      hasCapacity,
      usedSeats,
      // The venue the guardian's slot was scheduled at — the coordinator must
      // keep the guardian and NPO on the same venue (client feedback #15).
      isScheduled: designatedVenueId != null && v.id === designatedVenueId,
    };
  });
};

const firstUsableVehicle = (vehicles) =>
  vehicles.find((v) => !v.isBusy && v.fitsWheelchair && v.hasCapacity) ||
  vehicles.find((v) => !v.isBusy && v.fitsWheelchair) ||
  vehicles.find((v) => !v.isBusy) ||
  null;

// The venue the slot/booking was scheduled at wins — even if it is momentarily
// full — so the coordinator confirms the SAME venue the guardian was shown,
// never a silently different one (client feedback #15). Only when there is no
// scheduled venue do we fall back to the first free one.
const firstUsableVenue = (venues) =>
  venues.find((v) => v.isScheduled) ||
  venues.find((v) => v.hasCapacity) ||
  null;

const firstFreeStaff = (list) => list.find((s) => !s.isBusy) || null;

/*
|--------------------------------------------------------------------------
| GET fulfillment view for a pending booking
|--------------------------------------------------------------------------
*/
const getBookingFulfillment = async (bookingId, authUser) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: authUser.organizationId },
    include: {
      participant: {
        select: {
          id: true,
          fullName: true,
          dateOfBirth: true,
          gender: true,
          mobilitySupport: true,
          needsWheelchair: true,
          medicalNotes: true,
          allergyNotes: true,
          emergencyInstructions: true,
        },
      },
      guardian: { select: { id: true, fullName: true, phone: true } },
      slot: { select: { id: true, venueId: true } },
    },
  });

  if (!booking) throw new Error("Booking not found");

  // The venue the guardian actually saw: an explicit booking venue, else the
  // one attached to the scheduled slot. The coordinator's suggestion must match.
  const designatedVenueId = booking.venueId || booking.slot?.venueId || null;

  const { needsTransport, needsVenue, staffRoles } = getRequirements(booking);

  // Staff per required role
  const staff = {};
  for (const r of staffRoles) {
    staff[r.key] = {
      label: r.label,
      roleType: r.roleType,
      required: r.required,
      options: await getAvailableStaffByRole(
        booking,
        r.roleType,
        authUser.organizationId,
      ),
    };
  }

  const vehicles = needsTransport
    ? await getAvailableVehicles(booking, booking.participant, authUser.organizationId)
    : [];
  const venues = needsVenue
    ? await getAvailableVenues(booking, authUser.organizationId, designatedVenueId)
    : [];

  // Auto-suggestions
  const suggestions = {
    vehicleId: needsTransport ? firstUsableVehicle(vehicles)?.id || null : null,
    venueId: needsVenue ? firstUsableVenue(venues)?.id || null : null,
    staff: {},
  };
  for (const r of staffRoles) {
    if (r.required) {
      const pick = firstFreeStaff(staff[r.key].options);
      if (pick) suggestions.staff[r.roleType] = pick.id;
    }
  }

  // Warnings: any required resource with no free option
  const warnings = [];
  if (needsTransport && !firstUsableVehicle(vehicles)) {
    warnings.push("No vehicle available for this time slot");
  }
  if (needsVenue && !firstUsableVenue(venues)) {
    warnings.push("No venue available for this time slot");
  }
  for (const r of staffRoles) {
    if (r.required && !firstFreeStaff(staff[r.key].options)) {
      warnings.push(`No ${r.label.toLowerCase()} available for this time slot`);
    }
  }

  return {
    booking: {
      id: booking.id,
      serviceType: booking.serviceType,
      bookingDate: booking.bookingDate,
      startTime: booking.startTime,
      endTime: booking.endTime,
      requiredSeats: booking.requiredSeats,
      participantCount: booking.participantCount,
      purpose: booking.purpose,
      notes: booking.notes,
      status: booking.status,
    },
    participant: booking.participant,
    guardian: booking.guardian,
    needsTransport,
    needsVenue,
    staff,
    vehicles,
    venues,
    scheduledVenueId: designatedVenueId,
    suggestions,
    warnings,
  };
};

/*
|--------------------------------------------------------------------------
| Fulfill a booking: assign resources + approve, atomically
|--------------------------------------------------------------------------
| data: { vehicleId?, venueId?, staff: [{ userId, assignmentRole }] }
*/
const fulfillBooking = async (bookingId, data, authUser) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: authUser.organizationId },
    include: { participant: { select: { needsWheelchair: true } } },
  });

  if (!booking) throw new Error("Booking not found");
  if (booking.status !== BOOKING_STATUS.PENDING) {
    throw new Error("Only a pending booking can be fulfilled");
  }

  const staffToAssign = Array.isArray(data.staff) ? data.staff : [];

  // --- Re-validate availability at commit time ---

  // Vehicle
  if (data.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: { id: data.vehicleId, organizationId: authUser.organizationId, status: true },
    });
    if (!vehicle) throw new Error("Selected vehicle not found");

    const vConflict = await prisma.booking.findFirst({
      where: {
        organizationId: authUser.organizationId,
        status: BOOKING_STATUS.APPROVED,
        id: { not: bookingId },
        vehicleId: data.vehicleId,
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
      },
    });
    if (vConflict) throw new Error("Selected vehicle is already booked for this time");
  }

  // Venue
  if (data.venueId) {
    const venue = await prisma.venue.findFirst({
      where: { id: data.venueId, organizationId: authUser.organizationId, status: true },
    });
    if (!venue) throw new Error("Selected venue not found");

    const overlappingVenueBookings = await prisma.booking.findMany({
      where: {
        organizationId: authUser.organizationId,
        status: BOOKING_STATUS.APPROVED,
        id: { not: bookingId },
        venueId: data.venueId,
        startTime: { lt: booking.endTime },
        endTime: { gt: booking.startTime },
      },
      select: { participantCount: true },
    });
    const usedSeats = overlappingVenueBookings.reduce(
      (sum, b) => sum + (b.participantCount || 1),
      0,
    );
    if (venue.capacity != null && usedSeats + (booking.participantCount || 1) > venue.capacity) {
      throw new Error("Selected venue does not have enough remaining capacity for this time");
    }
  }

  // Staff
  for (const s of staffToAssign) {
    const user = await prisma.user.findFirst({
      where: {
        id: s.userId,
        organizationId: authUser.organizationId,
        role: "STAFF",
        status: true,
        isDeleted: false,
      },
      include: { designation: true },
    });
    if (!user) throw new Error("One of the selected staff was not found");

    if (
      s.assignmentRole !== "OTHER" &&
      user.designation?.roleType !== s.assignmentRole
    ) {
      throw new Error(
        `${user.fullName} is not a ${s.assignmentRole.replace("_", " ").toLowerCase()}`,
      );
    }

    const conflict = await prisma.bookingStaffAssignment.findFirst({
      where: {
        userId: s.userId,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        booking: {
          status: BOOKING_STATUS.APPROVED,
          startTime: { lt: booking.endTime },
          endTime: { gt: booking.startTime },
        },
      },
    });
    if (conflict) throw new Error(`${user.fullName} has a conflicting booking`);

    const unavailable = await availabilityService.isUnavailable(
      s.userId,
      booking.startTime,
      booking.endTime,
      authUser.organizationId,
    );
    if (unavailable) {
      throw new Error(`${user.fullName} is marked unavailable for this time`);
    }
  }

  // Minimum-staffing gate (SOW §11). Blocks approval below the service minimum
  // unless the manager explicitly overrides (forceApprove). Structured throw so
  // the modal can render the 3-way choice.
  if (!data.forceApprove) {
    const shortfall = await proposedStaffingShortfall(booking, staffToAssign);
    if (shortfall) {
      const err = new Error(
        `Staffing is below the service minimum (${shortfall}). Add staff, or approve anyway.`,
      );
      err.code = "STAFFING_SHORTFALL";
      err.shortfall = shortfall;
      throw err;
    }
  }

  const now = BigInt(Date.now());
  const hadWarnings = !!booking.operationalNotes;

  const result = await prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        vehicleId: data.vehicleId || null,
        venueId: data.venueId || null,
        status: BOOKING_STATUS.APPROVED,
        approvedBy: authUser.id,
        operationalNotes: null,
        updatedAt: now,
      },
    });

    for (const s of staffToAssign) {
      await tx.bookingStaffAssignment.create({
        data: {
          organizationId: authUser.organizationId,
          bookingId,
          userId: s.userId,
          assignmentRole: s.assignmentRole,
          status: "PENDING_ACCEPTANCE",
          assignedBy: authUser.id,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        participant: { select: { id: true, fullName: true, phone: true, mobilitySupport: true } },
        vehicle: { select: { id: true, vehicleName: true, vehicleNumber: true, capacity: true } },
        venue: { select: { id: true, name: true, address: true, capacity: true } },
        staffAssignments: {
          include: { user: { select: { id: true, fullName: true, phone: true, email: true } } },
        },
      },
    });
  });

  // Audit: fulfilling clears operationalNotes, so treat warning-clears as OVERRIDE
  await logAudit({
    authData: authUser,
    action: hadWarnings ? "OVERRIDE" : "STATUS_CHANGE",
    entity: "Booking",
    entityId: bookingId,
    before: { status: BOOKING_STATUS.PENDING },
    after: { status: BOOKING_STATUS.APPROVED },
    metadata: {
      vehicleId: data.vehicleId || null,
      venueId: data.venueId || null,
      assignedStaff: staffToAssign.map((s) => s.userId),
      ...(hadWarnings ? { clearedWarnings: booking.operationalNotes } : {}),
    },
  });

  // Notify the assigned staff and the guardian together, under a time budget.
  // The booking is already committed at this point, so the response must not
  // wait on Gmail: several sequential sends could outlast the client's timeout
  // and surface as a network error on a save that actually succeeded.
  const guardian = await prisma.user.findUnique({
    where: { id: booking.guardianId },
    select: { id: true, email: true },
  });

  await notificationService.withNotifyBudget(
    Promise.allSettled([
      ...(result?.staffAssignments || []).map((a) =>
        notificationService.notify({
          userId: a.userId,
          organizationId: authUser.organizationId,
          type: "ASSIGNMENT_CREATED",
          title: "New task — please accept or decline",
          message: "You've been assigned to a booking. Open the task to accept or decline it.",
          relatedBookingId: bookingId,
          email: a.user?.email,
          emailSubject: "You have a new assigned task",
        }),
      ),
      ...(guardian
        ? [
            notificationService.notify({
              userId: guardian.id,
              organizationId: authUser.organizationId,
              type: "BOOKING_APPROVED",
              title: "Booking approved",
              message: "Your booking has been approved and resources assigned.",
              relatedBookingId: bookingId,
              email: guardian.email,
              emailSubject: "Your booking was approved",
            }),
          ]
        : []),
    ]),
  );

  return result;
};

module.exports = {
  getBookingFulfillment,
  fulfillBooking,
};
