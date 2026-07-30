const documentService = require("./document.service");
const complianceService = require("./compliance.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const documentController = {
  // Compliance paperwork that has expired or lapses within 30 days.
  compliance: async (req, res) => {
    try {
      const data = await complianceService.getExpiring(req.user.organizationId, req.query.days);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  uploadUrl: async (req, res) => {
    try {
      const data = await documentService.createUploadUrl(req.user, req.body);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  confirm: async (req, res) => {
    try {
      const document = await documentService.confirmUpload(req.user, req.body);
      return res.status(201).json({ status: true, data: serializeBigInt(document) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  list: async (req, res) => {
    try {
      const documents = await documentService.list(req.user, req.query);
      return res.status(200).json({ status: true, data: serializeBigInt(documents) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  download: async (req, res) => {
    try {
      const data = await documentService.getDownloadUrl(req.user, req.params.id);
      return res.status(200).json({ status: true, data });
    } catch (error) {
      return res.status(404).json({ status: false, message: error.message });
    }
  },

  consent: async (req, res) => {
    try {
      const document = await documentService.giveConsent(req.user, req.params.id);
      return res.status(200).json({ status: true, data: serializeBigInt(document) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },

  remove: async (req, res) => {
    try {
      await documentService.remove(req.user, req.params.id);
      return res.status(200).json({ status: true, message: "Document deleted" });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = documentController;
