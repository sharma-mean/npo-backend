const express = require("express");

const router = express.Router();

const controller = require("./notification.controller");
const auth = require("../../config/auth.middleware");

// Raw email-send utilities — privileged, not used by the app UI. Gate to SUPER_ADMIN
// so an anonymous caller can't abuse the org mailer for spam/phishing.
router.post("/send-email", auth(["SUPER_ADMIN"]), controller.sendEmail);

router.post("/send-bulk-emails", auth(["SUPER_ADMIN"]), controller.sendBulkEmails);

// In-app notifications — current user
router.get("/", auth(), controller.getMyNotifications);

router.patch("/:id/read", auth(), controller.markRead);

router.patch("/read-all", auth(), controller.markAllRead);

module.exports = router;
