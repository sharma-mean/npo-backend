const prisma = require("../config/db");

/**
 * Append an immutable audit entry. Fire-and-forget: never throws into the
 * caller — a failed audit write must not break the business action.
 *
 * @param {object}  p
 * @param {object}  [p.authData]  req.user (id, role, organizationId)
 * @param {string}  p.action      CREATE | UPDATE | DELETE | STATUS_CHANGE | OVERRIDE
 * @param {string}  p.entity      e.g. "Booking", "Vehicle"
 * @param {string}  [p.entityId]
 * @param {object}  [p.before]    state before mutation
 * @param {object}  [p.after]     state after mutation
 * @param {object}  [p.metadata]  extra context (reason, overrideFlag, etc.)
 */
const serialize = (v) =>
  v == null
    ? v
    : JSON.parse(
        JSON.stringify(v, (_, val) =>
          typeof val === "bigint" ? val.toString() : val,
        ),
      );

const logAudit = async ({
  authData = {},
  action,
  entity,
  entityId = null,
  before = null,
  after = null,
  metadata = null,
}) => {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: authData.organizationId || null,
        actorId: authData.id || null,
        actorRole: authData.role || null,
        action,
        entity,
        entityId,
        before: serialize(before),
        after: serialize(after),
        metadata: serialize(metadata),
        createdAt: BigInt(Date.now()),
      },
    });
  } catch (err) {
    // Audit failure must never break the primary action.
    console.error("[auditLogger] failed to write audit log:", err.message);
  }
};

module.exports = { logAudit };
