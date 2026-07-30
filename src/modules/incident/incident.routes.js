const express = require("express");
const router = express.Router();

const controller = require("./incident.controller");
const auth = require("../../config/auth.middleware");

router.post("/", auth(), controller.createIncident);

router.get("/", auth(), controller.getAllIncidents);

router.get("/:id", auth(), controller.getIncidentById);

router.put("/:id", auth(), controller.updateIncident);

router.patch("/:id/resolve", auth(), controller.resolveIncident);

module.exports = router;
