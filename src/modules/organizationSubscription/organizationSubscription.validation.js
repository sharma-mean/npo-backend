const validateCreateSubscription = (data) => {
  if (!data.organizationId)
    throw new Error("organizationId required");

  if (!data.planId)
    throw new Error("planId required");
};

module.exports = {
  validateCreateSubscription
};