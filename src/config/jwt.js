const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

// Fail fast at boot rather than signing/verifying with an undefined secret
// (which would silently weaken or break auth). Skipped under NODE_ENV=test
// where the unit suite doesn't load a real environment.
if (!JWT_SECRET && process.env.NODE_ENV !== "test") {
  throw new Error(
    "JWT_SECRET is not set. Refusing to start — configure it in the environment.",
  );
}

const generateAccessToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
      role: user.role,
      organizationId: user.organizationId,
    },
    JWT_SECRET,
    { expiresIn: "7d" },
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    {
      userId: user.id,
    },
    JWT_REFRESH_SECRET,
    { expiresIn: "7d" },
  );
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
};
