const prisma = require("../../config/db");

const { BOOKING_STATUS } = require("./bookig.constants");
const { validateCreateBooking } = require("./booking.validation");
const { overlapWhere } = require("../../utils/timeOverlap");
const { logAudit } = require("../../utils/auditLogger");
const notificationService = require("../notification/notification.service");
const complianceService = require("../document/compliance.service");
const { geocodeAddress } = require("../../utils/geocode");

// On-demand geocode of a booking's pickup address → store + return lat/lng so
// the map view can pin it. Serverless-safe: awaited within its own request
// (no post-response background work that Vercel would drop). Org-scoped +
// best-effort (returns existing/null coords, never throws on geocode failure).
const geocodeBooking = async (id, authUser) => {
  // Guardians may only touch their own bookings (same ownership rule as
  // cancelBooking) — org-scope alone would let one guardian geocode + read
  // back another guardian's pickup within the tenant (IDOR).
  const where = { id, organizationId: authUser.organizationId };
  if (authUser.role === "GUARDIAN") where.guardianId = authUser.id;
  const booking = await prisma.booking.findFirst({
    where,
    select: { id: true, pickupAddress: true, pickupLat: true, pickupLng: true },
  });
  if (!booking) throw new Error("Booking not found");

  // Already geocoded, or nothing to geocode.
  if (booking.pickupLat != null && booking.pickupLng != null) {
    return { lat: booking.pickupLat, lng: booking.pickupLng };
  }
  if (!booking.pickupAddress) return { lat: null, lng: null };

  // Geocode with the ORG's chosen provider. Orgs default to free OSM; one that
  // supplied its own Google key gets Google's accuracy (and Google's bill).
  const org = await prisma.organization.findUnique({
    where: { id: authUser.organizationId },
    select: {
      mapProvider: true,
      googleMapsApiKey: true,
      city: true,
      state: true,
      country: true,
    },
  });

  // The org's city anchors a partial address. Without it, a fragment like
  // "Surya Nagar" resolves to a Surya Nagar in the wrong city — and a
  // confidently-wrong pin is worse for a driver than no pin at all.
  const context = [org?.city, org?.state, org?.country]
    .map((v) => (v || "").trim())
    .filter((v) => v && v.length > 1)
    .join(", ");

  const coords = await geocodeAddress(booking.pickupAddress, {
    provider: org?.mapProvider,
    apiKey: org?.googleMapsApiKey,
    context,
  });
  if (!coords) return { lat: null, lng: null };

  await prisma.booking.update({
    where: { id: booking.id },
    data: { pickupLat: coords.lat, pickupLng: coords.lng },
  });
  return coords;
};

// Statuses that still hold a resource (count toward capacity / conflicts).
const ACTIVE_STATUSES = [BOOKING_STATUS.PENDING, BOOKING_STATUS.APPROVED];

/**
 * Atomically reserve `seats` on a slot. Single conditional UPDATE — only
 * increments when capacity is still available, so concurrent reservations
 * can never overbook (Postgres row-level write lock per UPDATE).
 * Returns true if seats were reserved, false if the slot is full.
 * Must run inside a transaction (`tx`).
 */
const reserveSlotSeats = async (tx, slotId, seats, now) => {
  const affected = await tx.$executeRaw`
    UPDATE "ServiceSlot"
    SET "bookedCount" = "bookedCount" + ${seats}, "updatedAt" = ${now}
    WHERE id = ${slotId} AND "bookedCount" + ${seats} <= "capacity"
  `;
  return affected > 0;
};

/**
 * Next human-friendly booking code (BK0001…) for an org, allocated atomically.
 * Increments Organization.bookingSeq inside the caller's transaction and formats
 * the returned value — concurrent creates never collide on the same number.
 * Must run inside a transaction (`tx`).
 */
const nextBookingCode = async (tx, organizationId) => {
  const org = await tx.organization.update({
    where: { id: organizationId },
    data: { bookingSeq: { increment: 1 } },
    select: { bookingSeq: true },
  });
  return `BK${String(org.bookingSeq).padStart(4, "0")}`;
};

// Venue capacity has no seat counter (it's computed from overlapping bookings),
// so the conditional-UPDATE trick used for slots can't apply. Instead, serialize
// concurrent bookings for the SAME venue via a Postgres advisory xact-lock keyed
// on venueId, then recount inside the tx — closes the TOCTOU overbooking race
// where two concurrent bookings both pass the pre-tx check. Lock auto-releases at
// commit/rollback. Returns true if the venue still has room for `seats`.
const venueHasRoomInTx = async (tx, data, seats) => {
  // $executeRaw (not $queryRaw): pg_advisory_xact_lock() returns void, which
  // $queryRaw can't deserialize. $executeRaw runs it without reading a result.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.venueId}, 0))`;
  const venue = await tx.venue.findFirst({
    where: { id: data.venueId, organizationId: data.organizationId, isDeleted: false },
    select: { capacity: true },
  });
  if (!venue || venue.capacity == null) return true; // null capacity = unlimited
  const overlapping = await tx.booking.findMany({
    where: {
      organizationId: data.organizationId,
      venueId: data.venueId,
      status: { in: ACTIVE_STATUSES },
      ...overlapWhere(data.startTime, data.endTime),
    },
    select: { participantCount: true },
  });
  const used = overlapping.reduce((s, b) => s + (b.participantCount || 1), 0);
  return used + seats <= venue.capacity;
};

// Earliest time ≥ requested start when a vehicle is free for `durationMs` (SOW
// §13 "suggest next available timing"). Walks the vehicle's active bookings and
// pushes the candidate past each one it would still overlap. Best-effort — returns
// null if it can't compute (the caller just omits the hint).
const suggestVehicleFreeTime = async (vehicleId, organizationId, startMs, durationMs, notSelf) => {
  try {
    if (!durationMs || durationMs <= 0) return null;
    const booked = await prisma.booking.findMany({
      where: {
        organizationId,
        vehicleId,
        status: { in: ACTIVE_STATUSES },
        endTime: { gt: BigInt(startMs) },
        ...(notSelf || {}),
      },
      select: { startTime: true, endTime: true },
      orderBy: { startTime: "asc" },
      take: 100,
    });
    let candidate = startMs;
    // Re-scan until the candidate window clears every booking (bookings can chain).
    let moved = true;
    let guard = 0;
    while (moved && guard++ < 200) {
      moved = false;
      for (const b of booked) {
        const bs = Number(b.startTime);
        const be = Number(b.endTime);
        if (candidate < be && candidate + durationMs > bs) {
          candidate = be; // this booking blocks the window — jump past it
          moved = true;
        }
      }
    }
    return candidate;
  } catch {
    return null;
  }
};

/**
 * Run all booking validations. Returns { warnings, shouldWaitlist }.
 * Hard violations (duplicate, vehicle conflict) throw immediately.
 * Capacity violations (slot / venue full) set shouldWaitlist = true.
 */
