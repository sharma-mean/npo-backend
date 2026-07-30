const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const participantController = require("./participant.controller");

const MANAGE = ["NPO_ADMIN", "COORDINATOR", "GUARDIAN"];

// Bulk CSV import — managers only (creates guardian + participant accounts).
router.post("/import", auth(["NPO_ADMIN", "COORDINATOR"]), participantController.importParticipants);
router.post("/", auth(MANAGE), participantController.createParticipant);
router.get("/", auth(), participantController.getParticipants);
router.get("/:id", auth(), participantController.getParticipantById);
router.put("/:id", auth(MANAGE), participantController.updateParticipant);
// Re-send set-password (login) link — managers or the participant's own guardian
router.post("/:id/send-login-link", auth(MANAGE), participantController.sendLoginLink);
router.delete("/:id", auth(MANAGE), participantController.deleteParticipant);

module.exports = router;
