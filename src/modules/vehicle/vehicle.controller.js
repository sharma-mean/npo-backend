const vehicleService = require("./vehicle.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const vehicleController = {
  createVehicle: async (req, res) => {
    try {
      const vehicle = await vehicleService.createVehicle(req.body, req.user);

      res.status(201).json({
        status: true,
        message: "Vehicle created successfully",
        data: serializeBigInt(vehicle),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getAllVehicles: async (req, res) => {
    try {
      const vehicles = await vehicleService.getAllVehicles(req.user.organizationId);

      res.json({
        status: true,
        data: serializeBigInt(vehicles),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getVehicleById: async (req, res) => {
    try {
      const vehicle = await vehicleService.getVehicleById(req.params.id, req.user.organizationId);

      res.json({
        status: true,
        data: serializeBigInt(vehicle),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  updateVehicle: async (req, res) => {
    try {
      const vehicle = await vehicleService.updateVehicle(
        req.params.id,
        req.body,
        req.user.organizationId,
      );

      res.json({
        status: true,
        message: "Vehicle updated successfully",
        data: serializeBigInt(vehicle),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  toggleVehicleStatus: async (req, res) => {
    try {
      const vehicle = await vehicleService.toggleVehicleStatus(
        req.params.id,
        req.user.organizationId,
      );

      res.json({
        status: true,
        message: "Vehicle status updated",
        data: serializeBigInt(vehicle),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  deleteVehicle: async (req, res) => {
    try {
      await vehicleService.deleteVehicle(req.params.id, req.user.organizationId);

      res.json({
        status: true,
        message: "Vehicle deleted successfully",
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },
};

module.exports = vehicleController;