const validateBooking = async (data, { excludeBookingId = null } = {}) => {
  const warnings = [];
  let shouldWaitlist = false;

  const notSelf = excludeBookingId
    ? { id: { not: excludeBookingId } }
    : {};

  // ── Duplicate booking: same participant, same serviceType, overlapping time
  const duplicate = await prisma.booking.findFirst({
    where: {
      organizationId: data.organizationId,
      participantId: data.participantId,
      serviceType: data.serviceType,
      status: { in: ACTIVE_STATUSES },
      ...overlapWhere(data.startTime, data.endTime),
      ...notSelf,
    },
  });
  if (duplicate) {
    throw new Error(
      "Duplicate booking: this participant already has an overlapping booking for this service",
    );
  }

  // ── Vehicle conflict: same vehicle, overlapping time
  if (data.vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: data.vehicleId,
        organizationId: data.organizationId,
        isDeleted: false,
      },
    });
    if (!vehicle) throw new Error("Vehicle not found");
    if (!vehicle.status) warnings.push("Vehicle is inactive");

    const vehicleConflict = await prisma.booking.findFirst({
      where: {
        organizationId: data.organizationId,
        vehicleId: data.vehicleId,
        status: { in: ACTIVE_STATUSES },
        ...overlapWhere(data.startTime, data.endTime),
        ...notSelf,
      },
    });
    if (vehicleConflict) {
      // Suggest the next free window of the same duration on this vehicle (SOW §13).
      const suggestion = await suggestVehicleFreeTime(
        data.vehicleId,
        data.organizationId,
        Number(data.startTime),
        Number(data.endTime) - Number(data.startTime),
        notSelf,
      );
      const hint = suggestion
        ? ` Next available at ${new Date(suggestion).toISOString().slice(0, 16).replace("T", " ")} (UTC).`
        : "";
      throw new Error(
        `Vehicle conflict: this vehicle is already booked for an overlapping time.${hint}`,
      );
    }

    // Vehicle seat capacity
    if (vehicle.capacity != null && data.requiredSeats > vehicle.capacity) {
      throw new Error(
        `Vehicle capacity (${vehicle.capacity}) is less than required seats (${data.requiredSeats})`,
      );
    }

    // Compliance gate: an expired 車検 (inspection) makes the vehicle illegal to
    // drive, so it can't be dispatched. Only enforced once a certificate is on
    // file — an org that hasn't uploaded one yet isn't locked out.
    await complianceService.assertVehicleRoadworthy(data.organizationId, data.vehicleId);
  }

  // ── Venue capacity across overlapping bookings → waitlist if full
  if (data.venueId) {
    const venue = await prisma.venue.findFirst({
      where: { id: data.venueId, organizationId: data.organizationId, isDeleted: false },
    });
    if (!venue) throw new Error("Venue not found");
    if (!venue.status) warnings.push("Venue is inactive");

    const overlappingAtVenue = await prisma.booking.findMany({
      where: {
        organizationId: data.organizationId,
        venueId: data.venueId,
        status: { in: ACTIVE_STATUSES },
        ...overlapWhere(data.startTime, data.endTime),
        ...notSelf,
      },
      select: { participantCount: true },
    });
    const usedSeats = overlappingAtVenue.reduce(
      (sum, b) => sum + (b.participantCount || 1),
      0,
    );
    if (venue.capacity != null && usedSeats + data.participantCount > venue.capacity) {
      shouldWaitlist = true;
      warnings.push("Venue capacity full — booking will be waitlisted");
    }
  }

  // ── Slot capacity → waitlist if full
  if (data.slotId) {
    const slot = await prisma.serviceSlot.findFirst({
      where: {
        id: data.slotId,
        organizationId: data.organizationId,
        isDeleted: false,
      },
      include: {
        service: {
          select: { maxParticipants: true, requiresGuardianAccompaniment: true },
        },
      },
    });
    if (!slot) throw new Error("Service slot not found");
    // Per-service participant cap (SOW §11) — a hard limit on one booking's size.
    const svcCap = slot.service?.maxParticipants;
    if (svcCap != null && (data.participantCount || 1) > svcCap) {
      throw new Error(`This service allows at most ${svcCap} participants per booking`);
    }
    // Recreation outings can require a parent/guardian to attend. The guardian
    // must answer, and answering "no" blocks the booking — an unaccompanied
    // child on an outing is the exact situation this flag exists to prevent.
    if (slot.service?.requiresGuardianAccompaniment) {
      if (data.guardianAccompanying == null) {
        throw new Error(
          "This service requires a parent or guardian to accompany the participant — please confirm whether someone will attend"
        );
      }
      if (data.guardianAccompanying !== true) {
        throw new Error(
          "This service requires a parent or guardian to accompany the participant. The booking cannot be made without accompaniment."
        );
      }
    }
    // When re-validating an existing booking (e.g. at approval), its seats were
    // already reserved into slot.bookedCount at create time — subtract them so
    // the booking isn't counted against its own reservation (which would falsely
    // flag a slot that the booking itself exactly filled as "now full").
    const ownReserved = excludeBookingId ? data.participantCount || 0 : 0;
    if (slot.bookedCount - ownReserved + data.participantCount > slot.capacity) {
      shouldWaitlist = true;
      warnings.push("Slot capacity full — booking will be waitlisted");
    }
  }

  // ── Staff ratio (warning only, override-able at approval)
  const requiredStaff = Math.ceil((data.participantCount || 1) / 5);
  if (data.serviceType === "DAYCARE" || data.serviceType === "RECREATION") {
    const staffCount = await prisma.user.count({
      where: {
        organizationId: data.organizationId,
        role: "STAFF",
        status: true,
        isDeleted: false,
      },
    });
    if (staffCount < requiredStaff) {
      warnings.push(
        `Insufficient staff: need ${requiredStaff}, have ${staffCount}`,
      );
    }
  }
  if (data.serviceType === "MOBILITY" && !data.vehicleId) {
    warnings.push("No vehicle assigned for mobility booking");
  }

  return { warnings, shouldWaitlist };
};

/** Normalize + authorize raw booking input into a persistable shape. */
const buildBookingData = async (raw, authData) => {
  if (!raw.participantId) throw new Error("Participant is required");
  if (!raw.serviceType) throw new Error("Service type is required");
  if (!raw.bookingDate || !raw.startTime || !raw.endTime) {
    throw new Error("Booking date, start time and end time are required");
  }
  // Times must be numeric epoch-ms — guard before BigInt() (which throws a raw
  // SyntaxError on non-numeric input → uncaught 500).
  const nDate = Number(raw.bookingDate);
  const nStart = Number(raw.startTime);
  const nEnd = Number(raw.endTime);
  if (!Number.isFinite(nDate) || !Number.isFinite(nStart) || !Number.isFinite(nEnd)) {
    throw new Error("Booking date and times must be valid timestamps");
  }
  if (nEnd <= nStart) {
    throw new Error("End time must be after start time");
  }
  if (nStart < Date.now()) {
    throw new Error("Cannot book a start time in the past");
  }

  const participant = await prisma.user.findFirst({
    where: {
      id: raw.participantId,
      role: "PARTICIPANT",
      isDeleted: false,
      organizationId: authData.organizationId,
    },
  });
  if (!participant) throw new Error("Participant not found");

  if (
    authData.role === "GUARDIAN" &&
    participant.guardianUserId !== authData.id
  ) {
    throw new Error("You can only book for your own participant");
  }

  const guardianId =
    participant.guardianUserId ||
    (authData.role === "GUARDIAN" ? authData.id : null);
  if (!guardianId) throw new Error("Participant has no linked guardian");

  return {
    organizationId: authData.organizationId,
    participantId: participant.id,
    guardianId,
    serviceType: raw.serviceType,
    bookingDate: BigInt(Math.trunc(nDate)),
    startTime: BigInt(Math.trunc(nStart)),
    endTime: BigInt(Math.trunc(nEnd)),
    // Preserve 0 (= no transport requested); only default when absent/invalid.
    requiredSeats: Number.isFinite(Number(raw.requiredSeats))
      ? Number(raw.requiredSeats)
      : 1,
    pickupAddress: raw.pickupAddress || null,
    // Tri-state on purpose: null = the service never asked. Only a real boolean
    // counts as an answer, so an absent field can't read as "no".
    guardianAccompanying:
      typeof raw.guardianAccompanying === "boolean"
        ? raw.guardianAccompanying
        : raw.guardianAccompanying === "true"
          ? true
          : raw.guardianAccompanying === "false"
            ? false
            : null,
    participantCount: Number(raw.participantCount) || 1,
    venueId: raw.venueId || null,
    vehicleId: raw.vehicleId || null,
    slotId: raw.slotId || null,
    purpose: raw.purpose || null,
    notes: raw.notes || null,
  };
};

