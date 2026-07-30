const test = require("node:test");
const assert = require("node:assert");

const userValidation = require("../src/modules/user/user.validation");

test("validatePassword: rejects passwords shorter than 8", () => {
  assert.throws(() => userValidation.validatePassword("1234567"));
  assert.throws(() => userValidation.validatePassword(""));
  assert.throws(() => userValidation.validatePassword(undefined));
});

test("validatePassword: accepts 8+ chars", () => {
  assert.doesNotThrow(() => userValidation.validatePassword("12345678"));
});

test("validateEmail: rejects malformed", () => {
  assert.throws(() => userValidation.validateEmail("not-an-email"));
  assert.throws(() => userValidation.validateEmail("a@b"));
});

test("validateEmail: accepts valid", () => {
  assert.doesNotThrow(() => userValidation.validateEmail("a@b.com"));
});

test("validateCreateUser: requires core fields", () => {
  assert.throws(() => userValidation.validateCreateUser({ email: "a@b.com" }));
});

test("validateCreateUser: rejects invalid role", () => {
  assert.throws(() =>
    userValidation.validateCreateUser({
      fullName: "X",
      email: "a@b.com",
      password: "123456",
      role: "NOPE",
    }),
  );
});

test("staffRoleAssign: requires and retains designationId for STAFF and COORDINATOR roles", () => {
  const staffData = { role: "STAFF", designationId: "role-1", serviceType: "MOBILITY" };
  userValidation.staffRoleAssign(staffData);
  assert.strictEqual(staffData.designationId, "role-1");

  const coordData = { role: "COORDINATOR", designationId: "role-2", serviceType: "DAYCARE" };
  userValidation.staffRoleAssign(coordData);
  assert.strictEqual(coordData.designationId, "role-2");

  const guardianData = { role: "GUARDIAN", designationId: "role-3" };
  userValidation.staffRoleAssign(guardianData);
  assert.strictEqual(guardianData.designationId, null);
});
