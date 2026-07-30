const service = require("./ongoingBooking.service");
const locationService = require("../bookingStaffAssignment/location.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const ongoingBookingController = {
  ongoing: async (req, res) => {
    try {
      const data = await service.getOngoing(req.user.organizationId, req.query);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  detail: async (req, res) => {
    try {
      // The booking record and the live map payload in one call — the detail
      // page needs both, and two round-trips would only add a flash of an
      // empty map.
      const [booking, locations] = await Promise.all([
        service.getDetail(req.params.id, req.user.organizationId),
        locationService.getBookingLiveLocations(req.params.id, req.user).catch(() => null),
      ]);
      return res
        .status(200)
        .json({ status: true, data: serializeBigInt({ booking, locations }) });
    } catch (error) {
      return res.status(404).json({ status: false, message: error.message });
    }
  },
};

module.exports = ongoingBookingController;
