const {
  INCIDENT_TYPES,
  INCIDENT_SEVERITIES,
} = require("./incident.constants");

const validateCreateIncident = (data) => {
  if (!data.type || !INCIDENT_TYPES.includes(data.type)) {
    throw new Error(`type must be one of: ${INCIDENT_TYPES.join(", ")}`);
  }
  if (!data.title || !data.title.trim()) {
    throw new Error("title is required");
  }
  if (data.severity && !INCIDENT_SEVERITIES.includes(data.severity)) {
    throw new Error(`severity must be one of: ${INCIDENT_SEVERITIES.join(", ")}`);
  }
};

module.exports = { validateCreateIncident };