const createBooking = async (raw, authData) => {
  const now = BigInt(Date.now());

  const organization = await prisma.organization.findUnique({
    where: { id: authData.organizationId },
  });
  if (!organization) throw new Error("Organization not found");

  const data = await buildBookingData(raw, authData);
  validateCreateBooking(data);
  const { warnings, shouldWaitlist } = await validateBooking(data);

  const { booking, status } = await prisma.$transaction(async (tx) => {
    // Venue-full (or other pre-checks) already force the waitlist.
    let finalStatus = shouldWaitlist
      ? BOOKING_STATUS.WAITLISTED
      : BOOKING_STATUS.PENDING;

    // Re-check venue capacity inside the tx (serialized per-venue) so two
    // concurrent venue bookings can't both pass the pre-tx check and overbook.
    // Done BEFORE slot reservation so a venue-full booking never holds slot seats.
    if (data.venueId && finalStatus === BOOKING_STATUS.PENDING) {
      const hasRoom = await venueHasRoomInTx(tx, data, data.participantCount);
      if (!hasRoom) {
        finalStatus = BOOKING_STATUS.WAITLISTED;
        if (!warnings.includes("Venue capacity full — booking will be waitlisted")) {
          warnings.push("Venue capacity full — booking will be waitlisted");
        }
      }
    }

    // Atomic slot reservation — guards against the TOCTOU race where two
    // concurrent bookings both pass validateBooking() and overbook the slot.
    // The conditional UPDATE only succeeds if capacity is still available;
    // 0 rows affected means the slot filled in between → waitlist instead.
    if (data.slotId && finalStatus === BOOKING_STATUS.PENDING) {
      const reserved = await reserveSlotSeats(
        tx,
        data.slotId,
        data.participantCount,
        now,
      );
      if (!reserved) {
        finalStatus = BOOKING_STATUS.WAITLISTED;
        warnings.push("Slot capacity full — booking will be waitlisted");
      }
    }

    const bookingCode = await nextBookingCode(tx, authData.organizationId);
    const created = await tx.booking.create({
      data: {
        ...data,
        bookingCode,
        status: finalStatus,
        operationalNotes: warnings.join(", "),
        createdAt: now,
        updatedAt: now,
      },
    });
    return { booking: created, status: finalStatus };
  });

  await logAudit({
    authData,
    action: "CREATE",
    entity: "Booking",
    entityId: booking.id,
    after: booking,
    metadata: { status, warnings },
  });

  await notifyManagersOfBooking(booking);
  return booking;
};

/**
 * Notify an org's managers (NPO_ADMIN/COORDINATOR) that a booking needs review.
 * In-app only; best-effort — never throws into booking creation.
 */
const notifyManagersOfBooking = async (booking) => {
  try {
    const managers = await prisma.user.findMany({
      where: {
        organizationId: booking.organizationId,
        role: { in: ["NPO_ADMIN", "COORDINATOR"] },
        status: true,
        isDeleted: false,
      },
      select: { id: true },
    });
    if (managers.length === 0) return;
    const waitlisted = booking.status === BOOKING_STATUS.WAITLISTED;
    await notificationService.notifyMany(
      managers.map((m) => m.id),
      {
        organizationId: booking.organizationId,
        type: "BOOKING_CREATED",
        title: waitlisted ? "New booking (waitlisted)" : "New booking request",
        message: `A new ${booking.serviceType} booking is awaiting review.`,
        relatedBookingId: booking.id,
      },
    );
  } catch (err) {
    console.error("[booking] manager notify failed:", err.message);
  }
};

/**
 * Create a recurring series. recurrence = { frequency: DAILY|WEEKLY, count }.
 * Each occurrence validated independently; conflicting ones are skipped and
 * reported back rather than aborting the whole series.
 */
const createRecurringBookings = async (raw, authData) => {
  const frequency = raw.recurrence?.frequency;
  const count = Number(raw.recurrence?.count) || 0;

  if (!["DAILY", "WEEKLY"].includes(frequency)) {
    throw new Error("recurrence.frequency must be DAILY or WEEKLY");
  }
  if (count < 1 || count > 52) {
    throw new Error("recurrence.count must be between 1 and 52");
  }

  // Optional: for DAILY series, skip Saturday/Sunday occurrences so a weekday
  // program doesn't book weekends. Ignored for WEEKLY (same weekday each step).
  const skipWeekends = frequency === "DAILY" && Boolean(raw.recurrence?.skipWeekends);
  const stepDays = frequency === "DAILY" ? 1 : 7;

  // Add `n` calendar days to an epoch-ms BigInt, preserving wall-clock time-of-day
  // (DST-safe — fixed-ms stepping shifts the time ±1h across DST).
  const addDays = (msBig, days) => {
    const d = new Date(Number(msBig));
    d.setDate(d.getDate() + days);
    return BigInt(d.getTime());
  };
  const isWeekend = (msBig) => {
    const wd = new Date(Number(msBig)).getDay();
    return wd === 0 || wd === 6;
  };

  // Validate base shape once (also resolves guardian/participant).
  // A fixed-time slot cannot apply to a shifting series, so drop slotId —
  // each occurrence is validated against venue/vehicle/duplicate only.
  const base = await buildBookingData(raw, authData);
  validateCreateBooking(base);
  base.slotId = null;
  const recurrenceGroupId = `rec_${Date.now()}_${base.participantId.slice(0, 8)}`;
  const now = BigInt(Date.now());

  // Build the list of calendar-day offsets for `count` occurrences. When
  // skipping weekends, walk day-by-day past Sat/Sun until `count` weekdays land.
  const offsets = [];
  if (skipWeekends) {
    let day = 0;
    while (offsets.length < count && day < count * 7 + 14) {
      if (!isWeekend(addDays(base.bookingDate, day))) offsets.push(day);
      day += 1;
    }
  } else {
    for (let i = 0; i < count; i++) offsets.push(i * stepDays);
  }

  const created = [];
  const skipped = [];

  for (let idx = 0; idx < offsets.length; idx++) {
    const off = offsets[idx];
    const i = idx;
    const occurrence = {
      ...base,
      bookingDate: addDays(base.bookingDate, off),
      startTime: addDays(base.startTime, off),
      endTime: addDays(base.endTime, off),
    };

    try {
      const { warnings, shouldWaitlist } = await validateBooking(occurrence);
      const status = shouldWaitlist
        ? BOOKING_STATUS.WAITLISTED
        : BOOKING_STATUS.PENDING;

      const booking = await prisma.$transaction(async (tx) => {
        const bookingCode = await nextBookingCode(tx, authData.organizationId);
        const b = await tx.booking.create({
          data: {
            ...occurrence,
            bookingCode,
            status,
            operationalNotes: warnings.join(", "),
            isRecurring: true,
            recurrenceGroupId,
            recurrenceRule: { frequency, count, index: i, skipWeekends },
            createdAt: now,
            updatedAt: now,
          },
        });
        // No slot reservation here: a recurring series drops slotId (base.slotId
        // is forced null above), so occurrences are never slot-bound.
        return b;
      });
      created.push(booking);
    } catch (err) {
      skipped.push({
        index: i,
        date: occurrence.bookingDate.toString(),
        reason: err.message,
      });
    }
  }

  await logAudit({
    authData,
    action: "CREATE",
    entity: "Booking",
    metadata: { recurrenceGroupId, created: created.length, skipped },
  });

  // One review notification for the whole series.
  if (created.length > 0) await notifyManagersOfBooking(created[0]);

  return { recurrenceGroupId, created, skipped };
};

/**
 * Also notify the booking's PARTICIPANT (when they have their own login).
 *
 * A participant is a User row (role PARTICIPANT) a guardian books FOR. Many have
 * no account — `participantId` is set but nobody signs in as them — so we notify
 * only when a real, active PARTICIPANT user exists. Self-contained (fetches the
 * participantId by bookingId) so every call site can pass just the id, and fully
 * guarded: a status change must never fail because a courtesy notify did.
 */
