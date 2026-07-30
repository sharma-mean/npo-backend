const prisma = require("../../config/db");
const { validateCreateSlot } = require("./serviceSlot.validation");
const { logAudit } = require("../../utils/auditLogger");

const MANAGER_ROLES = ["NPO_ADMIN", "COORDINATOR"];

const assertManager = (authData) => {
  if (!MANAGER_ROLES.includes(authData.role)) {
    throw new Error("Not authorized to manage service slots");
  }
};

const createSlot = async (data, authData) => {
  assertManager(authData);
  validateCreateSlot(data);
  const now = BigInt(Date.now());

  // service must belong to org
  const service = await prisma.service.findFirst({
    where: {
      id: data.serviceId,
      organizationId: authData.organizationId,
      isDeleted: false,
    },
  });
  if (!service) throw new Error("Service not found");

  if (data.venueId) {
    const venue = await prisma.venue.findFirst({
      where: { id: data.venueId, organizationId: authData.organizationId, isDeleted: false },
    });
    if (!venue) throw new Error("Venue not found");
  }

  const slot = await prisma.serviceSlot.create({
    data: {
      organizationId: authData.organizationId,
      serviceId: data.serviceId,
      venueId: data.venueId || null,
      serviceType: data.serviceType,
      slotDate: BigInt(data.slotDate),
      startTime: BigInt(data.startTime),
      endTime: BigInt(data.endTime),
      capacity: Number(data.capacity),
      bookedCount: 0,
      notes: data.notes || null,
      createdBy: authData.id,
      createdAt: now,
      updatedAt: now,
    },
  });

  await logAudit({
    authData,
    action: "CREATE",
    entity: "ServiceSlot",
    entityId: slot.id,
    after: slot,
  });
  return slot;
};

/**
 * Bulk-generate slots from one template + a recurrence rule.
 * - DAILY: one slot per day for `count` days.
 * - WEEKLY + daysOfWeek [0=Sun..6=Sat]: a slot on each listed weekday until
 *   `count` slots made (e.g. Mon-Fri → [1,2,3,4,5]).
 * - WEEKLY without daysOfWeek: same weekday every week, `count` times.
 * Each occurrence keeps the template's time-of-day + duration. Occurrences that
 * already exist (same service+venue+startTime) are skipped and reported rather
 * than aborting the batch.
 */
