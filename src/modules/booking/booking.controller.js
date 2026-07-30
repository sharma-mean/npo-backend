const locationService = require("../bookingStaffAssignment/location.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const bookingService = require("./booking.service");
const fulfillmentService = require("./bookingFulfillment.service");

const createBooking = async (req, res) => {
  try {
    const result = await bookingService.createBooking(req.body, req.user);

    return res.status(201).json({
      status: true,
      message: "Booking request submitted successfully",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const createRecurringBookings = async (req, res) => {
  try {
    const result = await bookingService.createRecurringBookings(
      req.body,
      req.user,
    );
    return res.status(201).json({
      status: true,
      message: `Recurring series created: ${result.created.length} booking(s), ${result.skipped.length} skipped`,
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getPendingBookings = async (req, res) => {
  try {
    const result = await bookingService.getPendingBookings(
      req.user.organizationId,
      { take: req.query.take, skip: req.query.skip },
    );

    return res.status(200).json({
      status: true,
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const getWaitlistedBookings = async (req, res) => {
  try {
    const result = await bookingService.getWaitlistedBookings(
      req.user.organizationId,
      { take: req.query.take, skip: req.query.skip },
    );
    return res.status(200).json({
      status: true,
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const approveBooking = async (req, res) => {
  try {
    const forceApprove = req.body?.forceApprove === true;
    const result = await bookingService.approveBooking(
      req.params.id,
      req.user.id,
      forceApprove,
      req.user.organizationId,
    );

    return res.status(200).json({
      status: true,
      message: "Booking approved successfully",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const rejectBooking = async (req, res) => {
  try {
    const result = await bookingService.rejectBooking(
      req.params.id,
      req.user.id,
      req.body.cancellationReason,
      req.user.organizationId,
    );

    return res.status(200).json({
      status: true,
      message: "Booking rejected successfully",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const completeBooking = async (req, res) => {
  try {
    const result = await bookingService.completeBooking(
      req.params.id,
      req.user.organizationId,
    );

    return res.status(200).json({
      status: true,
      message: "Booking completed successfully",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};
const allBookings = async (req, res) => {
  try {
    const bookings = await bookingService.allBookings(req.user, {
      take: req.query.take,
      skip: req.query.skip,
    });
    return res.json({
      status: true,
      data: serializeBigInt(bookings),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const getMyBookings = async (req, res) => {
  try {
    const bookings = await bookingService.getMyBookings(req.user);
    return res.json({
      status: true,
      data: serializeBigInt(bookings),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const getBookingsForIncident = async (req, res) => {
  try {
    const bookings = await bookingService.getBookingsForIncident(req.user);
    return res.json({ status: true, data: serializeBigInt(bookings) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const cancelBooking = async (req, res) => {
  try {
    const result = await bookingService.cancelBooking(
      req.params.id,
      req.user,
      req.body?.reason,
    );
    return res.status(200).json({
      status: true,
      message: "Booking cancelled successfully",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const cancelSeries = async (req, res) => {
  try {
    const result = await bookingService.cancelSeries(
      req.params.groupId,
      req.user,
      req.body?.reason,
    );
    return res.status(200).json({
      status: true,
      message: `Series cancelled: ${result.cancelled.length} booking(s)`,
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getBookingFulfillment = async (req, res) => {
  try {
    const result = await fulfillmentService.getBookingFulfillment(
      req.params.id,
      req.user,
    );
    return res.status(200).json({
      status: true,
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

const assignVehicle = async (req, res) => {
  try {
    const result = await bookingService.assignVehicle(
      req.params.id,
      req.body?.vehicleId ?? null,
      req.user,
    );
    res.status(200).json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    res.status(400).json({ status: false, message: error.message });
  }
};

const fulfillBooking = async (req, res) => {
  try {
    const result = await fulfillmentService.fulfillBooking(
      req.params.id,
      req.body,
      req.user,
    );
    return res.status(200).json({
      status: true,
      message: "Booking approved and resources assigned",
      data: serializeBigInt(result),
    });
  } catch (error) {
    // Staffing below the service minimum — surface a structured payload so the
    // UI can offer Add-staff / Approve-anyway / Decline (SOW §11) instead of a
    // dead-end error.
    if (error.code === "STAFFING_SHORTFALL") {
      return res.status(409).json({
        status: false,
        code: "STAFFING_SHORTFALL",
        message: error.message,
        shortfall: error.shortfall,
      });
    }
    return res.status(400).json({
      status: false,
      message: error.message,
    });
  }
};

/**
 * Who is currently on the way for this booking. The service authorizes:
 * managers see any booking in their org, a guardian only their own.
 */
const getLiveLocation = async (req, res) => {
  try {
    const data = await locationService.getBookingLiveLocations(
      req.params.id,
      req.user,
    );
    return res.status(200).json({ status: true, data: serializeBigInt(data) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const geocodeBooking = async (req, res) => {
  try {
    const coords = await bookingService.geocodeBooking(req.params.id, req.user);
    return res.status(200).json({ status: true, data: coords });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

module.exports = {
  getLiveLocation,
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
  getBookingFulfillment,
  fulfillBooking,
  assignVehicle,
  geocodeBooking,
};