const notifyBookingParticipant = async (bookingId, organizationId, payload) => {
  try {
    const booking = await prisma.booking.findFirst({
      where: { id: bookingId, organizationId },
      select: { participantId: true },
    });
    if (!booking?.participantId) return;

    const participant = await prisma.user.findFirst({
      where: {
        id: booking.participantId,
        role: "PARTICIPANT",
        status: true,
        isDeleted: false,
      },
      select: { id: true, email: true },
    });
    if (!participant) return;

    await notificationService.notify({
      ...payload,
      userId: participant.id,
      organizationId,
      relatedBookingId: bookingId,
      email: participant.email,
    });
  } catch (err) {
    console.error("[booking] participant notify failed:", err.message);
  }
};

/** Notify the guardian + audit a single waitlist→pending promotion. */
const notifyPromotion = async (promoted, organizationId) => {
  const guardian = await prisma.user.findUnique({
    where: { id: promoted.guardianId },
    select: { id: true, email: true },
  });
  if (guardian) {
    await notificationService.notify({
      userId: guardian.id,
      organizationId,
      type: "BOOKING_PROMOTED",
      title: "Booking confirmed from waitlist",
      message:
        "A spot opened up and your waitlisted booking is now pending approval.",
      relatedBookingId: promoted.id,
      email: guardian.email,
      emailSubject: "Your booking moved off the waitlist",
    });
  }
  await notifyBookingParticipant(promoted.id, organizationId, {
    type: "BOOKING_PROMOTED",
    title: "Booking confirmed from waitlist",
    message: "A spot opened up and your booking is now pending approval.",
    emailSubject: "Your booking moved off the waitlist",
  });
  await logAudit({
    authData: { organizationId },
    action: "STATUS_CHANGE",
    entity: "Booking",
    entityId: promoted.id,
    after: { status: promoted.status },
    metadata: { reason: "auto-promote from waitlist" },
  });
};

/**
 * Promote waitlisted bookings on a slot. Loops FIFO, promoting the oldest
 * waitlisted booking that FITS the freed seats, until no candidate fits —
 * so freeing N seats can promote several small bookings, not just the head
 * (which previously stalled the whole queue when the head was too big to fit).
 * Each promotion reserves seats atomically via reserveSlotSeats().
 */
const promoteSlotWaitlist = async (slotId, organizationId) => {
  const promotedList = [];

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const promoted = await prisma.$transaction(async (tx) => {
      const slot = await tx.serviceSlot.findUnique({ where: { id: slotId } });
      if (!slot) return null;
      const freeSeats = slot.capacity - slot.bookedCount;
      if (freeSeats <= 0) return null;

      const candidate = await tx.booking.findFirst({
        where: {
          slotId,
          organizationId,
          status: BOOKING_STATUS.WAITLISTED,
          participantCount: { lte: freeSeats },
        },
        orderBy: { createdAt: "asc" },
      });
      if (!candidate) return null;

      const reserved = await reserveSlotSeats(
        tx,
        slotId,
        candidate.participantCount,
        BigInt(Date.now()),
      );
      if (!reserved) return null; // raced — bail, next caller retries

      return tx.booking.update({
        where: { id: candidate.id },
        data: {
          status: BOOKING_STATUS.PENDING,
          // Clear notes so approveBooking isn't blocked by a stale warning.
          // The promotion itself is recorded in the audit log + notification.
          operationalNotes: "",
          updatedAt: BigInt(Date.now()),
        },
      });
    });

    if (!promoted) break;
    promotedList.push(promoted);
  }

  for (const p of promotedList) await notifyPromotion(p, organizationId);
  return promotedList;
};

/**
 * Promote venue-waitlisted bookings. Venues have no seat counter — capacity is
 * computed live from overlapping ACTIVE bookings — so re-run validateBooking()
 * FIFO and promote each that now fits. Promoting one flips it to ACTIVE, so the
 * next candidate's re-check sees the updated venue usage. Slot+venue bookings
 * are owned by the slot path and skipped here to avoid double promotion.
 */
const promoteVenueWaitlist = async (venueId, organizationId) => {
  const candidates = await prisma.booking.findMany({
    where: {
      venueId,
      slotId: null,
      organizationId,
      status: BOOKING_STATUS.WAITLISTED,
    },
    orderBy: { createdAt: "asc" },
  });

  const promotedList = [];
  for (const c of candidates) {
    try {
      const { shouldWaitlist } = await validateBooking(c, {
        excludeBookingId: c.id,
      });
      if (shouldWaitlist) continue; // venue still full
      const promoted = await prisma.booking.update({
        where: { id: c.id },
        data: {
          status: BOOKING_STATUS.PENDING,
          // Clear notes so approveBooking isn't blocked by a stale warning.
          operationalNotes: "",
          updatedAt: BigInt(Date.now()),
        },
      });
      promotedList.push(promoted);
    } catch {
      // a hard conflict (vehicle/duplicate) now exists — leave it waitlisted
    }
  }

  for (const p of promotedList) await notifyPromotion(p, organizationId);
  return promotedList;
};

/**
 * After a booking frees a resource (cancel/reject/complete), promote whatever
 * waitlisted bookings now fit — on the freed slot and/or venue.
 */
const autoPromoteWaitlist = async (freedBooking) => {
  if (!freedBooking) return [];
  const { slotId, venueId, organizationId } = freedBooking;
  const promoted = [];
  if (slotId) {
    promoted.push(...(await promoteSlotWaitlist(slotId, organizationId)));
  }
  if (venueId) {
    promoted.push(...(await promoteVenueWaitlist(venueId, organizationId)));
  }
  return promoted;
};

/** Release a slot seat held by a booking (used on cancel/reject/complete). */
const releaseSlot = async (booking) => {
  if (
    booking.slotId &&
    [BOOKING_STATUS.PENDING, BOOKING_STATUS.APPROVED].includes(booking.status)
  ) {
    await prisma.serviceSlot.update({
      where: { id: booking.slotId },
      data: { bookedCount: { decrement: booking.participantCount } },
    });
  }
};

/**
 * Build Prisma pagination args from raw query. Opt-in: when no `take` is
 * supplied the full set is returned (preserves existing callers/UI). `take` is
 * clamped to [1, 200] to cap worst-case payloads.
 */
const pageArgs = ({ take, skip } = {}) => {
  if (take == null) return {};
  const t = Math.min(Math.max(Number(take) || 0, 1), 200);
  return { take: t, skip: Math.max(Number(skip) || 0, 0) };
};

