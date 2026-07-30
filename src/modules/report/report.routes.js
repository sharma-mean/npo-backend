const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./report.controller");

const managers = auth(["NPO_ADMIN", "COORDINATOR"]);

router.get("/bookings", managers, controller.bookings);
router.get("/attendance", managers, controller.attendance);
router.get("/export", managers, controller.export);

module.exports = router;
