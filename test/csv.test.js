const test = require("node:test");
const assert = require("node:assert");

const { toCsv } = require("../src/utils/csv");

test("toCsv: header + rows in order", () => {
  const csv = toCsv(["a", "b"], [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
  assert.strictEqual(csv, "a,b\n1,2\n3,4");
});

test("toCsv: missing keys render as empty", () => {
  const csv = toCsv(["a", "b"], [{ a: 1 }]);
  assert.strictEqual(csv, "a,b\n1,");
});

test("toCsv: quotes values with commas", () => {
  const csv = toCsv(["name"], [{ name: "Doe, John" }]);
  assert.strictEqual(csv, 'name\n"Doe, John"');
});

test("toCsv: escapes embedded double quotes", () => {
  const csv = toCsv(["q"], [{ q: 'a "quote"' }]);
  assert.strictEqual(csv, 'q\n"a ""quote"""');
});

test("toCsv: quotes values with newlines", () => {
  const csv = toCsv(["x"], [{ x: "line1\nline2" }]);
  assert.strictEqual(csv, 'x\n"line1\nline2"');
});

test("toCsv: empty rows yields header only", () => {
  assert.strictEqual(toCsv(["a", "b"], []), "a,b");
});

test("toCsv: neutralizes formula-injection leading chars", () => {
  // =,+,-,@ leading → prefixed with a quote so spreadsheets don't evaluate.
  assert.strictEqual(toCsv(["x"], [{ x: "=1+1" }]), "x\n'=1+1");
  assert.strictEqual(toCsv(["x"], [{ x: "@SUM(A1)" }]), "x\n'@SUM(A1)");
  // Still RFC-4180 quoted when it also contains a comma.
  assert.strictEqual(
    toCsv(["x"], [{ x: "=HYPERLINK(1,2)" }]),
    'x\n"\'=HYPERLINK(1,2)"',
  );
  // Benign values untouched.
  assert.strictEqual(toCsv(["x"], [{ x: "John" }]), "x\nJohn");
});
