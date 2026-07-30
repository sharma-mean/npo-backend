const test = require("node:test");
const assert = require("node:assert");

const {
  validateCreatePlan,
  validateUpdatePlan,
} = require("../src/modules/subscriptionPlan/subscriptionPlan.validation");

const valid = { name: "Pro", durationDays: 30, price: 49.5, maxUsers: 10 };

test("validateCreatePlan: accepts a valid plan", () => {
  assert.doesNotThrow(() => validateCreatePlan({ ...valid }));
});

test("validateCreatePlan: accepts numeric strings", () => {
  assert.doesNotThrow(() =>
    validateCreatePlan({ name: "P", durationDays: "30", price: "0", maxUsers: "5" }),
  );
});

test("validateCreatePlan: rejects missing required fields", () => {
  for (const f of ["name", "durationDays", "price", "maxUsers"]) {
    const d = { ...valid };
    delete d[f];
    assert.throws(() => validateCreatePlan(d), new RegExp(f));
  }
});

test("validateCreatePlan: rejects non-numeric price/duration/maxUsers (NaN guard)", () => {
  assert.throws(() => validateCreatePlan({ ...valid, price: "abc" }));
  assert.throws(() => validateCreatePlan({ ...valid, durationDays: "xx" }));
  assert.throws(() => validateCreatePlan({ ...valid, maxUsers: "" }));
});

test("validateCreatePlan: rejects non-positive duration/maxUsers and negative price", () => {
  assert.throws(() => validateCreatePlan({ ...valid, durationDays: 0 }));
  assert.throws(() => validateCreatePlan({ ...valid, maxUsers: -1 }));
  assert.throws(() => validateCreatePlan({ ...valid, price: -5 }));
});

test("validateCreatePlan: price 0 is allowed (free plan)", () => {
  assert.doesNotThrow(() => validateCreatePlan({ ...valid, price: 0 }));
});

test("validateUpdatePlan: only validates provided fields", () => {
  assert.doesNotThrow(() => validateUpdatePlan({ name: "New name" }));
  assert.doesNotThrow(() => validateUpdatePlan({}));
});

test("validateUpdatePlan: rejects bad provided values", () => {
  assert.throws(() => validateUpdatePlan({ durationDays: "abc" }));
  assert.throws(() => validateUpdatePlan({ maxUsers: 0 }));
  assert.throws(() => validateUpdatePlan({ price: -1 }));
});
