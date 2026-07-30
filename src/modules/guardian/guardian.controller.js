const guardianService = require("./guardian.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const guardianController = {
  createGuardian: async (req, res) => {
    try {
      const guardian = await guardianService.createGuardian(req.body, req.user);
      res.status(201).json({ status: true, data: serializeBigInt(guardian) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  getGuardians: async (req, res) => {
    try {
      const guardians = await guardianService.getGuardians(req.user);
      res.json({ status: true, data: serializeBigInt(guardians) });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getGuardianById: async (req, res) => {
    try {
      const guardian = await guardianService.getGuardianById(req.params.id, req.user.organizationId);
      res.json({ status: true, data: serializeBigInt(guardian) });
    } catch (error) {
      res.status(404).json({ status: false, message: error.message });
    }
  },

  updateGuardian: async (req, res) => {
    try {
      const guardian = await guardianService.updateGuardian(req.params.id, req.body, req.user.organizationId);
      res.json({ status: true, data: serializeBigInt(guardian) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  deleteGuardian: async (req, res) => {
    try {
      await guardianService.deleteGuardian(req.params.id, req.user.organizationId);
      res.json({ status: true, message: "Guardian and their participants deleted successfully" });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = guardianController;
