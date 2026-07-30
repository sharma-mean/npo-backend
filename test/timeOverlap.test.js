const test = require("node:test");
const assert = require("node:assert");

const { overlaps, overlapWhere, toBig } = require("../src/utils/timeOverlap");

test("overlaps: true when windows intersect", () => {
  assert.strictEqual(overlaps(10, 20, 15, 25), true);
});

test("overlaps: true when one window contains the other", () => {
  assert.strictEqual(overlaps(10, 100, 40, 50), true);
});

test("overlaps: false when adjacent (end == start)", () => {
  // [10,20) and [20,30) do not overlap — half-open intervals
  assert.strictEqual(overlaps(10, 20, 20, 30), false);
});

test("overlaps: false when fully disjoint", () => {
  assert.strictEqual(overlaps(10, 20, 30, 40), false);
});

test("overlaps: works with BigInt and number mix", () => {
  assert.strictEqual(overlaps(BigInt(10), 20, 15, BigInt(25)), true);
});

test("overlapWhere: builds correct prisma fragment", () => {
  const w = overlapWhere(100, 200);
  assert.strictEqual(w.startTime.lt, 200n);
  assert.strictEqual(w.endTime.gt, 100n);
});

test("toBig: coerces number to BigInt, passes BigInt through", () => {
  assert.strictEqual(toBig(5), 5n);
  assert.strictEqual(toBig(7n), 7n);
});
