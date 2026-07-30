const test = require("node:test");
const assert = require("node:assert");

const { validateRegistration } = require("../src/modules/registration/registration.logic");

const valid = {
  orgName: "Care Org",
  email: "admin@care.org",
  phone: "9990001111",
  adminName: "Admin",
  password: "secret123",
};

test("validateRegistration: accepts valid input, returns email", () => {
  const { email } = validateRegistration(valid);
  assert.strictEqual(email, "admin@care.org");
});

test("validateRegistration: falls back to adminEmail/orgEmail", () => {
  const { email } = validateRegistration({ ...valid, email: undefined, adminEmail: "a@b.com" });
  assert.strictEqual(email, "a@b.com");
});

test("validateRegistration: missing required field throws", () => {
  assert.throws(() => validateRegistration({ ...valid, orgName: "" }), /orgName is required/);
  assert.throws(() => validateRegistration({ ...valid, phone: "" }), /phone is required/);
  assert.throws(() => validateRegistration({ ...valid, email: "", adminEmail: "", orgEmail: "" }), /email is required/);
});

test("validateRegistration: invalid email throws", () => {
  assert.throws(() => validateRegistration({ ...valid, email: "not-email" }), /Invalid email/);
});

test("validateRegistration: password under 8 chars throws", () => {
  assert.throws(() => validateRegistration({ ...valid, password: "short1" }), /at least 8/);
});
