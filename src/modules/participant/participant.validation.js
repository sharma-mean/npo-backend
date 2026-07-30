const { PARTICIPANT_STATUS, GENDER } = require("./participant.constants");

const validateCreateParticipant = (data) => {
  const requiredFields = [
    // "fullName",
    "dob",
    "gender",
    // "guardianId",
    // "organizationId",
    "serviceType",
  ];

  for (const field of requiredFields) {
    if (!data.participant[field]) {
      throw new Error(`${field} is required`);
    }
  }

  if (!GENDER.includes(data.participant.gender)) {
    throw new Error("Invalid gender");
  }
};

const validateUpdateParticipant = (data) => {
  if (data.participant.gender && !GENDER.includes(data.participant.gender)) {
    throw new Error("Invalid gender");
  }

  if (
    data.participant.status &&
    !PARTICIPANT_STATUS.includes(data.participant.status)
  ) {
    throw new Error("Invalid participant status");
  }
};

module.exports = {
  validateCreateParticipant,
  validateUpdateParticipant,
};