// Scoped relation select for booking lists. Never use `participant: true` /
// `guardian: true` — participant/guardian are User rows and a bare include
// leaks password + reset/verify tokens to the client. Only UI-needed columns.
const BOOKING_LIST_RELATIONS = {
  participant: {
    select: {
      id: true,
      fullName: true,
      profileImage: true,
      phone: true,
      serviceType: true,
      dateOfBirth: true,
      mobilitySupport: true,
      needsWheelchair: true,
      medicalNotes: true,
      allergyNotes: true,
      emergencyInstructions: true,
    },
  },
  guardian: { select: { id: true, fullName: true, profileImage: true, phone: true, email: true } },
  vehicle: { select: { id: true, vehicleName: true, vehicleNumber: true, capacity: true } },
  venue: { select: { id: true, name: true, address: true, capacity: true } },
  // Assigned staff + their progress. `endLat/endLng/endLocationAt` = the final
  // GPS fix saved when the task finished, so the list can show where a trip
  // actually ended (safe select — never a bare user include).
  staffAssignments: {
    where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
    select: {
      id: true,
      assignmentRole: true,
      status: true,
      startedAt: true,
      endedAt: true,
      endLat: true,
      endLng: true,
      endLocationAt: true,
      user: { select: { id: true, fullName: true, profileImage: true } },
    },
  },
  // Surface incidents (delays/issues) on the booking so guardians + managers
  // see them inline. Newest first.
  incidents: {
    where: { isDeleted: false },
    select: { id: true, type: true, severity: true, status: true, title: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  },
};

const getPendingBookings = async (organizationId, paging) => {
  return prisma.booking.findMany({
    where: { status: BOOKING_STATUS.PENDING, organizationId },
    include: BOOKING_LIST_RELATIONS,
    // Review queue ordered by service date (soonest first) — recurring series
    // now read sequentially instead of by creation order.
    orderBy: { startTime: "asc" },
    ...pageArgs(paging),
  });
};

const getWaitlistedBookings = async (organizationId, paging) => {
  return prisma.booking.findMany({
    where: { status: BOOKING_STATUS.WAITLISTED, organizationId },
    include: BOOKING_LIST_RELATIONS,
    orderBy: { createdAt: "asc" },
    ...pageArgs(paging),
  });
};

const allBookings = async (authData, paging) => {
  const where = { organizationId: authData.organizationId };
  if (authData.role === "GUARDIAN") where.guardianId = authData.id;
  // Participants get a read-only view of their own bookings (participant portal).
  if (authData.role === "PARTICIPANT") where.participantId = authData.id;

  return prisma.booking.findMany({
    where,
    include: BOOKING_LIST_RELATIONS,
    orderBy: { startTime: "desc" },
    ...pageArgs(paging),
  });
};

const getMyBookings = async (authData) => {
  return prisma.booking.findMany({
    where: {
      organizationId: authData.organizationId,
      guardianId: authData.id,
    },
    // Reuse the shared safe select. The previous ad-hoc `include` pulled EVERY
    // scalar off staffAssignments — including the live `lastLat`/`lastLng` — so
    // a guardian polling this endpoint got the driver's exact position and
    // bypassed the deliberate ~110 m blur in `location.service`. The blur is
    // only meaningful if every guardian-reachable path applies it.
    include: BOOKING_LIST_RELATIONS,
    orderBy: { startTime: "desc" },
  });
};

// Compact, role-aware booking list for the incident-report picker. Managers see
// recent org bookings; staff see only bookings they're assigned to (so they
// can't tie an incident to an unrelated booking). Safe select only.
const getBookingsForIncident = async (authData) => {
  const where = { organizationId: authData.organizationId };
  const isManager = ["NPO_ADMIN", "COORDINATOR"].includes(authData.role);
  if (!isManager) {
    // Staff: restrict to bookings they have an active assignment on.
    where.staffAssignments = {
      some: { userId: authData.id, status: { notIn: ["CANCELLED", "DECLINED"] } },
    };
  }
  return prisma.booking.findMany({
    where,
    select: {
      id: true,
      bookingCode: true,
      serviceType: true,
      startTime: true,
      status: true,
      participant: { select: { id: true, fullName: true, profileImage: true } },
      vehicle: { select: { id: true, vehicleNumber: true } },
    },
    orderBy: { startTime: "desc" },
    take: 100,
  });
};

// Statuses a booking can be cancelled from. APPROVED included so guardians/
// managers can cancel after approval (staff already assigned get released).
const CANCELLABLE_STATUSES = [
  BOOKING_STATUS.PENDING,
  BOOKING_STATUS.WAITLISTED,
  BOOKING_STATUS.APPROVED,
];

/**
 * Cancel a booking's active staff assignments and notify each affected staff
 * member. Only meaningful for APPROVED bookings that had staff assigned.
 */
const releaseStaffAssignments = async (booking, reason) => {
  const assignments = await prisma.bookingStaffAssignment.findMany({
    // COMPLETED stays COMPLETED — cancelling the booking must not erase the
    // record of work already done (it feeds attendance/report hours).
    where: { bookingId: booking.id, status: { notIn: ["CANCELLED", "COMPLETED"] } },
    select: { id: true, userId: true },
  });
  if (assignments.length === 0) return;

  await prisma.bookingStaffAssignment.updateMany({
    where: { id: { in: assignments.map((a) => a.id) } },
    data: { status: "CANCELLED", updatedAt: BigInt(Date.now()) },
  });

  for (const a of assignments) {
    const staff = await prisma.user.findUnique({
      where: { id: a.userId },
      select: { id: true, email: true },
    });
    if (!staff) continue;
    await notificationService.notify({
      userId: staff.id,
      organizationId: booking.organizationId,
      type: "BOOKING_CANCELLED",
      title: "Assigned booking cancelled",
      message: reason
        ? `A booking you were assigned to was cancelled: ${reason}`
        : "A booking you were assigned to was cancelled.",
      relatedBookingId: booking.id,
      email: staff.email,
      emailSubject: "Booking assignment cancelled",
    });
  }
};

const cancelBooking = async (bookingId, authData, reason) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: authData.organizationId },
  });
  if (!booking) throw new Error("Booking not found");

  if (authData.role === "GUARDIAN" && booking.guardianId !== authData.id) {
    throw new Error("You can only cancel your own booking");
  }
  if (!CANCELLABLE_STATUSES.includes(booking.status)) {
    throw new Error(
      "Only a pending, waitlisted or approved booking can be cancelled",
    );
  }

  const cancellationReason =
    reason ||
    (authData.role === "GUARDIAN" ? "Cancelled by guardian" : "Cancelled");

  // Release seat first so capacity frees before waitlist promotion.
  await releaseSlot(booking);
  if (booking.status === BOOKING_STATUS.APPROVED) {
    await releaseStaffAssignments(booking, cancellationReason);
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: BOOKING_STATUS.CANCELLED,
      cancellationReason,
      updatedAt: BigInt(Date.now()),
    },
  });

  await logAudit({
    authData,
    action: "STATUS_CHANGE",
    entity: "Booking",
    entityId: bookingId,
    before: { status: booking.status },
    after: { status: updated.status },
    metadata: { cancellationReason },
  });

  await notifyBookingParticipant(bookingId, booking.organizationId, {
    type: "BOOKING_CANCELLED",
    title: "Booking cancelled",
    message: cancellationReason || "Your booking has been cancelled.",
    emailSubject: "Your booking was cancelled",
  });

  await autoPromoteWaitlist(booking);
  return updated;
};

/**
 * Cancel every still-active booking matching `filter` (used by cascade deletes
 * of a participant/guardian). Releases seat + staff, promotes waitlist, and
 * notifies the guardian per booking. Best-effort per booking. Returns count.
 */
const cancelActiveBookingsFor = async (filter, organizationId, reason) => {
  const bookings = await prisma.booking.findMany({
    where: { ...filter, organizationId, status: { in: CANCELLABLE_STATUSES } },
    select: { id: true, status: true, slotId: true, venueId: true, guardianId: true, participantCount: true, organizationId: true },
  });
  let cancelled = 0;
  for (const booking of bookings) {
    try {
      await releaseSlot(booking);
      if (booking.status === BOOKING_STATUS.APPROVED) {
        await releaseStaffAssignments(booking, reason);
      }
      await prisma.booking.update({
        where: { id: booking.id },
        data: {
          status: BOOKING_STATUS.CANCELLED,
          cancellationReason: reason,
          updatedAt: BigInt(Date.now()),
        },
      });
      await autoPromoteWaitlist(booking);
      cancelled += 1;
    } catch (err) {
      console.error(`[cascade-cancel] booking ${booking.id} failed:`, err.message);
    }
  }
  return cancelled;
};

/**
 * A staff member is being removed/deactivated: cancel their active assignments
 * on upcoming bookings (booking stays but loses this staff), then notify the
 * guardian + managers that each affected booking now needs re-staffing.
 * Best-effort. Returns count of assignments released.
 */
