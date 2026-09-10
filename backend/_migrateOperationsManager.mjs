/**
 * Team Leader → Operations Manager, in the database.
 *
 * The code rename is mechanical; this is not. Six places store the old value
 * as data rather than as source, and a rename that moves the code without
 * moving these leaves rows the new code cannot see:
 *
 *   users.role              "team_leader"  → "operations_manager"
 *   projects.teamLeader     field          → operationsManager
 *   teams.teamLeaders       field          → operationsManagers
 *   messages.scope          "team_leader"  → "operations_manager"
 *   roles.key + the "team_leaders" permission module
 *   the historical *ByRole snapshots scattered across the other collections
 *
 * IDEMPOTENT. Every step is a filtered update that matches only the old shape,
 * so running it twice changes nothing the second time — which matters, because
 * the honest way to run a migration against live data is to run it, check, and
 * be able to run it again.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *
 * `manager` accounts. That role is staying exactly as it was; it shares the
 * panel and is a department head rather than a project's owner.
 *
 * `reportsTo`. It is a reference to a user, not a role string, so there is
 * nothing in it to rename.
 *
 *   node _migrateOperationsManager.mjs          # apply
 *   node _migrateOperationsManager.mjs --dry    # report only, change nothing
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const DRY = process.argv.includes("--dry");

const OLD_ROLE = "team_leader";
const NEW_ROLE = "operations_manager";

/**
 * Every collection that snapshots who did something, and the field it uses.
 *
 * These are historical strings — "this was done by a team_leader" — rather
 * than live references. Migrating them is what keeps an old audit row reading
 * correctly beside a new one; leaving them would put two names for one role in
 * the same timeline.
 */
const SNAPSHOT_FIELDS = [
  ["projects", "assignedByRole"],
  ["projects", "memberAssignments.$[].assignedByRole"],
  ["projectrequests", "requestedByRole"],
  ["changerequests", "updates.$[].authorRole"],
  ["codeprojects", "assignedByRole"],
  ["codeprojects", "deletedByRole"],
  ["codepackages", "sentByRole"],
  ["codesubmissions", "reviewedByRole"],
  ["adaccounts", "assignedByRole"],
  ["developerconsoles", "assignedByRole"],
  ["credentials", "userRole"],
  ["filedocs", "assignedRole"],
  ["candidates", "role"],
  ["candidates", "targetRole"],
  ["candidates", "hireAs"],
];

const steps = [];
const record = (what, n) => {
  steps.push({ what, n });
  console.log(`  ${String(n).padStart(4)}  ${what}`);
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  console.log(DRY ? "\nDRY RUN — nothing will be written\n" : "\nMigrating\n");

  const apply = async (coll, filter, update, options = {}) => {
    const n = await db.collection(coll).countDocuments(filter);
    if (!DRY && n) await db.collection(coll).updateMany(filter, update, options);
    return n;
  };

  /* ---------------------------------------------------------- the role */

  /**
   * The role is baked into every signed token, so a session minted before this
   * runs would carry the old one. tokenVersion is what every panel's auth
   * middleware compares against, so bumping it ends those sessions now rather
   * than leaving somebody signed in as a role that no longer exists.
   */
  record(
    "users: role → operations_manager (all sessions ended)",
    await apply(
      "users",
      { role: OLD_ROLE },
      { $set: { role: NEW_ROLE }, $inc: { tokenVersion: 1 } }
    )
  );

  /* -------------------------------------------------------- the fields */

  record(
    "projects: teamLeader → operationsManager",
    await apply(
      "projects",
      { teamLeader: { $exists: true } },
      { $rename: { teamLeader: "operationsManager" } }
    )
  );

  record(
    "teams: teamLeaders → operationsManagers",
    await apply(
      "teams",
      { teamLeaders: { $exists: true } },
      { $rename: { teamLeaders: "operationsManagers" } }
    )
  );

  /* --------------------------------------------------------- the chat */

  /**
   * A chat scope, not a role — but it is named after one, and the panel builds
   * the room key from the same string. Left behind, seventeen conversations
   * would simply stop appearing in the thread they belong to.
   */
  record(
    "messages: scope team_leader → operations_manager",
    await apply("messages", { scope: OLD_ROLE }, { $set: { scope: NEW_ROLE } })
  );

  /* ------------------------------------------------------ permissions */

  record(
    "roles: key team_leader → operations_manager",
    await apply("roles", { key: OLD_ROLE }, { $set: { key: NEW_ROLE } })
  );

  record(
    "roles: name Team Leader → Operations Manager",
    await apply("roles", { name: "Team Leader" }, { $set: { name: "Operations Manager" } })
  );

  /**
   * The permission module is a KEY inside each Role's permissions object, so
   * this is a rename of a field path rather than of a value. A Role that kept
   * the old key would grant nothing on the new screen, and the account holding
   * it would quietly lose a section of the panel.
   */
  record(
    "roles: permissions.team_leaders → permissions.operations_managers",
    await apply(
      "roles",
      { "permissions.team_leaders": { $exists: true } },
      { $rename: { "permissions.team_leaders": "permissions.operations_managers" } }
    )
  );

  /* -------------------------------------------------- the audit trail */

  let snapshots = 0;
  for (const [coll, field] of SNAPSHOT_FIELDS) {
    const exists = await db.listCollections({ name: coll }).hasNext();
    if (!exists) continue;

    /**
     * An array path has to name the elements it means.
     *
     * `$[]` is *every* element, and the document filter only says the array
     * holds at least one old value — so `$[]` would rewrite the entries that
     * said "admin" or "manager" too, silently reassigning who did what. With
     * an arrayFilter, `$[elem]` touches only the entries that actually carry
     * the old role.
     */
    const isArray = field.includes("$[]");
    const plain = field.replace(".$[]", "");
    const leaf = field.split(".$[].")[1];
    const target = isArray ? field.replace("$[]", "$[elem]") : field;
    const options = isArray ? { arrayFilters: [{ [`elem.${leaf}`]: OLD_ROLE }] } : {};

    const n = await db.collection(coll).countDocuments({ [plain]: OLD_ROLE });
    if (!n) continue;

    if (!DRY) {
      await db
        .collection(coll)
        .updateMany({ [plain]: OLD_ROLE }, { $set: { [target]: NEW_ROLE } }, options);
    }
    snapshots += n;
    console.log(`        ${coll}.${plain} × ${n}`);
  }
  record("historical role snapshots rewritten", snapshots);

  /* ------------------------------------------------------ what is left */

  console.log("\nAfter:");
  const left = await db.collection("users").countDocuments({ role: OLD_ROLE });
  const now = await db.collection("users").countDocuments({ role: NEW_ROLE });
  const managers = await db.collection("users").countDocuments({ role: "manager" });
  const projects = await db
    .collection("projects")
    .countDocuments({ operationsManager: { $ne: null } });
  const stale = await db.collection("projects").countDocuments({ teamLeader: { $exists: true } });

  console.log(`  operations_manager accounts : ${now}`);
  console.log(`  manager accounts (untouched): ${managers}`);
  console.log(`  projects with an ops manager: ${projects}`);
  console.log(`  old role left over          : ${left}`);
  console.log(`  old project field left over : ${stale}`);

  const total = steps.reduce((s, x) => s + x.n, 0);
  console.log(`\n${DRY ? "would change" : "changed"} ${total} document${total === 1 ? "" : "s"}`);

  if (!DRY && (left || stale)) {
    console.error("\n⚠️  Something did not migrate. Investigate before using the panel.");
    process.exitCode = 1;
  }

  await mongoose.disconnect();
};

main().catch(async (err) => {
  console.error("migration failed:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
