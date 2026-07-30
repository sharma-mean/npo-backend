const prisma = require("../../config/db");
const {
  validateCreateVenue,
  validateUpdateVenue,
} = require("./venue.validation");
const { logAudit } = require("../../utils/auditLogger");

const venueService = {
  createVenue: async (data, authUser) => {
    validateCreateVenue(data);

    const now = BigInt(Date.now());

    const venue = await prisma.venue.create({
      data: {
        organizationId: authUser.organizationId,
        name: data.name,
        address: data.address,
        lat: data.lat !== undefined ? data.lat : null,
        lng: data.lng !== undefined ? data.lng : null,
        capacity: Number(data.capacity),
        serviceType: data.serviceType || null,
        contactPerson: data.contactPerson || null,
        contactPhone: data.contactPhone || null,
        createdBy: authUser.id,
        createdAt: now,
        updatedAt: now,
      },
    });

    await logAudit({
      authData: authUser,
      action: "CREATE",
      entity: "Venue",
      entityId: venue.id,
      after: venue,
    });
    return venue;
  },

  getAllVenues: async (organizationId) => {
    return await prisma.venue.findMany({
      where: { organizationId, isDeleted: false },
      orderBy: {
        createdAt: "desc",
      },
    });
  },

  getVenueById: async (id, organizationId) => {
    const venue = await prisma.venue.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!venue) {
      throw new Error("Venue not found");
    }

    return venue;
  },

  updateVenue: async (id, data, organizationId) => {
    validateUpdateVenue(data);

    const venue = await prisma.venue.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!venue) {
      throw new Error("Venue not found");
    }

    const updateData = {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.address !== undefined && {
        address: data.address,
        ...(data.address !== venue.address && data.lat === undefined && data.lng === undefined && { lat: null, lng: null }),
      }),
      ...(data.lat !== undefined && { lat: data.lat }),
      ...(data.lng !== undefined && { lng: data.lng }),
      ...(data.capacity !== undefined && { capacity: Number(data.capacity) }),
      ...(data.serviceType !== undefined && {
        serviceType: data.serviceType || null,
      }),
      ...(data.contactPerson !== undefined && {
        contactPerson: data.contactPerson,
      }),
      ...(data.contactPhone !== undefined && {
        contactPhone: data.contactPhone,
      }),
      updatedAt: BigInt(Date.now()),
    };

    const updated = await prisma.venue.update({
      where: { id },
      data: updateData,
    });

    await logAudit({
      authData: { organizationId },
      action: "UPDATE",
      entity: "Venue",
      entityId: id,
      before: venue,
      after: updated,
    });

    // Capacity increased → the extra room may let waitlisted bookings in.
    // Re-run venue waitlist promotion (FIFO, re-validated against live capacity).
    // Lazy require avoids a circular dependency with booking.service.
    if (data.capacity !== undefined && Number(data.capacity) > venue.capacity) {
      try {
        const { autoPromoteWaitlist } = require("../booking/booking.service");
        await autoPromoteWaitlist({ venueId: id, organizationId });
      } catch (err) {
        console.error("[venue] waitlist promote failed:", err.message);
      }
    }
    return updated;
  },

  toggleVenueStatus: async (id, organizationId) => {
    const venue = await prisma.venue.findFirst({
      where: { id, organizationId, isDeleted: false },
    });

    if (!venue) {
      throw new Error("Venue not found");
    }

    return await prisma.venue.update({
      where: { id },
      data: {
        status: !venue.status,
        updatedAt: BigInt(Date.now()),
      },
    });
  },

  deleteVenue: async (id, organizationId) => {
    const venue = await prisma.venue.findFirst({
      where: { id, organizationId, isDeleted: false },
      include: { bookings: { where: { status: { in: ["PENDING", "APPROVED"] } } } },
    });

    if (!venue) {
      throw new Error("Venue not found");
    }

    if (venue.bookings.length > 0) {
      throw new Error(
        `Cannot delete: ${venue.bookings.length} active booking(s) use this venue`,
      );
    }

    // Soft delete (convention: never hard-delete; avoids FK breakage with
    // historical COMPLETED/CANCELLED bookings + slots that reference the venue).
    const deleted = await prisma.venue.update({
      where: { id },
      data: { isDeleted: true, status: false, updatedAt: BigInt(Date.now()) },
    });

    await logAudit({
      authData: { organizationId },
      action: "DELETE",
      entity: "Venue",
      entityId: id,
      before: venue,
    });
    return deleted;
  },
};

module.exports = venueService;
