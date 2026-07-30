const test = require("node:test");
const assert = require("node:assert");

const serializeBigInt = require("../src/utils/bigIntSerializer");

test("serializeBigInt: converts BigInt to string", () => {
  const out = serializeBigInt({ createdAt: 1700000000000n, name: "x" });
  assert.strictEqual(out.createdAt, "1700000000000");
  assert.strictEqual(out.name, "x");
});

test("serializeBigInt: handles nested + arrays", () => {
  const out = serializeBigInt({ list: [{ t: 5n }, { t: 6n }] });
  assert.strictEqual(out.list[0].t, "5");
  assert.strictEqual(out.list[1].t, "6");
});

test("serializeBigInt: leaves normal values intact", () => {
  const out = serializeBigInt({ a: 1, b: true, c: null });
  assert.deepStrictEqual(out, { a: 1, b: true, c: null });
});
