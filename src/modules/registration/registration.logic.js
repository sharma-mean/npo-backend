// Pure registration validation (no DB) — unit-testable.
const EMAIL_RE = /^\S+@\S+\.\S+$/;
const MIN_PASSWORD = 8;

// Validates + normalizes signup input. Returns { email } (trimmed+lowercased)
// or throws.
function validateRegistration(data = {}) {
  const email = (data.email || data.adminEmail || data.orgEmail || "")
    .trim()
    .toLowerCase();
  const required = {
    orgName: data.orgName,
    email,
    phone: data.phone,
    adminName: data.adminName,
    password: data.password,
  };
  for (const [field, value] of Object.entries(required)) {
    if (!value) throw new Error(`${field} is required`);
  }
  if (!EMAIL_RE.test(email)) throw new Error("Invalid email format");
  if (data.password.length < MIN_PASSWORD) {
    throw new Error(`Password must be at least ${MIN_PASSWORD} characters`);
  }
  return { email };
}

module.exports = { validateRegistration, EMAIL_RE, MIN_PASSWORD };
