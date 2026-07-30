const service = require("./subscriptionPlan.service");
const serializeBigInt  = require("../../utils/bigIntSerializer")

const subscriptionPlanController = {
  // PUBLIC — powers the pricing section on the landing page (no auth).
  // Only active plans, and only the marketing-safe fields.
  getPublicPlans: async (_req, res) => {
    try {
      const data = await service.getPublicPlans();
      res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  createPlan: async (req, res) => {
    try {
      const data = await service.createPlan(req.body);

      res.status(201).json({
        status: true,
        data: serializeBigInt(data)
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message
      });
    }
  },

  getPlans: async (req, res) => {
    const data = await service.getPlans();

    res.json({ status: true, data: serializeBigInt(data) });
  },

  getPlanById: async (req, res) => {
    const data = await service.getPlanById(req.params.id);

    res.json({ status: true, data: serializeBigInt(data) });
  },

  updatePlan: async (req, res) => {
    try {
      const data = await service.updatePlan(
        req.params.id,
        req.body
      );

      res.json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message
      });
    }
  },

  deletePlan: async (req, res) => {
    try {
      await service.deletePlan(req.params.id);

      res.json({
        status: true,
        message: "Plan deleted"
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message
      });
    }
  }
};


module.exports = subscriptionPlanController;