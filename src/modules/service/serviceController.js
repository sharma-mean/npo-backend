const serviceService = require("./services");
const serializeBigInt = require("../../utils/bigIntSerializer");

const serviceController = {
  createService: async (req, res) => {
    try {
      const service = await serviceService.createService(
        req.user.organizationId,
        req.body,
      );

      return res.status(201).json({
        status: true,
        message: "Service created successfully",
        data: serializeBigInt(service),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  getServices: async (req, res) => {
    try {
      const services = await serviceService.getServices(
        req.user.organizationId,
      );

      return res.json({
        status: true,
        data: serializeBigInt(services),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  getServiceById: async (req, res) => {
    try {
      const service = await serviceService.getServiceById(
        req.params.id,
        req.user.organizationId,
      );

      return res.json({
        status: true,
        data: serializeBigInt(service),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  updateService: async (req, res) => {
    try {
      const service = await serviceService.updateService(
        req.params.id,
        req.user.organizationId,
        req.body,
      );

      return res.json({
        status: true,
        message: "Service updated successfully",
        data: serializeBigInt(service),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  toggleStatus: async (req, res) => {
    try {
      const service = await serviceService.toggleStatus(
        req.params.id,
        req.user.organizationId,
      );

      return res.json({
        status: true,
        message: "Service status updated successfully",
        data: serializeBigInt(service),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  deleteService: async (req, res) => {
    try {
      await serviceService.deleteService(
        req.params.id,
        req.user.organizationId,
      );

      return res.json({
        status: true,
        message: "Service deleted successfully",
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = serviceController;
