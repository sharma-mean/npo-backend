const express = require("express");
const router = express.Router();

const organizationSubscriptionController = require(
  "./organizationSubscription.controller"
);
const auth = require("../../config/auth.middleware");

// NPO admin self-serve billing
router.get("/my", auth(["NPO_ADMIN"]), organizationSubscriptionController.mySubscription);
router.post("/checkout", auth(["NPO_ADMIN"]), organizationSubscriptionController.checkout);
router.post("/cancel", auth(["NPO_ADMIN"]), organizationSubscriptionController.cancel);
router.post("/reactivate", auth(["NPO_ADMIN"]), organizationSubscriptionController.reactivate);
router.patch("/auto-renew", auth(["NPO_ADMIN"]), organizationSubscriptionController.autoRenew);

router.post("/", auth(["SUPER_ADMIN"]), organizationSubscriptionController.createSubscription);
router.get("/", auth(["SUPER_ADMIN"]), organizationSubscriptionController.getSubscriptions);

module.exports = router;