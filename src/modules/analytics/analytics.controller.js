const analyticsService = require("./analytics.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const analyticsController = {
  kpi: async (req, res) => {
    try {
      const data = await analyticsService.kpi(req.user.organizationId, req.query);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = analyticsController;
