const dashboardService = require("./dashboard.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const dashboardController = {
  getStats: async (req, res) => {
    try {
      const stats = await dashboardService.getStats(req.user.organizationId);

      res.json({
        status: true,
        data: stats,
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getOps: async (req, res) => {
    try {
      const ops = await dashboardService.getOps(req.user.organizationId);
      res.json({ status: true, data: serializeBigInt(ops) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  getNavCounts: async (req, res) => {
    try {
      const counts = await dashboardService.getNavCounts(req.user.organizationId);
      res.json({ status: true, data: counts });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = dashboardController;
