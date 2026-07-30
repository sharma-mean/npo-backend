const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const {
  createStaff,
  getStaff,
  getStaffDashboard,
  getMyTasks,
  getMyParticipants,
  getStaffById,
  updateStaff,
  deleteStaff,
} = require("./staff.controller");

router.post("/staff", auth(), createStaff);
router.get("/staff", auth(), getStaff);
router.get("/staff/dashboard", auth(), getStaffDashboard);
router.get("/staff/my/tasks", auth(), getMyTasks);
router.get("/staff/my/participants", auth(), getMyParticipants);
router.get("/staff/:id", auth(), getStaffById);
router.patch("/staff/:id", auth(), updateStaff);
router.delete("/staff/:id", auth(), deleteStaff);
module.exports = router;
