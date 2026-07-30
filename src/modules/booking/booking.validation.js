/**
 * Structural validation of a built booking payload (post buildBookingData).
 * Only enforces invariants the persistence layer relies on — service-type
 * resource rules (mobility vehicle / venue) are warnings, not hard errors,
 * and live in validateBooking().
 */
const validateCreateBooking = (data) => {
  if (!data.organizationId) throw new Error("Organization ID is required");
  if (!data.participantId) throw new Error("Participant ID is required");
  if (!data.guardianId) throw new Error("Guardian ID is required");
  if (!data.serviceType) throw new Error("Service type is required");
  if (data.bookingDate == null) throw new Error("Booking date is required");
  if (data.startTime == null) throw new Error("Start time is required");
  if (data.endTime == null) throw new Error("End time is required");

  if (BigInt(data.endTime) <= BigInt(data.startTime)) {
    throw new Error("End time must be greater than start time");
  }

  if (!Number.isInteger(data.participantCount) || data.participantCount < 1) {
    throw new Error("participantCount must be a positive integer");
  }
  // 0 is valid — it means "no transport requested" (van seats only when > 0).
  if (!Number.isInteger(data.requiredSeats) || data.requiredSeats < 0) {
    throw new Error("requiredSeats must be a non-negative integer");
  }
};

module.exports = {
  validateCreateBooking,
};