const releaseStaffFromUpcoming = async (userId, organizationId, reason) => {
  const now = BigInt(Date.now());
  const assignments = await prisma.bookingStaffAssignment.findMany({
    where: {
      userId,
      organizationId,
      status: { notIn: ["CANCELLED", "DECLINED"] },
      booking: { status: { in: ["PENDING", "APPROVED"] }, startTime: { gte: now } },
    },
    select: { id: true, bookingId: true, booking: { select: { guardianId: true, bookingCode: true } } },
  });
  if (assignments.length === 0) return 0;

  await prisma.bookingStaffAssignment.updateMany({
    where: { id: { in: assignments.map((a) => a.id) } },
    data: { status: "CANCELLED", updatedAt: BigInt(Date.now()) },
  });

  const managers = await prisma.user.findMany({
    where: { organizationId, role: { in: ["NPO_ADMIN", "COORDINATOR"] }, status: true, isDeleted: false },
    select: { id: true },
  });

  for (const a of assignments) {
    // Guardian: their booking lost its assigned staff.
    if (a.booking?.guardianId) {
      await notificationService.notify({
        userId: a.booking.guardianId,
        organizationId,
        type: "BOOKING_UPDATED",
        title: "Staff change on your booking",
        message: `A staff member on booking ${a.booking.bookingCode || ""} is no longer available. The team is re-assigning.`,
        relatedBookingId: a.bookingId,
      });
    }
    // Managers: needs re-staffing.
    if (managers.length > 0) {
      await notificationService.notifyMany(
        managers.map((m) => m.id),
        {
          organizationId,
          type: "BOOKING_UPDATED",
          title: "Booking needs re-staffing",
          message: `Booking ${a.booking?.bookingCode || ""} lost a staff member (${reason}). Please assign a replacement.`,
          relatedBookingId: a.bookingId,
        },
      );
    }
  }
  return assignments.length;
};

/**
 * Staff capacity just increased (new staff added, or a staff member freed up
 * after a cancellation/completion). If upcoming APPROVED bookings are still
 * short on staff, notify managers so they can assign — one summary, not spam.
 */
const notifyUnderstaffedBookings = async (organizationId) => {
  const now = BigInt(Date.now());
  const upcoming = await prisma.booking.findMany({
    where: { organizationId, status: "APPROVED", startTime: { gte: now } },
    select: {
      id: true,
      participantCount: true,
      staffAssignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, select: { id: true } },
    },
    take: 200,
  });
  const short = upcoming.filter(
    (b) => b.staffAssignments.length < Math.max(1, Math.ceil((b.participantCount || 1) / 5)),
  );
  if (short.length === 0) return 0;

  const managers = await prisma.user.findMany({
    where: { organizationId, role: { in: ["NPO_ADMIN", "COORDINATOR"] }, status: true, isDeleted: false },
    select: { id: true },
  });
  if (managers.length === 0) return short.length;

  await notificationService.notifyMany(
    managers.map((m) => m.id),
    {
      organizationId,
      type: "STAFF_AVAILABLE",
      title: "Staff available for unstaffed bookings",
      message: `${short.length} upcoming approved booking(s) still need staff. Open Dispatch to assign.`,
    },
  );
  return short.length;
};

/**
 * Cancel every still-active booking in a recurring series. Guardians may only
 * cancel their own series; managers may cancel any in their org. Each
 * occurrence is released + waitlist-promoted individually.
 */
const cancelSeries = async (recurrenceGroupId, authData, reason) => {
  const where = {
    recurrenceGroupId,
    organizationId: authData.organizationId,
    status: { in: CANCELLABLE_STATUSES },
  };
  if (authData.role === "GUARDIAN") where.guardianId = authData.id;

  const bookings = await prisma.booking.findMany({ where });
  if (bookings.length === 0) {
    throw new Error("No cancellable bookings found for this series");
  }

  const cancelled = [];
  const skipped = [];
  for (const b of bookings) {
    try {
      // Re-validates status per item — tolerates a concurrent state change
      // on one occurrence without aborting the rest of the series.
      const updated = await cancelBooking(b.id, authData, reason);
      cancelled.push(updated.id);
    } catch (err) {
      skipped.push({ id: b.id, reason: err.message });
    }
  }

  await logAudit({
    authData,
    action: "STATUS_CHANGE",
    entity: "Booking",
    metadata: {
      recurrenceGroupId,
      cancelledCount: cancelled.length,
      skipped,
      reason,
    },
  });

  return { recurrenceGroupId, cancelled, skipped };
};

// Minimum staffing a service needs for `participantCount` people (SOW §11):
// max of the flat minimum and the per-block ratio.
const staffingRequirement = (service, participantCount) => {
  if (!service) return { support: 0, drivers: 0, assistants: 0 };
  const blocks = service.ratioParticipantsPer > 0
    ? Math.ceil((participantCount || 1) / service.ratioParticipantsPer)
    : 0;
  return {
    support: Math.max(service.minSupportStaff || 0, blocks * (service.ratioSupportStaff || 0)),
    drivers: Math.max(service.minDrivers || 0, blocks * (service.ratioDrivers || 0)),
    assistants: Math.max(service.minAssistants || 0, blocks * (service.ratioAssistants || 0)),
  };
};

// Assigned staff on a booking, tallied by assignmentRole: drivers, assistants,
// everything-else = support.
const assignedStaffTally = async (bookingId) => {
  const assignments = await prisma.bookingStaffAssignment.findMany({
    where: { bookingId, status: { notIn: ["CANCELLED", "DECLINED"] } },
    select: { assignmentRole: true },
  });
  const have = { support: 0, drivers: 0, assistants: 0 };
  for (const a of assignments) {
    const r = String(a.assignmentRole || "").toUpperCase();
    if (r.includes("DRIVER")) have.drivers++;
    else if (r.includes("ASSISTANT")) have.assistants++;
    else have.support++;
  }
  return have;
};

// Returns a shortfall message if the booking's assigned staff fall below the
// service's minimum staffing config, else null. Override-able at approval.
const staffingShortfall = async (booking) => {
  if (!booking.slotId) return null; // custom-time bookings have no fixed service
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
  const have = await assignedStaffTally(booking.id);
  const short = [];
  if (have.support < req.support) short.push(`support ${have.support}/${req.support}`);
  if (have.drivers < req.drivers) short.push(`drivers ${have.drivers}/${req.drivers}`);
  if (have.assistants < req.assistants) short.push(`assistants ${have.assistants}/${req.assistants}`);
  return short.length ? short.join(", ") : null;
};

const approveBooking = async (bookingId, reviewedBy, forceApprove = false, organizationId) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
  });
  if (!booking) throw new Error("Booking not found");
  if (booking.status !== BOOKING_STATUS.PENDING) {
    throw new Error("Only pending booking can be approved");
  }
  if (booking.operationalNotes && !forceApprove) {
    throw new Error(
      `Booking has operational warnings: ${booking.operationalNotes}. Pass forceApprove=true to override.`,
    );
  }

  // Always re-run the validator so hard conflicts (duplicate participant,
  // vehicle overlap) can never be force-approved. `forceApprove` only overrides
  // warnings/capacity pressure that would otherwise keep the booking pending.
  const { shouldWaitlist } = await validateBooking(booking, {
    excludeBookingId: bookingId,
  });
  if (shouldWaitlist && !forceApprove) {
    throw new Error(
      "Capacity is now full for this slot/venue. Pass forceApprove=true to override.",
    );
  }

  // Minimum staffing configuration (SOW §11) — block approval below the service's
  // configured minimum unless the manager overrides (Approve / Decline / Add staff).
  if (!forceApprove) {
    const shortfall = await staffingShortfall(booking);
    if (shortfall) {
      throw new Error(
        `Staffing below the service minimum (${shortfall}). Assign more staff, or pass forceApprove=true to approve anyway.`,
      );
    }
  }

  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: BOOKING_STATUS.APPROVED,
      approvedBy: reviewedBy,
      updatedAt: BigInt(Date.now()),
    },
  });

  await logAudit({
    authData: { id: reviewedBy, organizationId: booking.organizationId },
    action: forceApprove ? "OVERRIDE" : "STATUS_CHANGE",
    entity: "Booking",
    entityId: bookingId,
    before: { status: booking.status },
    after: { status: updated.status },
    metadata: forceApprove ? { override: booking.operationalNotes } : null,
  });

  // notify guardian
  const guardian = await prisma.user.findUnique({
    where: { id: booking.guardianId },
    select: { id: true, email: true },
  });
  if (guardian) {
    await notificationService.notify({
      userId: guardian.id,
      organizationId: booking.organizationId,
      type: "BOOKING_APPROVED",
      title: "Booking approved",
      message: "Your booking has been approved.",
      relatedBookingId: bookingId,
      email: guardian.email,
      emailSubject: "Your booking was approved",
    });
  }
  await notifyBookingParticipant(bookingId, booking.organizationId, {
    type: "BOOKING_APPROVED",
    title: "Booking approved",
    message: "Your booking has been approved.",
    emailSubject: "Your booking was approved",
  });

  return updated;
};

