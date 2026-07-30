const express = require("express");

const router = express.Router();

const bookingController = require("./booking.controller");
const auth = require("../../config/auth.middleware");
router.post("/", auth(), bookingController.createBooking);

router.post("/recurring", auth(), bookingController.createRecurringBookings);

router.get("/pending", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.getPendingBookings);

router.get("/waitlisted", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.getWaitlistedBookings);

router.get("/my-bookings", auth(), bookingController.getMyBookings);

// Compact booking list for the incident-report picker (role-aware in service:
// managers = org bookings, staff = own assigned bookings).
router.get("/for-incident", auth(["NPO_ADMIN", "COORDINATOR", "STAFF"]), bookingController.getBookingsForIncident);

router.get("/:id/fulfillment", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.getBookingFulfillment);

router.patch("/:id/fulfill", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.fulfillBooking);
// Dispatch a vehicle to an already-APPROVED booking (the drag-and-drop board).
// `fulfill` only accepts PENDING, so post-approval dispatch needs its own route.
router.patch("/:id/vehicle", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.assignVehicle);

router.get("/", auth(), bookingController.allBookings);

router.patch("/:id/approve", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.approveBooking);

router.patch("/:id/reject", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.rejectBooking);

router.patch("/:id/complete", auth(["NPO_ADMIN", "COORDINATOR"]), bookingController.completeBooking);

router.patch("/:id/cancel", auth(), bookingController.cancelBooking);

router.patch("/series/:groupId/cancel", auth(), bookingController.cancelSeries);

// On-demand pickup geocoding (serverless-safe; org-scoped in service).
router.post("/:id/geocode", auth(), bookingController.geocodeBooking);

// Live staff location for a running booking — guardian (own) or manager (org).
router.get("/:id/live-location", auth(), bookingController.getLiveLocation);

module.exports = router;
