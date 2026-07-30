const staffService = require("./staff.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const createStaff = async (req, res) => {
  try {
    const staff = await staffService.createStaff(req.body, req.user);
    res.status(201).json({
      status: true,
      message: "Staff created successfully",
      data: serializeBigInt(staff),
    });
  } catch (error) {
    res.status(400).json({ status: false, message: error.message });
  }
};

const getStaff = async (req, res) => {
  try {
    const staff = await staffService.getStaff(req.user);
    res.json({ status: true, data: serializeBigInt(staff) });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

const getStaffById = async (req, res) => {
  try {
    const staff = await staffService.getStaffById(req.params.id, req.user);
    res.json({ status: true, data: serializeBigInt(staff) });
  } catch (error) {
    res.status(404).json({ status: false, message: error.message });
  }
};

const updateStaff = async (req, res) => {
  try {
    const staff = await staffService.updateStaff(req.params.id, req.body, req.user);
    res.json({
      status: true,
      message: "Staff updated successfully",
      data: serializeBigInt(staff),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const deleteStaff = async (req, res) => {
  try {
    const staff = await staffService.deleteStaff(req.params.id, req.user);
    res.json({
      status: true,
      message: "Staff deleted successfully",
      data: serializeBigInt(staff),
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getStaffDashboard = async (req, res) => {
  try {
    const dashboard = await staffService.getStaffDashboard(req.user);
    res.json({ status: true, data: serializeBigInt(dashboard) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getMyTasks = async (req, res) => {
  try {
    const tasks = await staffService.getMyTasks(req.user, req.query);
    res.json({ status: true, data: serializeBigInt(tasks) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getMyParticipants = async (req, res) => {
  try {
    const participants = await staffService.getMyParticipants(req.user);
    res.json({ status: true, data: serializeBigInt(participants) });
  } catch (error) {
    res.status(500).json({ status: false, message: error.message });
  }
};

module.exports = {
  createStaff,
  getStaff,
  getStaffDashboard,
  getMyTasks,
  getMyParticipants,
  getStaffById,
  updateStaff,
  deleteStaff,
};