const generateRecurringSlots = async (data, authData) => {
  assertManager(authData);
  const { serviceId, serviceType, venueId, capacity, startTime, endTime, notes } = data;
  const recurrence = data.recurrence || {};

  if (!serviceId) throw new Error("serviceId is required");
  if (!serviceType) throw new Error("serviceType is required");
  if (!startTime || !endTime) throw new Error("startTime and endTime are required");
  if (Number(endTime) <= Number(startTime)) {
    throw new Error("endTime must be after startTime");
  }
  if (capacity == null || Number(capacity) < 1) {
    throw new Error("capacity must be at least 1");
  }

  const freq = recurrence.frequency;
  const count = Number(recurrence.count) || 0;
  if (!["DAILY", "WEEKLY"].includes(freq)) {
    throw new Error("recurrence.frequency must be DAILY or WEEKLY");
  }
  // Upper bound guards against a runaway bulk generation (a typo creating tens of
  // thousands of rows); 366 = a full year of daily slots, which covers any real
  // scheduling horizon an org would set up in one go (client feedback #10).
  if (count < 1 || count > 366) {
    throw new Error("recurrence.count must be between 1 and 366");
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId, organizationId: authData.organizationId, isDeleted: false },
  });
  if (!service) throw new Error("Service not found");
  if (venueId) {
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, organizationId: authData.organizationId, isDeleted: false },
    });
    if (!venue) throw new Error("Venue not found");
  }

  const firstStart = Number(startTime);
  const firstEnd = Number(endTime);
  // Add `n` calendar days preserving the wall-clock time-of-day (DST-safe —
  // raw ms stepping would shift the time ±1h across a DST boundary).
  const addDays = (ms, n) => {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  };

  // Day offsets (in days from the first occurrence) to generate.
  const offsets = [];
  if (freq === "DAILY") {
    for (let i = 0; i < count; i++) offsets.push(i);
  } else {
    const days = Array.isArray(recurrence.daysOfWeek)
      ? recurrence.daysOfWeek.map(Number).filter((n) => n >= 0 && n <= 6)
      : null;
    if (days && days.length) {
      const set = new Set(days);
      // Walk forward day-by-day, collecting matching weekdays (bounded).
      for (let d = 0; offsets.length < count && d < count * 7 + 7; d++) {
        if (set.has(new Date(addDays(firstStart, d)).getDay())) offsets.push(d);
      }
    } else {
      for (let i = 0; i < count; i++) offsets.push(i * 7);
    }
  }

  const now = BigInt(Date.now());
  const created = [];
  const skipped = [];

  for (const off of offsets) {
    const s = addDays(firstStart, off);
    const e = addDays(firstEnd, off);
    try {
      const dup = await prisma.serviceSlot.findFirst({
        where: {
          organizationId: authData.organizationId,
          serviceId,
          venueId: venueId || null,
          startTime: BigInt(s),
          isDeleted: false,
        },
        select: { id: true },
      });
      if (dup) {
        skipped.push({ startTime: s, reason: "Slot already exists" });
        continue;
      }

      const slot = await prisma.serviceSlot.create({
        data: {
          organizationId: authData.organizationId,
          serviceId,
          venueId: venueId || null,
          serviceType,
          slotDate: BigInt(s),
          startTime: BigInt(s),
          endTime: BigInt(e),
          capacity: Number(capacity),
          bookedCount: 0,
          notes: notes || null,
          createdBy: authData.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      created.push(slot);
    } catch (err) {
      skipped.push({ startTime: s, reason: err.message });
    }
  }

  await logAudit({
    authData,
    action: "CREATE",
    entity: "ServiceSlot",
    metadata: { recurring: true, frequency: freq, created: created.length, skipped: skipped.length },
  });

  return { created, skipped };
};

const getAllSlots = async (authData, filters = {}) => {
  const where = {
    organizationId: authData.organizationId,
    isDeleted: false,
  };
  if (filters.serviceId) where.serviceId = filters.serviceId;
  if (filters.serviceType) where.serviceType = filters.serviceType;
  if (filters.from || filters.to) {
    where.slotDate = {};
    if (filters.from) where.slotDate.gte = BigInt(filters.from);
    if (filters.to) where.slotDate.lte = BigInt(filters.to);
  }

  const take = Math.min(Math.max(Number(filters.take) || 100, 1), 200);
  const skip = Math.max(Number(filters.skip) || 0, 0);

  return prisma.serviceSlot.findMany({
    where,
    include: {
      service: {
        select: {
          id: true,
          serviceName: true,
          serviceNameJa: true,
          singleParticipant: true,
          maxParticipants: true,
          requiresGuardianAccompaniment: true,
        },
      },
      venue: { select: { id: true, name: true } },
    },
    orderBy: { startTime: "asc" },
    take,
    skip,
  });
};

const getSlotById = async (id, authData) => {
  const slot = await prisma.serviceSlot.findFirst({
    where: { id, organizationId: authData.organizationId, isDeleted: false },
    include: {
      service: {
        select: {
          id: true,
          serviceName: true,
          serviceNameJa: true,
          singleParticipant: true,
          maxParticipants: true,
          requiresGuardianAccompaniment: true,
        },
      },
      venue: { select: { id: true, name: true } },
      bookings: {
        where: { status: { notIn: ["CANCELLED", "REJECTED"] } },
        select: { id: true, status: true, participantCount: true },
      },
    },
  });
  if (!slot) throw new Error("Service slot not found");
  return slot;
};

const updateSlot = async (id, data, authData) => {
  assertManager(authData);
  const existing = await prisma.serviceSlot.findFirst({
    where: { id, organizationId: authData.organizationId, isDeleted: false },
  });
  if (!existing) throw new Error("Service slot not found");

  if (
    data.capacity != null &&
    Number(data.capacity) < existing.bookedCount
  ) {
    throw new Error(
      `Capacity cannot be below already-booked count (${existing.bookedCount})`,
    );
  }

  // Re-validate the time window against whichever endpoint is changing.
  if (data.startTime || data.endTime) {
    const start = data.startTime ? Number(data.startTime) : Number(existing.startTime);
    const end = data.endTime ? Number(data.endTime) : Number(existing.endTime);
    if (end <= start) throw new Error("endTime must be after startTime");
  }

  const updated = await prisma.serviceSlot.update({
    where: { id },
    data: {
      ...(data.capacity != null ? { capacity: Number(data.capacity) } : {}),
      ...(data.venueId !== undefined ? { venueId: data.venueId || null } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.startTime ? { startTime: BigInt(data.startTime) } : {}),
      ...(data.endTime ? { endTime: BigInt(data.endTime) } : {}),
      ...(data.status !== undefined ? { status: !!data.status } : {}),
      updatedAt: BigInt(Date.now()),
    },
  });

  await logAudit({
    authData,
    action: "UPDATE",
    entity: "ServiceSlot",
    entityId: id,
    before: existing,
    after: updated,
  });

  // Capacity increased → freed seats may admit waitlisted bookings on this slot.
  // Lazy require avoids a circular dependency with booking.service.
  if (data.capacity != null && Number(data.capacity) > existing.capacity) {
    try {
      const { autoPromoteWaitlist } = require("../booking/booking.service");
      await autoPromoteWaitlist({ slotId: id, organizationId: authData.organizationId });
    } catch (err) {
      console.error("[slot] waitlist promote failed:", err.message);
    }
  }
  return updated;
};

const deleteSlot = async (id, authData) => {
  assertManager(authData);
  const existing = await prisma.serviceSlot.findFirst({
    where: { id, organizationId: authData.organizationId, isDeleted: false },
  });
  if (!existing) throw new Error("Service slot not found");
  if (existing.bookedCount > 0) {
    throw new Error("Cannot delete a slot with active bookings");
  }

  const deleted = await prisma.serviceSlot.update({
    where: { id },
    data: { isDeleted: true, updatedAt: BigInt(Date.now()) },
  });

  await logAudit({
    authData,
    action: "DELETE",
    entity: "ServiceSlot",
    entityId: id,
    before: existing,
  });
  return deleted;
};

module.exports = {
  createSlot,
  generateRecurringSlots,
  getAllSlots,
  getSlotById,
  updateSlot,
  deleteSlot,
};
