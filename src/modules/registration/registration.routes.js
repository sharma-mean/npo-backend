const express = require("express");
const router = express.Router();
const controller = require("./registration.controller");
const rateLimit = require("../../middleware/rateLimit");

const FIFTEEN_MIN = 15 * 60 * 1000;
const signupLimiter = rateLimit({ windowMs: FIFTEEN_MIN, max: 10, keyPrefix: "signup" });

// Public self-service organization registration
router.post("/", signupLimiter, controller.register);
router.post("/verify-email", signupLimiter, controller.verifyEmail);
router.post("/resend", signupLimiter, controller.resend);

module.exports = router;
