const serializeBigInt = require("../../utils/bigIntSerializer");
const service = require("./staffAvailability.service");

const createAvailability = async (req, res) => {
  try {
    const result = await service.createAvailability(req.body, req.user);
    return res.status(201).json({
      status: true,
      message: "Availability recorded",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const getAvailability = async (req, res) => {
  try {
    const result = await service.getAvailability(req.user, req.query);
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const deleteAvailability = async (req, res) => {
  try {
    await service.deleteAvailability(req.params.id, req.user);
    return res
      .status(200)
      .json({ status: true, message: "Availability removed" });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

module.exports = {
  createAvailability,
  getAvailability,
  deleteAvailability,
};
