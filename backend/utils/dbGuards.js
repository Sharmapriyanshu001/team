import mongoose from "mongoose";

/**
 * Indexes that cap how many accounts of a role may exist.
 *
 * This database was found carrying one:
 *
 *   { key: { role: 1 }, unique: true,
 *     partialFilterExpression: { role: "hr" }, name: "one_hr_account" }
 *
 * — a unique index over a single role, which is a hard ceiling of exactly one
 * HR account enforced by MongoDB itself. No code in this repository created
 * it and none of it reads it; it arrived with an earlier build.
 *
 * It has to go, and it has to stay gone. A company with three HR people needs
 * three HR logins: one shared account is an audit trail that says "HR" and
 * never says who, and the failure it produces is a duplicate-key error on
 * creating the second one, which reads like a bug rather than a policy.
 *
 * Dropping an index destroys no data and can be undone in one command, which
 * is why this is safe to do on every boot rather than once by hand — a restore
 * from a backup taken before today would otherwise quietly bring the ceiling
 * back and nobody would know until the next hire.
 *
 * Narrow on purpose. It removes a unique index only when the index is over
 * `role` alone and filtered to one role — the exact shape of a per-role
 * ceiling. Every other index on the collection, including the unique one on
 * email that the app genuinely relies on, is left alone.
 */
const capsARole = (index) => {
  if (!index?.unique) return false;

  const keys = Object.keys(index.key || {});
  if (keys.length !== 1 || keys[0] !== "role") return false;

  const filter = index.partialFilterExpression || {};
  return Object.keys(filter).length === 1 && "role" in filter;
};

/**
 * Called once after the connection opens. Never throws — a panel that will not
 * start because it could not tidy an index is worse than one running with the
 * index still there, and the log line says which happened.
 */
export const dropRoleCapIndexes = async () => {
  try {
    const users = mongoose.connection.db.collection("users");
    const indexes = await users.indexes();

    const ceilings = indexes.filter(capsARole);
    if (!ceilings.length) return;

    for (const index of ceilings) {
      await users.dropIndex(index.name);
      console.log(
        `✅ Dropped "${index.name}" — a unique index that limited the panel to ` +
          `one ${index.partialFilterExpression.role} account`
      );
    }
  } catch (err) {
    console.error(
      "⚠️  Could not check for per-role account limits:",
      err?.message || err,
      "\n   If creating a second HR account fails with a duplicate-key error," +
        ' drop the unique index on users.role by hand: db.users.dropIndex("one_hr_account")'
    );
  }
};
