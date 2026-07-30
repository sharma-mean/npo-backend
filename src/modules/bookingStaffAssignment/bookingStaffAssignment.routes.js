const express = require("express");

const router = express.Router();

const controller = require("./bookingStaffAssignment.controller");
const auth = require("../../config/auth.middleware");

const MANAGER = ["NPO_ADMIN", "COORDINATOR"];

// Assigning/managing the roster is a manager operation.
router.post("/", auth(MANAGER), controller.createAssignment);

router.get(
  "/booking/:bookingId/available-staff",
  auth(MANAGER),
  controller.getAvailableStaff,
);

router.get("/booking/:bookingId", auth(MANAGER), controller.getBookingAssignments);

// Self tasks (managers may query a specific staff's tasks; staff get their own).
router.get("/my-tasks/:userId", auth(), controller.getMyTasks);

// Staff acknowledgement — owner-only (service enforces).
router.patch("/:id/accept", auth(), controller.acceptAssignment);

router.patch("/:id/decline", auth(), controller.declineAssignment);

// Status transitions — service authorizes manager-or-owning-staff.
router.patch("/:id/start", auth(), controller.startTask);

router.patch("/:id/end", auth(), controller.endTask);

router.patch("/:id/complete", auth(), controller.completeTask);

router.patch("/:id/cancel", auth(), controller.cancelTask);

// Live location — staff only, and only their own assignment (the service
// re-checks ownership + that the task is actually running).
router.post("/:id/location", auth(), controller.recordLocation);

router.delete("/:id", auth(MANAGER), controller.deleteAssignment);

module.exports = router;
