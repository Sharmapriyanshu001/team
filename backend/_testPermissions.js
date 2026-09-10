// Phase 7: turning the dormant Role system on without locking anybody out.
// The first section is the one that matters most — the existing admin account
// must behave exactly as it did before any of this existed.
import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "./models/User.js";
import Role from "./models/Role.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

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

const login = async (email, password) => {
  const r = await json(null, "POST", "/admin/login", { email, password });
  return { status: r.status, token: r.data?.token, message: r.data?.message };
};

/* --------------------------------------------------------------------- run */

const LIMITED_EMAIL = "phase7.limited@example.com";
const SUPER_EMAIL = "phase7.super@example.com";
const PASSWORD = "phase7-test-pass";

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Clean up anything a previous run left behind
  await User.deleteMany({ email: { $in: [LIMITED_EMAIL, SUPER_EMAIL] } });
  await Role.deleteMany({ key: { $in: ["phase7_viewer", "phase7_unused"] } });

  const existingAdmin = await User.findOne({ email: process.env.ADMIN_EMAIL });
  const originalRole = existingAdmin?.role;

  /* ---------------------------------------- the existing admin must be fine */

  console.log("=== the account that already existed, untouched ===");
  const incumbent = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  check("still signs in", incumbent.status === 200, incumbent.message);
  const A = incumbent.token;

  const everything = [
    "/admin/dashboard",
    "/admin/clients",
    "/admin/operations-managers",
    "/admin/employees",
    "/admin/projects",
    "/admin/tasks",
    "/admin/issues",
    "/admin/files",
    "/admin/code",
    "/admin/code-projects",
    "/admin/reports",
    "/admin/activity-logs",
    "/admin/roles",
    "/admin/settings",
    "/admin/lookups",
  ];
  const codes = [];
  for (const route of everything) codes.push((await json(A, "GET", route)).status);
  check(
    "reaches every module exactly as before",
    codes.every((c) => c === 200),
    everything.map((r, i) => `${r.split("/").pop()}=${codes[i]}`).join(" ")
  );

  const me = await json(A, "GET", "/admin/me");
  check("/me reports unrestricted", me.data?.permissions?.unrestricted === true);

  /* ------------------------------------------------------- a limited admin */

  console.log("\n=== an admin given a narrow role ===");
  const viewer = await Role.create({
    name: "Phase7 Viewer",
    key: "phase7_viewer",
    description: "Can look at projects and tasks, change nothing",
    permissions: new Map([
      ["dashboard", ["view"]],
      ["projects", ["view"]],
      ["tasks", ["view", "create"]],
    ]),
  });

  const limited = await User.create({
    name: "Phase7 Limited",
    email: LIMITED_EMAIL,
    password: hashPassword(PASSWORD),
    role: "admin",
    permissionRole: viewer._id,
  });

  const limitedLogin = await login(LIMITED_EMAIL, PASSWORD);
  check("limited admin signs in", limitedLogin.status === 200, limitedLogin.message);
  const LIM = limitedLogin.token;

  const limitedMe = await json(LIM, "GET", "/admin/me");
  check("/me reports the role", limitedMe.data?.permissions?.roleName === "Phase7 Viewer");
  check("/me reports restricted", limitedMe.data?.permissions?.unrestricted === false);

  check("can view projects", (await json(LIM, "GET", "/admin/projects")).status === 200);
  check("can view tasks", (await json(LIM, "GET", "/admin/tasks")).status === 200);
  check("can view the dashboard", (await json(LIM, "GET", "/admin/dashboard")).status === 200);

  const denied = [
    ["GET", "/admin/clients", "clients"],
    ["GET", "/admin/employees", "employees"],
    ["GET", "/admin/operations-managers", "operations managers"],
    ["GET", "/admin/code-projects", "code projects"],
    ["GET", "/admin/files", "files"],
    ["GET", "/admin/reports", "reports"],
    ["GET", "/admin/roles", "roles"],
    ["GET", "/admin/settings", "settings"],
    ["GET", "/admin/activity-logs", "activity logs"],
  ];
  for (const [method, route, label] of denied) {
    const r = await json(LIM, method, route);
    check(`cannot view ${label}`, r.status === 403, `${r.status} ${r.data?.message || ""}`);
  }

  console.log("\n=== the verb decides the action ===");
  const createProject = await json(LIM, "POST", "/admin/projects", { name: "Should be refused" });
  check("view-only on projects blocks create", createProject.status === 403, createProject.data?.message);
  const editProject = await json(LIM, "PUT", "/admin/projects/000000000000000000000000", { name: "x" });
  check("view-only on projects blocks edit", editProject.status === 403, `${editProject.status}`);
  const deleteProject = await json(LIM, "DELETE", "/admin/projects/000000000000000000000000");
  check("view-only on projects blocks delete", deleteProject.status === 403, `${deleteProject.status}`);

  const createTask = await json(LIM, "POST", "/admin/tasks", { title: "Phase7 allowed task" });
  check("create granted on tasks is allowed", createTask.status === 201, `${createTask.status} ${createTask.data?.message || ""}`);
  if (createTask.status === 201) {
    await json(A, "DELETE", `/admin/tasks/${createTask.data.item._id}`);
  }
  const deleteTask = await json(LIM, "DELETE", "/admin/tasks/000000000000000000000000");
  check("delete not granted on tasks is refused", deleteTask.status === 403, `${deleteTask.status}`);

  console.log("\n=== ungated helpers stay reachable ===");
  check("lookups still works", (await json(LIM, "GET", "/admin/lookups")).status === 200);
  check("own profile still works", (await json(LIM, "GET", "/admin/me")).status === 200);

  console.log("\n=== a limited admin cannot reach the administrators screen ===");
  const limAdmins = await json(LIM, "GET", "/admin/administrators");
  check("listing refused", limAdmins.status === 403, limAdmins.data?.message);
  const limPromote = await json(LIM, "PUT", `/admin/administrators/${limited._id}`, {
    isSuperAdmin: true,
  });
  check("self-promotion refused", limPromote.status === 403, limPromote.data?.message);
  const stillPlain = await User.findById(limited._id).select("role");
  check("and the role really did not change", stillPlain.role === "admin", stillPlain.role);

  /* ----------------------------------------------------------- super admin */

  console.log("\n=== super admin ===");
  const superUser = await User.create({
    name: "Phase7 Super",
    email: SUPER_EMAIL,
    password: hashPassword(PASSWORD),
    role: "super_admin",
    // Deliberately given the narrow role too — it must be ignored
    permissionRole: viewer._id,
  });

  const superLogin = await login(SUPER_EMAIL, PASSWORD);
  check("super admin signs in through the admin door", superLogin.status === 200, superLogin.message);
  const SUP = superLogin.token;

  const superMe = await json(SUP, "GET", "/admin/me");
  check("/me flags super admin", superMe.data?.permissions?.isSuperAdmin === true);
  check("/me reports unrestricted", superMe.data?.permissions?.unrestricted === true);

  const superCodes = [];
  for (const route of everything) superCodes.push((await json(SUP, "GET", route)).status);
  check(
    "a narrow role does not limit a super admin",
    superCodes.every((c) => c === 200),
    everything.map((r, i) => `${r.split("/").pop()}=${superCodes[i]}`).join(" ")
  );

  /**
   * Passing the route guards is only half of it. Plenty of code asks
   * "user.role === admin" directly — code project access, chat rooms, the
   * lookup of who to notify. A super admin has to answer yes to all of those
   * too, or the role would quietly cost them access rather than grant it.
   */
  console.log("\n=== a super admin counts as an admin outside the route guards too ===");

  const cpList = await json(SUP, "GET", "/admin/code-projects");
  check("can list code projects", cpList.status === 200, cpList.data?.message);

  const anyProject = (cpList.data?.items || [])[0];
  if (anyProject) {
    const detail = await json(SUP, "GET", `/admin/code-projects/${anyProject._id}`);
    check("can open a project they were never assigned to", detail.status === 200, `${detail.status}`);
    const versions = await json(SUP, "GET", `/admin/code-projects/${anyProject._id}/versions`);
    check("and is offered rollback", versions.data?.canRestore === true, String(versions.data?.canRestore));
  } else {
    console.log("  (no code project on record to open)");
  }

  const csPeople = await json(SUP, "GET", "/admin/code-share/people");
  check("can list who to send code to", csPeople.status === 200);

  const leaderSees = await json(null, "POST", "/leader/login", {
    email: "kamal@gmail.com",
    password: "7896897896",
  });
  if (leaderSees.status === 200) {
    const people = await json(leaderSees.data.token, "GET", "/leader/code-share/people");
    check(
      "a super admin is offered as a recipient to others",
      (people.data?.people || []).some((p) => p.role === "super_admin"),
      (people.data?.people || []).map((p) => p.role).join(",")
    );
  }

  const superAdmins = await json(SUP, "GET", "/admin/administrators");
  check("can list administrators", superAdmins.status === 200);
  check(
    "the list includes everyone",
    (superAdmins.data?.administrators || []).length >= 3,
    String(superAdmins.data?.administrators?.length)
  );

  console.log("\n=== granting and narrowing from that screen ===");
  const clearRole = await json(SUP, "PUT", `/admin/administrators/${limited._id}`, {
    permissionRole: "",
  });
  check("clearing a role is accepted", clearRole.status === 200, clearRole.data?.message);

  const freed = await login(LIMITED_EMAIL, PASSWORD);
  check("that admin now reaches clients", (await json(freed.token, "GET", "/admin/clients")).status === 200);

  const reapply = await json(SUP, "PUT", `/admin/administrators/${limited._id}`, {
    permissionRole: String(viewer._id),
  });
  check("re-applying the role is accepted", reapply.status === 200, reapply.data?.message);
  const narrowed = await login(LIMITED_EMAIL, PASSWORD);
  check("and clients is refused again", (await json(narrowed.token, "GET", "/admin/clients")).status === 403);

  /* ------------------------------------------------------- lockout guards */

  console.log("\n=== you cannot strand the system without a super admin ===");
  const selfDemote = await json(SUP, "PUT", `/admin/administrators/${superUser._id}`, {
    isSuperAdmin: false,
  });
  check("cannot demote yourself", selfDemote.status === 400, selfDemote.data?.message);

  // With the seeded admin still a plain admin, this super is the only one
  const superCount = await User.countDocuments({ role: "super_admin", status: "active" });
  if (superCount === 1) {
    const promoted = await json(SUP, "PUT", `/admin/administrators/${limited._id}`, {
      isSuperAdmin: true,
    });
    check("promoting a second super admin works", promoted.status === 200, promoted.data?.message);

    const nowDemote = await json(SUP, "PUT", `/admin/administrators/${limited._id}`, {
      isSuperAdmin: false,
    });
    check("demoting somebody else now works", nowDemote.status === 200, nowDemote.data?.message);
  } else {
    console.log(`  (skipped last-super-admin check — ${superCount} already exist)`);
  }

  console.log("\n=== a role in use cannot be deleted ===");
  const delInUse = await json(SUP, "DELETE", `/admin/roles/${viewer._id}`);
  check("delete refused while assigned", delInUse.status === 400, delInUse.data?.message);
  check("the role is still there", Boolean(await Role.findById(viewer._id)));

  const unused = await Role.create({ name: "Phase7 Unused", key: "phase7_unused" });
  const delUnused = await json(SUP, "DELETE", `/admin/roles/${unused._id}`);
  check("an unassigned role deletes fine", delUnused.status === 200, delUnused.data?.message);

  console.log("\n=== a dangling role fails closed, not open ===");
  await User.updateOne(
    { _id: limited._id },
    { $set: { permissionRole: new mongoose.Types.ObjectId() } }
  );
  const dangling = await login(LIMITED_EMAIL, PASSWORD);
  const danglingRead = await json(dangling.token, "GET", "/admin/projects");
  check("refused rather than promoted", danglingRead.status === 403, danglingRead.data?.message);
  check(
    "with a message that says how to fix it",
    /no longer exists/i.test(danglingRead.data?.message || ""),
    danglingRead.data?.message
  );

  console.log("\n=== inactive admins cannot sign in ===");
  await User.updateOne({ _id: limited._id }, { $set: { status: "inactive" } });
  const inactive = await login(LIMITED_EMAIL, PASSWORD);
  check("inactive account refused", inactive.status === 403, inactive.message);

  /* ----------------------------------------------- other panels unaffected */

  console.log("\n=== nothing changed for the other panels ===");
  const leader = await json(null, "POST", "/leader/login", {
    email: "kamal@gmail.com",
    password: "7896897896",
  });
  check("operations manager still signs in", leader.status === 200, leader.data?.message);
  check(
    "and their routes are ungated by any of this",
    (await json(leader.data.token, "GET", "/leader/code-projects")).status === 200
  );
  const leaderOnAdmin = await json(leader.data.token, "GET", "/admin/projects");
  check("a leader token still cannot reach admin routes", leaderOnAdmin.status === 403);

  /* ------------------------------------------------------------- cleanup */

  console.log("\n=== cleanup ===");
  await User.deleteMany({ email: { $in: [LIMITED_EMAIL, SUPER_EMAIL] } });
  await Role.deleteMany({ key: { $in: ["phase7_viewer", "phase7_unused"] } });

  const restored = await User.findOne({ email: process.env.ADMIN_EMAIL }).select("role");
  check(
    "the real admin account was left exactly as found",
    restored?.role === originalRole,
    `${originalRole} -> ${restored?.role}`
  );

  await mongoose.disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch(async (err) => {
  console.error("harness error:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
