const express = require("express");
const router = express.Router();
const userController = require("./user.controller");
const auth = require("../../config/auth.middleware");
const rateLimit = require("../../middleware/rateLimit");

const FIFTEEN_MIN = 15 * 60 * 1000;
const loginLimiter = rateLimit({ windowMs: FIFTEEN_MIN, max: 10, keyPrefix: "login" });
const resetLimiter = rateLimit({ windowMs: FIFTEEN_MIN, max: 5, keyPrefix: "pwreset" });

router.post("/login", loginLimiter, userController.login);
router.post("/logout", auth(), userController.logout);

// Sliding session: swap a still-valid token for a fresh 7-day one. The mobile
// app calls this on foreground so a daily user is never signed out, while a
// phone left untouched for 7 days still expires.
router.post("/refresh", auth(), userController.refreshToken);

// Public self-service password reset
router.post("/forgot-password", resetLimiter, userController.forgotPassword);
router.post("/reset-password", resetLimiter, userController.resetPassword);

router.post("/import", auth(["NPO_ADMIN", "COORDINATOR"]), userController.importUsers);
router.post("/", auth(["NPO_ADMIN", "COORDINATOR"]), userController.createUser);
// Listing/enumerating users is a manager operation — never expose the staff
// roster (emails/phones) to guardians/participants/staff.
router.get("/", auth(["NPO_ADMIN", "COORDINATOR"]), userController.getUsers);
router.get("/active", auth(["NPO_ADMIN", "COORDINATOR"]), userController.getActiveUsers);
// By-id stays auth() but the service allows only self or a manager (profile page
// reads the caller's own id).
router.get("/:id", auth(), userController.getUserById);
router.put("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), userController.updateUser);
router.delete("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), userController.deleteUser);

router.patch("/password/update", auth(), userController.updateUserPassword);
// Avatar is self-service for EVERY role — auth() only, no role gate.
router.post("/profile-image/upload-url", auth(), userController.avatarUploadUrl);
router.patch("/profile-image", auth(), userController.updateProfileImage);
// Self-service only: consent must come from the person it belongs to.
router.patch("/location-consent", auth(), userController.setLocationConsent);
router.patch(
  "/:id/password/reset",
  auth(["NPO_ADMIN", "COORDINATOR"]),
  userController.userResetPassword,
);
router.patch(
  "/:id/toggle-status",
  auth(["NPO_ADMIN", "COORDINATOR"]),
  userController.toggleUserStatus,
);

module.exports = router;
