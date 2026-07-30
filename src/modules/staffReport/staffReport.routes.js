const express = require("express");
const auth = require("../../config/auth.middleware");
const controller = require("./staffReport.controller");

const router = express.Router();

router.get("/", auth(), controller.listReports);
router.post("/", auth(), controller.createReport);
router.get("/:id", auth(), controller.getReportById);
router.patch("/:id", auth(), controller.updateReport);
router.patch("/:id/submit", auth(), controller.submitReport);

module.exports = router;
