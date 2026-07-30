const express = require("express");
const router = express.Router();

const controller = require(
  "./subscriptionPlan.controller"
);
const auth = require("../../config/auth.middleware");

// Public — landing-page pricing. Must be declared before "/:id" so it isn't
// swallowed by the param route.
router.get("/public", controller.getPublicPlans);

router.post("/", auth(["SUPER_ADMIN"]), controller.createPlan);
router.get("/", auth(["SUPER_ADMIN", "NPO_ADMIN"]), controller.getPlans);
router.get("/:id", auth(["SUPER_ADMIN", "NPO_ADMIN"]), controller.getPlanById);
router.put("/:id", auth(["SUPER_ADMIN"]), controller.updatePlan);
router.delete("/:id", auth(["SUPER_ADMIN"]), controller.deletePlan);

module.exports = router;