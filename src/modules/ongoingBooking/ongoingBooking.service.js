const prisma = require("../../config/db");
const { ASSIGNMENT_STATUS } = require("../bookingStaffAssignment/bookingStaffAssignment.constants");

/**
 * Manager view of the bookings happening RIGHT NOW in their own organization —
 * who is on the road, where they are, and everything about the trip.
 *
 * Org-scoped like every other booking read: organizationId always comes from
 * req.user, never from the request.
 */

// "Ongoing" = a staff member has STARTed the task and not finished it yet.
// Not the clock: a trip is live because someone is actually on it, so a booking
// whose window has passed but whose driver is still out stays on the board, and
// an approved booking nobody has started yet does not clutter it.
const ongoingWhere = (organizationId) => ({
  organizationId,
  status: "APPROVED",
  staffAssignments: { some: { status: ASSIGNMENT_STATUS.START } },
});

const LIST_SELECT = {
  id: true,
  bookingCode: true,
  organizationId: true,
  serviceType: true,
  status: true,
  bookingDate: true,
  startTime: true,
  endTime: true,
  participantCount: true,
  pickupAddress: true,
  pickupLat: true,
  pickupLng: true,
  participant: { select: { id: true, fullName: true, profileImage: true } },
  guardian: { select: { id: true, fullName: true, profileImage: true, phone: true } },
  venue: { select: { id: true, name: true, address: true, lat: true, lng: true } },
  vehicle: { select: { id: true, vehicleName: true, vehicleNumber: true } },
  staffAssignments: {
    where: { status: { not: ASSIGNMENT_STATUS.CANCELLED } },
    select: {
      id: true,
      assignmentRole: true,
      status: true,
      startedAt: true,
      lastLat: true,
      lastLng: true,
      lastLocationAt: true,
      endLat: true,
      endLng: true,
      endLocationAt: true,
      user: { select: { id: true, fullName: true, profileImage: true, phone: true, address: true } },
    },
  },
};

const ongoingBookingService = {
  /** Bookings in progress in this organization, soonest-ending first. */
  getOngoing: async (organizationId, { take = 100, skip = 0 } = {}) => {
    const limit = Math.min(Math.max(Number(take) || 100, 1), 200);
    const offset = Math.max(Number(skip) || 0, 0);

    const where = ongoingWhere(organizationId);

    const [bookings, total] = await Promise.all([
      prisma.booking.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { endTime: "asc" },
        take: limit,
        skip: offset,
      }),
      prisma.booking.count({ where }),
    ]);

    return { total, bookings };
  },

  /**
   * Everything a manager could want about one live booking: the people, the
   * vehicle, the venue, incidents and documents. The live staff positions come
   * from location.service (see the controller).
   */
  getDetail: async (id, organizationId) => {
    const booking = await prisma.booking.findFirst({
      where: { id, organizationId },
      select: {
        ...LIST_SELECT,
        purpose: true,
        notes: true,
        operationalNotes: true,
        cancellationReason: true,
        requiredSeats: true,
        isRecurring: true,
        recurrenceGroupId: true,
        createdAt: true,
        updatedAt: true,
        approvedBy: true,
        participant: {
          select: {
            id: true,
            fullName: true,
            profileImage: true,
            email: true,
            phone: true,
            dateOfBirth: true,
            gender: true,
            address: true,
            medicalNotes: true,
            allergyNotes: true,
            emergencyInstructions: true,
            mobilitySupport: true,
          },
        },
        guardian: {
          select: {
            id: true,
            fullName: true,
            profileImage: true,
            email: true,
            phone: true,
            address: true,
          },
        },
        vehicle: {
          select: {
            id: true,
            vehicleName: true,
            vehicleNumber: true,
            vehicleType: true,
            capacity: true,
          },
        },
        slot: { select: { id: true, notes: true, startTime: true, endTime: true } },
        incidents: {
          where: { isDeleted: false },
          select: {
            id: true,
            type: true,
            severity: true,
            status: true,
            title: true,
            description: true,
            createdAt: true,
            reporter: { select: { id: true, fullName: true, profileImage: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        documents: {
          where: { isDeleted: false },
          select: { id: true, type: true, fileName: true, mimeType: true, size: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
    });
    if (!booking) throw new Error("Booking not found");
    return booking;
  },
};

module.exports = ongoingBookingService;
