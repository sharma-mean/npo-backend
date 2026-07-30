const serializeBigInt = require("../../utils/bigIntSerializer");
const service = require("./device.service");

const register = async (req, res) => {
  try {
    const result = await service.registerDevice(req.user, req.body);
    return res.status(200).json({
      status: true,
      message: "Device registered for push notifications",
      data: serializeBigInt(result),
    });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

const unregister = async (req, res) => {
  try {
    const result = await service.unregisterDevice(req.user, req.body);
    return res.status(200).json({ status: true, data: result });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

module.exports = { register, unregister };
