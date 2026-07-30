/**
 * Time-overlap helpers — shared across booking, assignment, availability.
 *
 * Two windows [aStart, aEnd) and [bStart, bEnd) overlap when:
 *   aStart < bEnd  AND  aEnd > bStart
 *
 * All times are BigInt Unix ms (or coercible to BigInt).
 */

const toBig = (v) => (typeof v === "bigint" ? v : BigInt(v));

const overlaps = (aStart, aEnd, bStart, bEnd) => {
  return toBig(aStart) < toBig(bEnd) && toBig(aEnd) > toBig(bStart);
};

/**
 * Prisma `where` fragment that matches rows whose [startTime, endTime)
 * window overlaps the given window. Spread into a findFirst/findMany where.
 */
const overlapWhere = (startTime, endTime) => ({
  startTime: { lt: toBig(endTime) },
  endTime: { gt: toBig(startTime) },
});

module.exports = { overlaps, overlapWhere, toBig };
