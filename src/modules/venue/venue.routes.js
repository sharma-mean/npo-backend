const express = require("express");
const router = express.Router();

const venueController = require("./venue.controller");
const auth = require("../../config/auth.middleware");

const MANAGER = ["NPO_ADMIN", "COORDINATOR"];

router.post("/", auth(MANAGER), venueController.createVenue);

router.get("/", auth(), venueController.getAllVenues);

router.get("/:id", auth(), venueController.getVenueById);

router.put("/:id", auth(MANAGER), venueController.updateVenue);

router.patch("/:id/toggle-status", auth(MANAGER), venueController.toggleVenueStatus);

router.delete("/:id", auth(MANAGER), venueController.deleteVenue);

module.exports = router;
