const serializeBigInt = require("../../utils/bigIntSerializer");
const incidentService = require("./incident.service");

const createIncident = async (req, res) => {
  try {
    const result = await incidentService.createIncident(req.body, req.user);
    return res.status(201).json({
      status: true,
      message: "Incident reported",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getAllIncidents = async (req, res) => {
  try {
    const result = await incidentService.getAllIncidents(req.user, req.query);
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getIncidentById = async (req, res) => {
  try {
    const result = await incidentService.getIncidentById(
      req.params.id,
      req.user,
    );
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    return res.status(404).json({ status: false, message: error.message });
  }
};

const updateIncident = async (req, res) => {
  try {
    const result = await incidentService.updateIncident(
      req.params.id,
      req.body,
      req.user,
    );
    return res.status(200).json({
      status: true,
      message: "Incident updated",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const resolveIncident = async (req, res) => {
  try {
    const result = await incidentService.resolveIncident(
      req.params.id,
      req.body.resolutionNotes,
      req.user,
    );
    return res.status(200).json({
      status: true,
      message: "Incident resolved",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

module.exports = {
  createIncident,
  getAllIncidents,
  getIncidentById,
  updateIncident,
  resolveIncident,
};