const rejectBooking = async (bookingId, reviewedBy, cancellationReason, organizationId) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
  });
  if (!booking) throw new Error("Booking not found");
  // Waitlisted bookings are rejectable too (the Approvals waitlist panel
  // offers Reject); releaseSlot() is a no-op for them — no seats held.
  if (![BOOKING_STATUS.PENDING, BOOKING_STATUS.WAITLISTED].includes(booking.status)) {
    throw new Error("Only a pending or waitlisted booking can be rejected");
  }

  await releaseSlot(booking);
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: {
      status: BOOKING_STATUS.REJECTED,
      cancellationReason,
      updatedAt: BigInt(Date.now()),
    },
  });

  await logAudit({
    authData: { id: reviewedBy, organizationId: booking.organizationId },
    action: "STATUS_CHANGE",
    entity: "Booking",
    entityId: bookingId,
    before: { status: booking.status },
    after: { status: updated.status },
    metadata: { cancellationReason },
  });

  const guardian = await prisma.user.findUnique({
    where: { id: booking.guardianId },
    select: { id: true, email: true },
  });
  if (guardian) {
    await notificationService.notify({
      userId: guardian.id,
      organizationId: booking.organizationId,
      type: "BOOKING_REJECTED",
      title: "Booking rejected",
      message: cancellationReason || "Your booking was rejected.",
      relatedBookingId: bookingId,
      email: guardian.email,
      emailSubject: "Your booking was rejected",
    });
  }
  await notifyBookingParticipant(bookingId, booking.organizationId, {
    type: "BOOKING_REJECTED",
    title: "Booking rejected",
    message: cancellationReason || "Your booking was rejected.",
    emailSubject: "Your booking was rejected",
  });

  await autoPromoteWaitlist(booking);
  return updated;
};

const completeBooking = async (bookingId, organizationId) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId },
  });
  if (!booking) throw new Error("Booking not found");
  if (booking.status !== BOOKING_STATUS.APPROVED) {
    throw new Error("Only approved booking can complete");
  }

  await releaseSlot(booking);
  const updated = await prisma.booking.update({
    where: { id: bookingId },
    data: { status: BOOKING_STATUS.COMPLETED, updatedAt: BigInt(Date.now()) },
  });

  await logAudit({
    authData: { organizationId: booking.organizationId },
    action: "STATUS_CHANGE",
    entity: "Booking",
    entityId: bookingId,
    before: { status: booking.status },
    after: { status: updated.status },
  });

  // Notify the guardian the booking is complete (covers a manager completing
  // directly — the staff-side completeTask notifies on its own path).
  const guardian = await prisma.user.findUnique({
    where: { id: booking.guardianId },
    select: { id: true, email: true },
  });
  if (guardian) {
    await notificationService.notify({
      userId: guardian.id,
      organizationId: booking.organizationId,
      type: "BOOKING_COMPLETED",
      title: "Booking completed",
      message: "Your booking has been marked as completed.",
      relatedBookingId: bookingId,
      email: guardian.email,
      emailSubject: "Your booking is complete",
    });
  }
  await notifyBookingParticipant(bookingId, booking.organizationId, {
    type: "BOOKING_COMPLETED",
    title: "Booking completed",
    message: "Your booking has been marked as completed.",
    emailSubject: "Your booking is complete",
  });

  await autoPromoteWaitlist(booking);
  return updated;
};

/**
 * Send pre-start reminders for APPROVED bookings, honoring each org's
 * configured reminder intervals (Organization.reminderHours, e.g. [168,48,24]).
 * Every interval fires once per booking — `remindersSent` records which
 * hours-before marks already fired (idempotent across cron runs). Notifies the
 * guardian + each active assigned staff member. Returns count of reminders sent.
 * `windowMs` kept for backward compat (cron callers) but the per-org intervals
 * decide what is actually due.
 */
const sendDueReminders = async (windowMs = 24 * 60 * 60 * 1000) => {
  const now = Date.now();

  const orgs = await prisma.organization.findMany({
    where: { status: "ACTIVE", isDeleted: false },
    select: { id: true, reminderHours: true },
  });

  let reminded = 0;
  for (const org of orgs) {
    const intervals = (org.reminderHours?.length ? org.reminderHours : [24])
      .filter((h) => Number.isFinite(h) && h > 0)
      .sort((a, b) => b - a);
    if (intervals.length === 0) continue;
    const maxMs = Math.max(intervals[0] * 3600000, windowMs);

    const due = await prisma.booking.findMany({
      where: {
        organizationId: org.id,
        status: BOOKING_STATUS.APPROVED,
        startTime: { gte: BigInt(now), lte: BigInt(now + maxMs) },
      },
      include: {
        guardian: { select: { id: true, email: true } },
        staffAssignments: {
          where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
          select: { userId: true },
        },
      },
    });

    for (const b of due) {
      const hoursUntil = (Number(b.startTime) - now) / 3600000;
      // Fire every configured interval whose mark has been reached and hasn't
      // fired yet (e.g. at 40h before start with [168,48,24]: 168 + 48 fire).
      const pending = intervals.filter(
        (h) => hoursUntil <= h && !(b.remindersSent || []).includes(h),
      );
      if (pending.length === 0) continue;

      // Stamp first so a notify failure can't cause an infinite re-send loop.
      await prisma.booking.update({
        where: { id: b.id },
        data: {
          reminderSentAt: BigInt(Date.now()),
          remindersSent: { set: [...(b.remindersSent || []), ...pending] },
        },
      });

      // Per-booking try/catch so one notify failure doesn't abort the sweep.
      try {
        if (b.guardian) {
          await notificationService.notify({
            userId: b.guardian.id,
            organizationId: b.organizationId,
            type: "BOOKING_REMINDER",
            title: "Upcoming booking reminder",
            message: "You have a booking coming up soon.",
            relatedBookingId: b.id,
            email: b.guardian.email,
            emailSubject: "Reminder: your upcoming booking",
          });
        }

        await notifyBookingParticipant(b.id, b.organizationId, {
          type: "BOOKING_REMINDER",
          title: "Upcoming booking reminder",
          message: "You have a booking coming up soon.",
          emailSubject: "Reminder: your upcoming booking",
        });

        for (const a of b.staffAssignments) {
          const staff = await prisma.user.findUnique({
            where: { id: a.userId },
            select: { id: true, email: true },
          });
          if (!staff) continue;
          await notificationService.notify({
            userId: staff.id,
            organizationId: b.organizationId,
            type: "BOOKING_REMINDER",
            title: "Upcoming assignment reminder",
            message: "You have an assigned booking coming up soon.",
            relatedBookingId: b.id,
            email: staff.email,
            emailSubject: "Reminder: your upcoming assignment",
          });
        }
        reminded += 1;
      } catch (err) {
        console.error(`[reminder] notify failed for booking ${b.id}:`, err.message);
      }
    }
  }

  return { reminded };
};

