const locationService = require("./location.service");
const service = require("./bookingStaffAssignment.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const bookingStaffAssignmentController = {
  createAssignment: async (req, res) => {
    try {
      const result = await service.createAssignment(req.body, req.user);

      return res.status(201).json({
        status: true,
        message: "Staff assigned successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getAvailableStaff: async (req, res) => {
    try {
      const result = await service.getAvailableStaff(
        req.params.bookingId,
        req.query.assignmentRole,
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

  getBookingAssignments: async (req, res) => {
    try {
      const result = await service.getBookingAssignments(
        req.params.bookingId,
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

  getMyTasks: async (req, res) => {
    try {
      const result = await service.getMyTasks(req.user, req.params.userId);

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

  acceptAssignment: async (req, res) => {
    try {
      const result = await service.acceptAssignment(req.params.id, req.user);
      return res.status(200).json({
        status: true,
        message: "Task accepted",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  declineAssignment: async (req, res) => {
    try {
      const result = await service.declineAssignment(
        req.params.id,
        req.body.reason,
        req.user,
      );
      return res.status(200).json({
        status: true,
        message: "Task declined",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  startTask: async (req, res) => {
    try {
      const result = await service.startTask(req.params.id, req.user);

      return res.status(200).json({
        status: true,
        message: "Task started successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  endTask: async (req, res) => {
    try {
      const result = await service.endTask(req.params.id, req.user);

      return res.status(200).json({
        status: true,
        message: "Task ended successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  completeTask: async (req, res) => {
    try {
      const result = await service.completeTask(req.params.id, req.user);

      return res.status(200).json({
        status: true,
        message: "Task completed successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  cancelTask: async (req, res) => {
    try {
      const result = await service.cancelTask(
        req.params.id,
        req.body.cancellationReason,
        req.user,
      );

      return res.status(200).json({
        status: true,
        message: "Task cancelled successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  // Staff pings their position while a task is running. The assignment owner is
  // taken from req.user — never from the body.
  recordLocation: async (req, res) => {
    try {
      const data = await locationService.recordLocation(req.params.id, req.user, {
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
      });
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  deleteAssignment: async (req, res) => {
    try {
      await service.deleteAssignment(req.params.id, req.user);

      return res.status(200).json({
        status: true,
        message: "Assignment removed successfully",
      });
    } catch (error) {
      return res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },
};

module.exports = bookingStaffAssignmentController;
