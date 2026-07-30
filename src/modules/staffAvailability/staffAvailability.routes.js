const express = require("express");
const router = express.Router();

const controller = require("./staffAvailability.controller");
const auth = require("../../config/auth.middleware");

router.post("/", auth(), controller.createAvailability);

router.get("/", auth(), controller.getAvailability);

router.delete("/:id", auth(), controller.deleteAvailability);

module.exports = router;
