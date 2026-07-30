const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const vehicleController = require("./vehicle.controller");

const MANAGER = ["NPO_ADMIN", "COORDINATOR"];

router.post("/", auth(MANAGER), vehicleController.createVehicle);
router.get("/", auth(), vehicleController.getAllVehicles);
router.get("/:id", auth(), vehicleController.getVehicleById);
router.put("/:id", auth(MANAGER), vehicleController.updateVehicle);
router.patch("/:id/toggle-status", auth(MANAGER), vehicleController.toggleVehicleStatus);
router.delete("/:id", auth(MANAGER), vehicleController.deleteVehicle);

module.exports = router;
