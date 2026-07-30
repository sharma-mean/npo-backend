const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./staffAttendance.controller");

router.post("/check-in", auth(), controller.checkIn);

router.patch("/check-out", auth(), controller.checkOut);

router.get("/my-attendance/:userId", auth(), controller.getMyAttendance);

router.get("/getAllStaffAttendance", auth(), controller.getAllStaffAttendance);

router.get("/monthly-summary/:userId", auth(), controller.getMonthlySummary);

router.post("/emergency-leave", auth(), controller.applyEmergencyLeave);

router.post("/delay-reports", auth(), controller.createDelayReport);

router.post("/incident-reports", auth(), controller.createIncidentReport);

router.delete("/:id", auth(), controller.deleteAttendance);

module.exports = router;
