const service = require("./vehicleOperation.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const controller = {
  upsert: async (req, res) => {
    try {
      const record = await service.upsertOperation(req.body, req.user);
      res.status(201).json({ status: true, message: "Operations data saved", data: serializeBigInt(record) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  report: async (req, res) => {
    try {
      const data = await service.getReport(req.user.organizationId, req.query);
      res.json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  remove: async (req, res) => {
    try {
      const data = await service.deleteOperation(req.params.id, req.user);
      res.json({ status: true, message: "Record deleted", data });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = controller;
