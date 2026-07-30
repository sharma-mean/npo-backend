const service = require(
  "./organizationSubscription.service"
);
const serializeBigInt  = require("../../utils/bigIntSerializer")

const organizationSubscriptionController = {
  createSubscription: async (req, res) => {
    try {
      const data =
        await service.createSubscription(
          req.body
        );

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

  getSubscriptions: async (req, res) => {
    const data =
      await service.getSubscriptions();

    res.json({
      status: true,
      data: serializeBigInt(data)
    });
  },

  checkout: async (req, res) => {
    try {
      const data = await service.changePlan({
        organizationId: req.user.organizationId,
        planId: req.body.planId,
        userId: req.user.id,
      });
      res.status(201).json({
        status: true,
        message: "Payment successful. Your plan is active.",
        data: serializeBigInt(data),
      });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  cancel: async (req, res) => {
    try {
      const data = await service.cancelSubscription(req.user.organizationId);
      res.json({ status: true, message: "Subscription will cancel at the end of the current period.", data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  reactivate: async (req, res) => {
    try {
      const data = await service.reactivateSubscription(req.user.organizationId);
      res.json({ status: true, message: "Subscription reactivated.", data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  autoRenew: async (req, res) => {
    try {
      const data = await service.setAutoRenew(req.user.organizationId, req.body.autoRenew);
      res.json({ status: true, message: "Auto-renew updated.", data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  mySubscription: async (req, res) => {
    try {
      const data = await service.mySubscription(req.user.organizationId);
      res.json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = organizationSubscriptionController;