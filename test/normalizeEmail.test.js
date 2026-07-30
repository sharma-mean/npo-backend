const test = require("node:test");
const assert = require("node:assert");

const normalizeEmail = require("../src/utils/normalizeEmail");

test("normalizeEmail: trims + lowercases", () => {
  assert.strictEqual(normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
});

test("normalizeEmail: nullish → empty string", () => {
  assert.strictEqual(normalizeEmail(undefined), "");
  assert.strictEqual(normalizeEmail(null), "");
  assert.strictEqual(normalizeEmail(123), "");
});
