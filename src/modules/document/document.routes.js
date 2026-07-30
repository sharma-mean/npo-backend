const express = require("express");
const router = express.Router();
const auth = require("../../config/auth.middleware");
const controller = require("./document.controller");

const managers = auth(["NPO_ADMIN", "COORDINATOR"]);

// Upload is a two-step flow: presigned PUT → confirm metadata. The file streams
// browser→B2 directly; it never passes through this server.
//
// auth() rather than manager-only, because the SERVICE decides per owner: a
// staff member attaches photos to an incident they reported, a guardian attaches
// files to their own booking, managers may upload anywhere. Delete is likewise
// manager-or-uploader.
router.post("/upload-url", auth(), controller.uploadUrl);
router.post("/", auth(), controller.confirm);
router.delete("/:id", auth(), controller.remove);

// Compliance alerts (expired / expiring licences + vehicle inspections).
// Declared before "/:id/..." routes so it isn't swallowed by a param route.
router.get("/compliance", managers, controller.compliance);

// Reads + consent are auth() — the service scopes them (guardians see only
// their own participants' documents; staff see none).
router.get("/", auth(), controller.list);
router.get("/:id/download", auth(), controller.download);
router.patch("/:id/consent", auth(), controller.consent);

module.exports = router;
