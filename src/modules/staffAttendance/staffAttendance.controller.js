const staffAttandanceService = require("./staffAttendance.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const staffAttendanceController = {
  checkIn: async (req, res) => {
    try {
      const result = await staffAttandanceService.checkIn(req.body, req.user);

      return res.status(201).json({
        status: true,

        message: "Check-in successful",

        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,

        message: error.message,
      });
    }
  },

  checkOut: async (req, res) => {
    try {
      const result = await staffAttandanceService.checkOut(req.user, req.body);

      return res.status(200).json({
        status: true,

        message: "Check-out successful",

        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,

        message: error.message,
      });
    }
  },

  getMyAttendance: async (req, res) => {
    try {
      const result = await staffAttandanceService.getMyAttendance(
        req.params.userId,
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
  },

  getAllStaffAttendance: async (req, res) => {
    try {
      const result = await staffAttandanceService.getAllStaffAttendance(
        req.user,
        req.query,
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
  },

  getMonthlySummary: async (req, res) => {
    try {
      const result = await staffAttandanceService.getMonthlySummary(
        req.params.userId,
        req.user,
      );

      return res.status(200).json({
        status: true,
        message: "Monthly summary fetched successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,

        message: error.message,
      });
    }
  },

  applyEmergencyLeave: async (req, res) => {
    try {
      const result = await staffAttandanceService.applyEmergencyLeave(
        req.body,
        req.user,
      );

      return res.status(201).json({
        status: true,

        message: "Emergency leave applied successfully",

        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,

        message: error.message,
      });
    }
  },

  createDelayReport: async (req, res) => {
    try {
      const result = await staffAttandanceService.createOperationalReport(
        req.body,
        req.user,
        "DELAY",
      );

      return res.status(201).json({
        status: true,
        message: "Delay report submitted successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  createIncidentReport: async (req, res) => {
    try {
      const result = await staffAttandanceService.createOperationalReport(
        req.body,
        req.user,
        "INCIDENT",
      );

      return res.status(201).json({
        status: true,
        message: "Incident report submitted successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  deleteAttendance: async (req, res) => {
    try {
      const { id } = req.params;
      const result = await staffAttandanceService.deleteAttendance(id, req.user);
      return res.status(200).json({
        status: true,
        message: "Attendance record deleted successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },
};

module.exports = staffAttendanceController;
