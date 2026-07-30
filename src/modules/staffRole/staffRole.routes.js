const express = require("express");
const roleController = require("./staffRole.controller");
const auth = require("../../config/auth.middleware");
const router = express.Router();

router.post("/", auth(["NPO_ADMIN", "COORDINATOR"]), roleController.create);

router.get("/", auth(), roleController.getAll);

router.get("/:id", auth(), roleController.getById);

router.patch("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), roleController.update);

router.patch("/:id/toggle-status", auth(["NPO_ADMIN", "COORDINATOR"]), roleController.toggleStatus);

router.delete("/:id", auth(["NPO_ADMIN", "COORDINATOR"]), roleController.delete);

router.get("/:id/staff", auth(), roleController.getStaffByRole);

module.exports = router;
