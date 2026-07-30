/**
 * Canonicalize an email for storage + lookup: trim + lowercase.
 * Prevents case-variant duplicate accounts and login mismatches against a
 * case-sensitive unique constraint. Returns "" for nullish input.
 */
const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

module.exports = normalizeEmail;
