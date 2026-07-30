const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./payment.controller");

// Only the org admin may spend the org's money.
const admin = auth(["NPO_ADMIN"]);

router.post("/checkout", admin, controller.checkout);
// Fallback capture from the Checkout Session (used on the success redirect, so
// a missing/failing webhook still activates the subscription). Idempotent.
router.post("/confirm", admin, controller.confirm);
router.post("/portal", admin, controller.portal);

module.exports = router;
