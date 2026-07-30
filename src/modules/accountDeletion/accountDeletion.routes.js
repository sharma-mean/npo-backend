const express = require("express");
const router = express.Router();

const controller = require("./accountDeletion.controller");
const auth = require("../../config/auth.middleware");

const manager = auth(["NPO_ADMIN", "COORDINATOR"]);

// Self-service — every role can ask for their own account to be deleted.
router.post("/me", auth(), controller.requestMine);
router.get("/me", auth(), controller.getMine);
router.delete("/me", auth(), controller.cancelMine);

// Manager review. `/me` is declared first so it never falls into `/:id`.
router.get("/", manager, controller.list);
router.patch("/:id/approve", manager, controller.approve);
router.patch("/:id/reject", manager, controller.reject);

module.exports = router;
