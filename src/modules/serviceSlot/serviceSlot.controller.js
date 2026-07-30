const serializeBigInt = require("../../utils/bigIntSerializer");
const slotService = require("./serviceSlot.service");

const createSlot = async (req, res) => {
  try {
    const result = await slotService.createSlot(req.body, req.user);
    return res.status(201).json({
      status: true,
      message: "Service slot created",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const generateRecurringSlots = async (req, res) => {
  try {
    const result = await slotService.generateRecurringSlots(req.body, req.user);
    return res.status(201).json({
      status: true,
      message: `Generated ${result.created.length} slot(s), ${result.skipped.length} skipped`,
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getAllSlots = async (req, res) => {
  try {
    const result = await slotService.getAllSlots(req.user, req.query);
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getSlotById = async (req, res) => {
  try {
    const result = await slotService.getSlotById(req.params.id, req.user);
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    return res.status(404).json({ status: false, message: error.message });
  }
};

const updateSlot = async (req, res) => {
  try {
    const result = await slotService.updateSlot(
      req.params.id,
      req.body,
      req.user,
    );
    return res.status(200).json({
      status: true,
      message: "Service slot updated",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const deleteSlot = async (req, res) => {
  try {
    await slotService.deleteSlot(req.params.id, req.user);
    return res.status(200).json({ status: true, message: "Service slot deleted" });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

module.exports = {
  createSlot,
  generateRecurringSlots,
  getAllSlots,
  getSlotById,
  updateSlot,
  deleteSlot,
};
