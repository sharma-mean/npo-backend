const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./ongoingBooking.controller");

// Live operations view — managers only. The service scopes every read to
// req.user.organizationId, so one tenant can never see another's trips.
const manager = auth(["NPO_ADMIN", "COORDINATOR"]);

router.get("/ongoing", manager, controller.ongoing);
router.get("/:id", manager, controller.detail);

module.exports = router;
