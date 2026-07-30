const express = require("express");
const router = express.Router();

const controller = require("./dailyReport.controller");
const auth = require("../../config/auth.middleware");

// Staff/managers author reports; guardians + participants only read their own.
const author = auth(["NPO_ADMIN", "COORDINATOR", "STAFF"]);

router.get("/options", auth(), controller.options);

// Reads are role-scoped inside the service (guardian → own finalized, staff →
// own authored, manager → all).
router.get("/", auth(), controller.list);
router.get("/:id", auth(), controller.getById);

router.post("/", author, controller.create);
router.patch("/:id/finalize", author, controller.finalize);
router.patch("/:id", author, controller.update);
router.delete("/:id", author, controller.remove);

module.exports = router;
