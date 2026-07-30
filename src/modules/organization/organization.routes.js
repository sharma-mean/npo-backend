const express = require("express");
const router = express.Router();

const organizationController = require("./organization.controller");
const auth = require("../../config/auth.middleware");

// NPO admin: manage own organization (must precede /:id)
router.get("/me", auth(["NPO_ADMIN"]), organizationController.getMyOrganization);
router.get("/branding", auth(), organizationController.getBranding);
router.put("/me", auth(["NPO_ADMIN"]), organizationController.updateMyOrganization);

// Brand logo (NPO admin) — appears on invoices/receipts and the app header.
router.post("/logo/upload-url", auth(["NPO_ADMIN"]), organizationController.logoUploadUrl);
router.patch("/logo", auth(["NPO_ADMIN"]), organizationController.updateBrandLogo);

// Map settings. Any org member READS it (they need the provider to render a
// map); only the admin CHANGES it (it's their Google billing on the line).
router.get("/map-config", auth(), organizationController.getMapConfig);
router.put("/map-config", auth(["NPO_ADMIN"]), organizationController.updateMapConfig);

router.post("/", auth(["SUPER_ADMIN"]), organizationController.createOrganization);
router.get("/", auth(["SUPER_ADMIN"]), organizationController.getOrganizations);
router.get("/:id/subscriptions", auth(["SUPER_ADMIN"]), organizationController.getOrgSubscriptions);
router.post("/:id/impersonate", auth(["SUPER_ADMIN"]), organizationController.impersonate);
router.get("/:id", auth(["SUPER_ADMIN"]), organizationController.getOrganizationById);
router.put("/:id", auth(["SUPER_ADMIN"]), organizationController.updateOrganization);
router.delete("/:id", auth(["SUPER_ADMIN"]), organizationController.deleteOrganization);

module.exports = router;