const venueService = require("./venue.service");
const serializeBigInt = require("../../utils/bigIntSerializer");

const venueController = {
  createVenue: async (req, res) => {
    try {
      const venue = await venueService.createVenue(req.body, req.user);

      res.status(201).json({
        status: true,
        message: "Venue created successfully",
        data: serializeBigInt(venue),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getAllVenues: async (req, res) => {
    try {
      const venues = await venueService.getAllVenues(req.user.organizationId);

      res.json({
        status: true,
        data: serializeBigInt(venues),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  getVenueById: async (req, res) => {
    try {
      const venue = await venueService.getVenueById(
        req.params.id,
        req.user.organizationId,
      );

      res.json({
        status: true,
        data: serializeBigInt(venue),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  updateVenue: async (req, res) => {
    try {
      const venue = await venueService.updateVenue(
        req.params.id,
        req.body,
        req.user.organizationId,
      );

      res.json({
        status: true,
        message: "Venue updated successfully",
        data: serializeBigInt(venue),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  toggleVenueStatus: async (req, res) => {
    try {
      const venue = await venueService.toggleVenueStatus(
        req.params.id,
        req.user.organizationId,
      );

      res.json({
        status: true,
        message: "Venue status updated",
        data: serializeBigInt(venue),
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },

  deleteVenue: async (req, res) => {
    try {
      await venueService.deleteVenue(req.params.id, req.user.organizationId);

      res.json({
        status: true,
        message: "Venue deleted successfully",
      });
    } catch (error) {
      res.status(400).json({
        status: false,
        message: error.message,
      });
    }
  },
};

module.exports = venueController;
