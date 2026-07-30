const participantService = require("./participant.service");
const serializeBigInt = require("../../utils/bigIntSerializer");
const { parseCsv } = require("../../utils/csv");

const participantController = {
  importParticipants: async (req, res) => {
    try {
      // Accept either parsed rows[] or a raw CSV string.
      let rows = req.body.rows;
      if (!rows && typeof req.body.csv === "string") {
        rows = parseCsv(req.body.csv);
      }
      const dryRun = req.body.dryRun === true || req.query.validate === "true";
      const result = await participantService.importParticipants(req.user, rows, { dryRun });
      res.status(200).json({ status: true, data: serializeBigInt(result) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  createParticipant: async (req, res) => {
    try {
      const result = await participantService.createParticipant(req.body, req.user);
      res.status(201).json({ status: true, data: serializeBigInt(result) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  getParticipants: async (req, res) => {
    try {
      const participants = await participantService.getParticipants(req.user);
      res.json({ status: true, data: serializeBigInt(participants) });
    } catch (error) {
      res.status(500).json({ status: false, message: error.message });
    }
  },

  getParticipantById: async (req, res) => {
    try {
      const participant = await participantService.getParticipantById(
        req.params.id,
        req.user,
      );
      res.json({ status: true, data: serializeBigInt(participant) });
    } catch (error) {
      res.status(404).json({ status: false, message: error.message });
    }
  },

  updateParticipant: async (req, res) => {
    try {
      const participant = await participantService.updateParticipant(
        req.params.id,
        req.body,
        req.user,
      );
      res.json({ status: true, message: "Participant updated successfully", data: serializeBigInt(participant) });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  sendLoginLink: async (req, res) => {
    try {
      const data = await participantService.sendLoginLink(req.params.id, req.user);
      res.json({ status: true, message: "Login link sent", data });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },

  deleteParticipant: async (req, res) => {
    try {
      await participantService.deleteParticipant(req.params.id, req.user);
      res.json({ status: true, message: "Participant deleted successfully" });
    } catch (error) {
      res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = participantController;
