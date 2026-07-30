const express = require("express");

const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./serviceController");

const MANAGER = ["NPO_ADMIN", "COORDINATOR"];

router.post("/", auth(MANAGER), controller.createService);

router.get("/", auth(), controller.getServices);

router.get("/:id", auth(), controller.getServiceById);

router.patch("/:id", auth(MANAGER), controller.updateService);

router.patch("/:id/toggle-status", auth(MANAGER), controller.toggleStatus);

router.delete("/:id", auth(MANAGER), controller.deleteService);

module.exports = router;
