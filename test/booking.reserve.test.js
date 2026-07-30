const test = require("node:test");
const assert = require("node:assert");
/**
 * Integration test for the atomic slot-reservation guard used by booking
 * creation/promotion. Hits the real DB but never mutates: all work runs inside
 * a transaction that is rolled back. Skips cleanly when no DB is reachable
 * (e.g. CI without DATABASE_URL) so the unit suite stays green offline.
 */

const SAME_SQL_AS_SERVICE = async (tx, slotId, seats, now) => {
  // Mirror of reserveSlotSeats() in booking.service.js — kept in sync so the
  // test validates the exact table/column identifiers + guard semantics.
  const affected = await tx.$executeRaw`
    UPDATE "ServiceSlot"
    SET "bookedCount" = "bookedCount" + ${seats}, "updatedAt" = ${now}
    WHERE id = ${slotId} AND "bookedCount" + ${seats} <= "capacity"
  `;
  return affected > 0;
};

test("reserveSlotSeats: fills to capacity then refuses overbook", async (t) => {
  let prisma;
  try {
    prisma = require("../src/config/db");
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    t.skip("no database reachable");
    return;
  }

  const slot = await prisma.serviceSlot.findFirst({
    select: { id: true, capacity: true, bookedCount: true },
  });
  if (!slot) {
    t.skip("no ServiceSlot rows to exercise");
    return;
  }

  const free = slot.capacity - slot.bookedCount;
  const now = BigInt(Date.now());

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const fit = await SAME_SQL_AS_SERVICE(tx, slot.id, Math.max(free, 0), now);
      const overflow = await SAME_SQL_AS_SERVICE(tx, slot.id, 1, now);

      // Reserving exactly the free seats succeeds (unless already full → free 0).
      assert.strictEqual(fit, free > 0);
      // One more seat past capacity must be refused — the overbook guard.
      assert.strictEqual(overflow, false);

      throw new Error("__ROLLBACK__"); // never persist
    }),
    /__ROLLBACK__/,
  );
});
