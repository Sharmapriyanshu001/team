/**
 * The rename, proved rather than assumed.
 *
 * A codemod that compiles is not a codemod that works. What matters here is
 * that an operations_manager account can still sign in, still reaches every
 * screen the role reached before, still sees the projects it was on — and that
 * the two things which were NOT renamed are genuinely untouched: the `manager`
 * role, and Sales.
 *
 * The migrated data is checked against the real collections rather than
 * against fixtures, because the risk this run exists to catch is a row the
 * migration missed.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import Message from "./models/Message.js";
import Project from "./models/Project.js";
import Role from "./models/Role.js";
import User, { LEADER_ROLES, USER_ROLES } from "./models/User.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || process.env.PORT || 5002;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};
const section = (name) => console.log(`\n▸ ${name}`);

const json = async (token, method, route, body) => {
  const res = await fetch(BASE + route, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};

const PASSWORD = "ops-rename-test-pass";
const OM_EMAIL = "rename.opsmanager@example.com";
const MGR_EMAIL = "rename.manager@example.com";
const EMAILS = [OM_EMAIL, MGR_EMAIL];

const cleanup = async () => {
  const users = await User.find({ email: { $in: EMAILS } }).select("_id");
  await Project.deleteMany({ name: "Rename Test Project" });
  await User.deleteMany({ _id: { $in: users.map((u) => u._id) } });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await cleanup();

  /* ------------------------------------------------- the role itself */

  section("The role");

  check("operations_manager is a real role", USER_ROLES.includes("operations_manager"));
  check("team_leader is gone from the role list", !USER_ROLES.includes("team_leader"));
  check("it reaches the delivery panel", LEADER_ROLES.includes("operations_manager"));
  check(
    "manager still reaches it too, untouched",
    LEADER_ROLES.includes("manager") && USER_ROLES.includes("manager")
  );

  /* --------------------------------------------- the migrated database */

  section("What the migration left behind");

  check("no account still holds the old role", (await User.countDocuments({ role: "team_leader" })) === 0);
  check(
    "the real accounts carry the new one",
    (await User.countDocuments({ role: "operations_manager" })) > 0,
    `${await User.countDocuments({ role: "operations_manager" })} accounts`
  );
  check(
    "no project still carries the old field",
    (await Project.collection.countDocuments({ teamLeader: { $exists: true } })) === 0
  );
  check(
    "the real projects carry the new one",
    (await Project.countDocuments({ operationsManager: { $ne: null } })) > 0,
    `${await Project.countDocuments({ operationsManager: { $ne: null } })} projects`
  );
  check("no chat thread kept the old scope", (await Message.countDocuments({ scope: "team_leader" })) === 0);
  check(
    "the migrated threads are readable under the new one",
    (await Message.countDocuments({ scope: "operations_manager" })) > 0,
    `${await Message.countDocuments({ scope: "operations_manager" })} messages`
  );

  const roles = await Role.find().lean();
  check("no Role kept the old key", !roles.some((r) => r.key === "team_leader"));
  check(
    "no Role kept the old permission module",
    !roles.some((r) => Object.prototype.hasOwnProperty.call(r.permissions || {}, "team_leaders"))
  );
  check(
    "the permission module moved rather than vanished",
    roles.some((r) => Object.prototype.hasOwnProperty.call(r.permissions || {}, "operations_managers"))
  );

  /* ------------------------------------------------------ signing in */

  section("Signing in and working");

  const om = await User.create({
    name: "Ops Manager Rename",
    email: OM_EMAIL,
    password: hashPassword(PASSWORD),
    role: "operations_manager",
    status: "active",
  });
  const mgr = await User.create({
    name: "Dept Manager Rename",
    email: MGR_EMAIL,
    password: hashPassword(PASSWORD),
    role: "manager",
    status: "active",
  });

  const omToken = (await json(null, "POST", "/leader/login", { email: OM_EMAIL, password: PASSWORD }))
    .data?.token;
  check("an operations manager can sign in", Boolean(omToken));

  const mgrToken = (
    await json(null, "POST", "/leader/login", { email: MGR_EMAIL, password: PASSWORD })
  ).data?.token;
  check("so can a department manager, as before", Boolean(mgrToken));

  const viaNewPath = await json(null, "POST", "/operations-manager/login", {
    email: OM_EMAIL,
    password: PASSWORD,
  });
  check("the API answers on /api/operations-manager too", Boolean(viaNewPath.data?.token));

  const dash = await json(omToken, "GET", "/leader/dashboard");
  check("the dashboard loads", dash.status === 200, dash.data?.message);

  const me = await json(omToken, "GET", "/leader/me");
  check("the session reports the new role", me.data?.leader?.role === "operations_manager", me.data?.leader?.role);

  /* ------------------------------- every screen the role had, still there */

  section("The panel's screens");

  for (const route of [
    "/leader/projects",
    "/leader/tasks",
    "/leader/team",
    "/leader/review",
    "/leader/change-requests",
    "/leader/bonuses",
    "/leader/notifications",
  ]) {
    const r = await json(omToken, "GET", route);
    check(`${route} answers`, r.status === 200, r.status === 200 ? "" : `${r.status} ${r.data?.message || ""}`);
  }

  /* -------------------------------------------- the project still works */

  section("Projects still find their manager");

  const project = await Project.create({
    name: "Rename Test Project",
    operationsManager: om._id,
    members: [om._id],
    status: "in_progress",
  });

  const mine = await json(omToken, "GET", "/leader/projects");
  const list = mine.data?.items || mine.data || [];
  check(
    "a project assigned through the new field reaches its manager",
    Array.isArray(list) && list.some((p) => String(p._id) === String(project._id))
  );

  /* ----------------------------------------------- Sales is untouched */

  section("Sales, which was not part of this");

  const salesUsers = await User.countDocuments({ role: { $in: ["sales", "sales_exec"] } });
  check("sales roles are unchanged", salesUsers > 0, `${salesUsers} sales accounts`);
  check("sales_exec still exists as a role", USER_ROLES.includes("sales_exec"));
  check("sales still exists as a role", USER_ROLES.includes("sales"));

  const noCross = await json(omToken, "GET", "/sales/leads");
  check("an operations manager still cannot reach Sales", noCross.status === 403 || noCross.status === 401);

  await cleanup();
  await mongoose.disconnect();

  console.log(`\n${"─".repeat(58)}\n  ${pass} passed, ${fail} failed\n${"─".repeat(58)}`);
  process.exit(fail ? 1 : 0);
};

main().catch(async (err) => {
  console.error("test run failed:", err);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
