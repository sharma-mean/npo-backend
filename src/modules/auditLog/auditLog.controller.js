const serializeBigInt = require("../../utils/bigIntSerializer");
const service = require("./auditLog.service");

const getAuditLogs = async (req, res) => {
  try {
    const result = await service.getAuditLogs(req.user, req.query);
    return res
      .status(200)
      .json({ status: true, data: serializeBigInt(result) });
  } catch (error) {
    return res.status(400).json({ status: false, message: error.message });
  }
};

module.exports = { getAuditLogs };
