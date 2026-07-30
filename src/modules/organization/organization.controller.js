const organizationService = require("./organization.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const organizationController = {
  createOrganization: async (req, res) => {
    try {
      const organization = await organizationService.createOrganization(req.body);
      res.status(201).json({
        status: true,
        message: "Organization created successfully",
        data: serializeBigInt(organization),
      }); 
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getOrganizations: async (req, res) => {
    try {
      const organizations = await organizationService.getAllOrganizations();

      return res.status(200).json({
        status: true,
        data: serializeBigInt(organizations),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },

  getOrganizationById: async (req, res) => {
    try {
      const organization = await organizationService.getOrganizationById(
        req.params.id,
      );

      return res.status(200).json({
        status: true,
        data: serializeBigInt(organization),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },

  updateOrganization: async (req, res) => {
    try {
      const organization = await organizationService.updateOrganization(
        req.params.id,
        req.body,
      );

      return res.status(200).json({
        status: true,
        data: serializeBigInt(organization),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },

  deleteOrganization: async (req, res) => {
    try {
      const deletedOrganization = await organizationService.deleteOrganization(req.params.id);

      return res.status(200).json({
        status: true,
        message: "Deleted successfully",
        data: serializeBigInt(deletedOrganization),
      });
    } catch (error) {
      return res.status(500).json({
        status: false,
        message: error.message,
      });
    }
  },

  getMyOrganization: async (req, res) => {
    try {
      const data = await organizationService.getMyOrganization(req.user.organizationId);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  getBranding: async (req, res) => {
    try {
      const data = await organizationService.getBranding(req.user.organizationId);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  // Brand logo: presigned PUT → confirm key. Shown on invoices/receipts.
  logoUploadUrl: async (req, res) => {
    try {
      const data = await organizationService.createLogoUploadUrl(req.user, req.body);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  updateBrandLogo: async (req, res) => {
    try {
      const data = await organizationService.updateBrandLogo(
        req.user.organizationId,
        req.body.image ?? null,
      );
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  // Map provider + (when Google) the org's own key — needed by every role that
  // can see a booking map, so this is auth() rather than admin-only.
  getMapConfig: async (req, res) => {
    try {
      const data = await organizationService.getMapConfig(req.user.organizationId);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  updateMapConfig: async (req, res) => {
    try {
      const data = await organizationService.updateMapConfig(req.user.organizationId, req.body);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  updateMyOrganization: async (req, res) => {
    try {
      const data = await organizationService.updateMyOrganization(req.user.organizationId, req.body);
      return res.status(200).json({ status: true, message: "Organization updated", data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  getOrgSubscriptions: async (req, res) => {
    try {
      const data = await organizationService.getOrgSubscriptions(req.params.id);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  impersonate: async (req, res) => {
    try {
      const data = await organizationService.impersonate(req.params.id, req.user);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = organizationController;
