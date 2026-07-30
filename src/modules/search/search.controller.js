const searchService = require("./search.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const searchController = {
  search: async (req, res) => {
    try {
      const data = await searchService.search(req.user, req.query.q);
      return res.status(200).json({ status: true, data: serializeBigInt(data) });
    } catch (error) {
      return res.status(400).json({ status: false, message: error.message });
    }
  },
};

module.exports = searchController;