/**
 * Post-approval staffing monitor + missing check-in sweep (SOW §11 ongoing
 * monitoring + §14 alerts). For each active org, flags upcoming/started APPROVED
 * bookings that (a) fall below the service's configured minimum staffing, (b)
 * have an assigned staff member on LEAVE/HALF_DAY today, or (c) started >30 min
 * ago with nobody checked in, then digests the issues to managers. Runs in the
 * daily cron. Best-effort, per-org isolated.
 */
const runStaffingMonitorSweep = async () => {
  const now = Date.now();
  const soon = now + 24 * 60 * 60 * 1000; // upcoming within 24h (or already started)
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  let orgsAlerted = 0;
  let bookingsFlagged = 0;

  const orgs = await prisma.organization.findMany({
    where: { status: "ACTIVE", isDeleted: false },
    select: { id: true },
  });

  for (const org of orgs) {
    try {
      const bookings = await prisma.booking.findMany({
        where: {
          organizationId: org.id,
          status: BOOKING_STATUS.APPROVED,
          startTime: { lte: BigInt(soon) },
        },
        select: {
          id: true,
          bookingCode: true,
          participantCount: true,
          startTime: true,
          slotId: true,
          staffAssignments: {
            where: { status: { notIn: ["CANCELLED", "DECLINED"] } },
            select: { userId: true, status: true, assignedAt: true, createdAt: true },
          },
        },
        take: 300,
      });

      const issues = [];
      for (const b of bookings) {
        const reasons = [];

        // (a) below the service's configured minimum staffing
        const shortfall = await staffingShortfall(b);
        if (shortfall) reasons.push(`understaffed (${shortfall})`);

        const staffIds = b.staffAssignments.map((a) => a.userId);
        // (b) an assigned staff member is on leave / half-day today
        if (staffIds.length) {
          const onLeave = await prisma.staffAttendance.count({
            where: {
              organizationId: org.id,
              userId: { in: staffIds },
              attendanceDate: BigInt(dayStart.getTime()),
              attendanceStatus: { in: ["LEAVE", "HALF_DAY"] },
            },
          });
          if (onLeave > 0) reasons.push(`${onLeave} assigned staff on leave today`);
        }

        // (c) started >30 min ago but nobody has begun the task (missing check-in)
        const startedLongAgo = Number(b.startTime) + 30 * 60000 < now;
        const anyStarted = b.staffAssignments.some((a) =>
          ["START", "END", "COMPLETED"].includes(a.status),
        );
        if (startedLongAgo && b.staffAssignments.length > 0 && !anyStarted) {
          reasons.push("no assigned staff has checked in");
        }

        // (d) an assignment has sat unaccepted for >6h — the staff member may
        // simply never have opened the app. It counts toward staffing on paper
        // but nobody is actually committed, and (unlike a decline) there is no
        // one-off notification, so without this it would be silently invisible.
        const STALE_ACCEPT_MS = 6 * 60 * 60 * 1000;
        const staleUnaccepted = b.staffAssignments.filter(
          (a) =>
            a.status === "PENDING_ACCEPTANCE" &&
            Number(a.assignedAt || a.createdAt || 0) + STALE_ACCEPT_MS < now,
        ).length;
        if (staleUnaccepted > 0) {
          reasons.push(`${staleUnaccepted} task(s) not yet accepted by staff`);
        }

        if (reasons.length) {
          issues.push({ code: b.bookingCode || b.id.slice(0, 8), reasons });
          bookingsFlagged += 1;
        }
      }

      if (issues.length === 0) continue;

      const managers = await prisma.user.findMany({
        where: { organizationId: org.id, role: { in: ["NPO_ADMIN", "COORDINATOR"] }, status: true, isDeleted: false },
        select: { id: true },
      });
      if (managers.length === 0) continue;

      const summary = issues
        .slice(0, 5)
        .map((i) => `${i.code} — ${i.reasons.join("; ")}`)
        .join(" · ");
      await notificationService.notifyMany(
        managers.map((m) => m.id),
        {
          organizationId: org.id,
          type: "STAFFING_ALERT",
          title: "Staffing needs attention",
          message: `${issues.length} approved booking(s) need attention: ${summary}${issues.length > 5 ? " …" : ""}`,
        },
      );
      orgsAlerted += 1;
    } catch (err) {
      console.error(`[staffing-monitor] org ${org.id} failed:`, err.message);
    }
  }

  return { orgsAlerted, bookingsFlagged };
};

/**
 * Assign (or clear) the vehicle on an already-APPROVED booking.
 *
 * The dispatch board works on APPROVED bookings, but `fulfillBooking` only
 * accepts PENDING ones — so dispatching a van after approval needed its own
 * path. Every guard `validateBooking` applies to a vehicle is re-applied here,
 * because this endpoint writes `vehicleId` directly: existence + org scope,
 * time-conflict (with the "next available at" hint), seat capacity, and the
 * 車検 roadworthiness gate.
 *
 * `vehicleId: null` unassigns, which needs no validation.
 */
const assignVehicle = async (bookingId, vehicleId, authUser) => {
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, organizationId: authUser.organizationId },
    select: {
      id: true,
      status: true,
      startTime: true,
      endTime: true,
      requiredSeats: true,
      vehicleId: true,
    },
  });
  if (!booking) throw new Error("Booking not found");
  if (!ACTIVE_STATUSES.includes(booking.status)) {
    throw new Error("Only a pending or approved booking can be dispatched a vehicle");
  }

  if (vehicleId) {
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        id: vehicleId,
        organizationId: authUser.organizationId,
        isDeleted: false,
        status: true,
      },
      select: { id: true, capacity: true, vehicleName: true },
    });
    if (!vehicle) throw new Error("Selected vehicle not found");

    const notSelf = { id: { not: bookingId } };
    const conflict = await prisma.booking.findFirst({
      where: {
        organizationId: authUser.organizationId,
        vehicleId,
        status: { in: ACTIVE_STATUSES },
        ...overlapWhere(booking.startTime, booking.endTime),
        ...notSelf,
      },
      select: { id: true },
    });
    if (conflict) {
      const suggestion = await suggestVehicleFreeTime(
        vehicleId,
        authUser.organizationId,
        Number(booking.startTime),
        Number(booking.endTime) - Number(booking.startTime),
        notSelf,
      );
      const hint = suggestion
        ? ` Next available at ${new Date(suggestion).toISOString().slice(0, 16).replace("T", " ")} (UTC).`
        : "";
      throw new Error(
        `Vehicle conflict: this vehicle is already booked for an overlapping time.${hint}`,
      );
    }

    if (vehicle.capacity != null && (booking.requiredSeats || 0) > vehicle.capacity) {
      throw new Error(
        `Vehicle capacity (${vehicle.capacity}) is less than required seats (${booking.requiredSeats})`,
      );
    }

    await complianceService.assertVehicleRoadworthy(authUser.organizationId, vehicleId);
  }

  const updated = await prisma.booking.update({
    where: { id: booking.id },
    data: { vehicleId: vehicleId || null, updatedAt: BigInt(Date.now()) },
    select: { id: true, vehicleId: true, status: true },
  });

  logAudit({
    actorId: authUser.id,
    organizationId: authUser.organizationId,
    entity: "Booking",
    entityId: booking.id,
    action: "UPDATE",
  });

  return updated;
};

module.exports = {
  createBooking,
  createRecurringBookings,
  getPendingBookings,
  getWaitlistedBookings,
  approveBooking,
  rejectBooking,
  completeBooking,
  allBookings,
  getMyBookings,
  getBookingsForIncident,
  cancelBooking,
  cancelSeries,
  autoPromoteWaitlist,
  cancelActiveBookingsFor,
  releaseStaffFromUpcoming,
  notifyUnderstaffedBookings,
  runStaffingMonitorSweep,
  sendDueReminders,
  geocodeBooking,
  assignVehicle,
  staffingRequirement,
};
