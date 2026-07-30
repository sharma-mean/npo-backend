const staffReportService = require("./staffReport.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const staffReportController = {
  listReports: async (req, res) => {
    try {
      const result = await staffReportService.listReports(req.user, req.query);
      return res.status(200).json({ status: true, data: serializeBigInt(result) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  createReport: async (req, res) => {
    try {
      const result = await staffReportService.createReport(req.body, req.user);
      return res.status(201).json({
        status: true,
        message: "Report saved as draft",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  getReportById: async (req, res) => {
    try {
      const result = await staffReportService.getReportById(req.params.id, req.user);
      return res.status(200).json({ status: true, data: serializeBigInt(result) });
    } catch (error) {
      return res.status(404).json({ status: false, message: error.message });
    }
  },

  updateReport: async (req, res) => {
    try {
      const result = await staffReportService.updateReport(
        req.params.id,
        req.body,
        req.user,
      );
      return res.status(200).json({
        status: true,
        message: "Report updated successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  submitReport: async (req, res) => {
    try {
      const result = await staffReportService.submitReport(req.params.id, req.user);
      return res.status(200).json({
        status: true,
        message: "Report submitted successfully",
        data: serializeBigInt(result),
      });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = staffReportController;
