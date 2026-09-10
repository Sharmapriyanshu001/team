// Department task assignment.
//
// A task used to need a project. That is right for delivery work and wrong
// for everything else a department does: hiring somebody, chasing a payment,
// writing a proposal. `Task.team` existed for exactly this and nothing wrote
// it, so a Sales manager had nowhere to put any of their department's actual
// work — and the department performance figures, which count tasks per team,
// were reading a field that was always empty.
//
// What is proved here:
//
//   a manager can file work against a department they run, with no project
//   they cannot file it against a department somebody else runs
//   they can hand it to their own people, whatever role those people have
//   they cannot hand it upwards to an administrator
//   the person is told, on the panel they actually sign in to
//   a plain operations manager who runs no department is offered none of this
//   the same job twice is still refused, on a department as on a project
//   searching does not widen what a leader can see
//
// Records are seeded straight into Mongo; the admin API would demand a full
// onboarding pack, which is a rule about the joining form and not about this.
//
// Run against a server started on PORT_UNDER_TEST (default 5099).
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Team from "./models/Team.js";
import Task from "./models/Task.js";
import Notification from "./models/Notification.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const BASE = `http://localhost:${PORT}/api`;

let pass = 0;
let fail = 0;
const failures = [];

const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (ok) pass += 1;
  else {
    fail += 1;
    failures.push(`${label}${detail ? " — " + detail : ""}`);
  }
};

const call = async (token, method, route, body) => {
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
  } catch {
    data = null;
  }
  return { status: res.status, data };
};

const TAG = `dt_${Date.now()}`;
const madeUsers = [];
const madeTeams = [];

const seed = async (role, name, extra = {}) => {
  const password = "9700000000";
  const person = await User.create({
    name: `${name} ${TAG}`,
    email: `${name.toLowerCase()}.${TAG}@example.com`,
    password: hashPassword(password),
    role,
    phone: password,
    status: "active",
    ...extra,
  });
  madeUsers.push(person._id);
  return { ...person.toObject(), plainPassword: password };
};

const seedTeam = async (attrs) => {
  const team = await Team.create({ ...attrs, name: `${attrs.name} ${TAG}` });
  madeTeams.push(team._id);
  return team;
};

const cleanup = async () => {
  await Task.deleteMany({
    $or: [{ team: { $in: madeTeams } }, { assignedTo: { $in: madeUsers } }],
  });
  await Team.deleteMany({ _id: { $in: madeTeams } });
  await User.deleteMany({ _id: { $in: madeUsers } });
  await User.deleteMany({ email: new RegExp(TAG) });
  await Notification.deleteMany({ user: { $in: madeUsers } });
};

/**
 * Notifications are sent without being waited on — deliberately, so a failure
 * to notify never fails the thing that was actually asked for. That makes the
 * write land a moment after the response, so the test looks again rather than
 * once.
 */
const waitFor = async (read, tries = 20) => {
  for (let i = 0; i < tries; i += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
};

const signIn = async (person) =>
  (
    await call(null, "POST", "/leader/login", {
      email: person.email,
      password: person.plainPassword,
    })
  ).data?.token;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("\n▸ Two departments, two managers");

  // Sales: a manager and a sales executive. The executive matters — they are
  // not an `employee`, which is exactly what the old assignment rule demanded.
  const salesManager = await seed("manager", "SalesMgr");
  const salesExec = await seed("sales_exec", "SalesExec");
  const salesEmp = await seed("employee", "SalesEmp");

  // Operations, run by somebody with the plain operations_manager role. They are a
  // department manager in every sense the reporting chain cares about, and
  // the old scope read only the role.
  const opsLead = await seed("operations_manager", "OpsLead");
  const opsEmp = await seed("employee", "OpsEmp");

  // And a leader who runs no department at all
  const soloLead = await seed("operations_manager", "SoloLead");

  const admin = await seed("admin", "TheAdmin");

  const sales = await seedTeam({
    name: "Sales",
    kind: "sales",
    manager: salesManager._id,
    members: [salesExec._id, salesEmp._id],
  });

  const ops = await seedTeam({
    name: "Operations",
    kind: "operations",
    manager: opsLead._id,
    members: [opsEmp._id],
  });

  const mgrToken = await signIn(salesManager);
  const opsToken = await signIn(opsLead);
  const soloToken = await signIn(soloLead);

  check("the Sales manager can sign in", Boolean(mgrToken));
  check("the Operations lead can sign in", Boolean(opsToken));
  check("the leader with no department can sign in", Boolean(soloToken));

  /* -------------------------------------------------------------- lookups */

  console.log("\n▸ What each of them is offered");

  const mgrLookups = (await call(mgrToken, "GET", "/leader/lookups")).data;
  const opsLookups = (await call(opsToken, "GET", "/leader/lookups")).data;
  const soloLookups = (await call(soloToken, "GET", "/leader/lookups")).data;

  check(
    "the Sales manager is offered their department",
    mgrLookups?.departments?.some((d) => String(d._id) === String(sales._id)),
    JSON.stringify(mgrLookups?.departments?.map((d) => d.name))
  );
  check(
    "and not somebody else's",
    !mgrLookups?.departments?.some((d) => String(d._id) === String(ops._id))
  );
  check(
    "an operations manager who manages a team is offered it too — the role is not the test",
    opsLookups?.departments?.some((d) => String(d._id) === String(ops._id))
  );
  check(
    "a leader who runs no department is offered none",
    (soloLookups?.departments || []).length === 0
  );
  check(
    "the sales executive appears in the manager's people",
    mgrLookups?.team?.some((p) => String(p._id) === String(salesExec._id))
  );
  check(
    "and each person's role travels, so a screen need not assume everyone is an employee",
    (mgrLookups?.team || []).length > 0 && mgrLookups.team.every((p) => "role" in p)
  );

  /* ------------------------------------------------------- filing the work */

  console.log("\n▸ Work that belongs to a department, not a project");

  const noTarget = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Nothing to hang it on ${TAG}`,
  });
  check("a task with neither a project nor a department is refused", noTarget.status === 400);
  check(
    "and the refusal mentions the department, for somebody who runs one",
    /department/i.test(noTarget.data?.message || ""),
    noTarget.data?.message
  );

  const soloNoTarget = await call(soloToken, "POST", "/leader/tasks", {
    title: `Nothing to hang it on ${TAG}`,
  });
  check(
    "while a leader who runs no department is still just asked for a project",
    soloNoTarget.status === 400 && !/department/i.test(soloNoTarget.data?.message || ""),
    soloNoTarget.data?.message
  );

  const created = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Chase the September invoices ${TAG}`,
    team: String(sales._id),
    assignedTo: String(salesExec._id),
    priority: "high",
  });
  check(
    "a manager can file work against their department",
    created.status === 201,
    created.data?.message
  );
  check(
    "and it comes back with no project and the department named",
    !created.data?.item?.project && String(created.data?.item?.team?.name || "").includes("Sales"),
    JSON.stringify(created.data?.item?.team)
  );

  const deptTaskId = created.data?.item?._id;

  check(
    "the sales executive got it, though they are not an employee",
    String(created.data?.item?.assignedTo?._id) === String(salesExec._id)
  );

  /* ----------------------------------------------------------- who is told */

  const note = await waitFor(() =>
    Notification.findOne({ user: salesExec._id, type: "task" }).sort({ createdAt: -1 })
  );
  check("they were notified", Boolean(note));
  check(
    "and pointed at their own panel, not the employee one they cannot sign in to",
    String(note?.link || "").startsWith("/sales"),
    note?.link
  );

  const empTask = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Write the Q4 proposal ${TAG}`,
    team: String(sales._id),
    assignedTo: String(salesEmp._id),
  });
  check("an employee on the department can be given department work too", empTask.status === 201);
  const empNote = await waitFor(() =>
    Notification.findOne({ user: salesEmp._id, type: "task" }).sort({ createdAt: -1 })
  );
  check(
    "and they are pointed at the employee panel",
    empNote?.link === "/employee/tasks/pending",
    empNote?.link
  );

  /* ------------------------------------------------------- what is refused */

  console.log("\n▸ What it refuses");

  const wrongDept = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Reaching into Operations ${TAG}`,
    team: String(ops._id),
    assignedTo: String(opsEmp._id),
  });
  check(
    "a manager cannot file work against a department they do not run",
    wrongDept.status === 400 && /not one of yours/i.test(wrongDept.data?.message || ""),
    wrongDept.data?.message
  );

  const upwards = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Telling the admin what to do ${TAG}`,
    team: String(sales._id),
    assignedTo: String(admin._id),
  });
  check(
    "and cannot hand work upwards to an administrator",
    upwards.status === 400 && /upwards/i.test(upwards.data?.message || ""),
    upwards.data?.message
  );

  const outsider = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Somebody else entirely ${TAG}`,
    team: String(sales._id),
    assignedTo: String(opsEmp._id),
  });
  check(
    "an employee off the department is still allowed — work does not follow the org chart",
    outsider.status === 201,
    outsider.data?.message
  );

  const outsiderLead = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Another department's leader ${TAG}`,
    team: String(sales._id),
    assignedTo: String(opsLead._id),
  });
  check(
    "but a leader who is neither an employee nor on the department is not",
    outsiderLead.status === 400,
    outsiderLead.data?.message
  );

  const duplicate = await call(mgrToken, "POST", "/leader/tasks", {
    title: `Chase the September invoices ${TAG}`,
    team: String(sales._id),
    assignedTo: String(salesExec._id),
  });
  check(
    "the same job twice on the same department is refused",
    duplicate.status === 409,
    duplicate.data?.message
  );
  check(
    "and the refusal names the department rather than saying 'this project'",
    /Sales/.test(duplicate.data?.message || "") &&
      !/this project/.test(duplicate.data?.message || ""),
    duplicate.data?.message
  );

  /* -------------------------------------------------------------- reading */

  console.log("\n▸ Reading it back");

  const mine = await call(mgrToken, "GET", "/leader/tasks?limit=200");
  const ids = (mine.data?.items || []).map((t) => String(t._id));
  check("the department's work is in the manager's list", ids.includes(String(deptTaskId)));

  const deptOnly = await call(mgrToken, "GET", "/leader/tasks?view=department&limit=200");
  check(
    "and can be asked for on its own",
    (deptOnly.data?.items || []).length > 0 &&
      deptOnly.data.items.every((t) => !t.project && t.team),
    `${deptOnly.data?.items?.length} rows`
  );

  const opsSees = await call(opsToken, "GET", "/leader/tasks?limit=200");
  check(
    "the Operations lead does not see Sales' department work",
    !(opsSees.data?.items || []).some((t) => String(t._id) === String(deptTaskId))
  );

  const wrongFilter = await call(opsToken, "GET", `/leader/tasks?team=${sales._id}`);
  check(
    "and filtering by somebody else's department is refused outright",
    wrongFilter.status === 403,
    wrongFilter.data?.message
  );

  /**
   * The search clause used to assign query.$or, which replaced the scope
   * clause already sitting on it — so a search returned every matching task in
   * the company. Department scope now rides on the same $or, so this is the
   * test that keeps it honest.
   */
  const leak = await call(soloToken, "GET", `/leader/tasks?search=${encodeURIComponent(TAG)}`);
  check(
    "searching does not widen what a leader can see",
    (leak.data?.items || []).length === 0,
    `${leak.data?.items?.length} rows leaked`
  );

  /* --------------------------------------------------------------- moving */

  console.log("\n▸ Moving it");

  const moved = await call(mgrToken, "PUT", `/leader/tasks/${deptTaskId}`, {
    assignedTo: String(salesEmp._id),
  });
  check(
    "department work can be moved onto somebody else",
    moved.status === 200,
    moved.data?.message
  );
  check(
    "and the department it belongs to survives the move",
    String(moved.data?.item?.team?._id) === String(sales._id)
  );

  const movedNotes = await waitFor(async () => {
    const n = await Notification.countDocuments({ user: salesEmp._id, type: "task" });
    return n >= 2 ? n : null;
  });
  check(
    "the new person is told — a reassignment used to arrive silently",
    movedNotes >= 2,
    `${movedNotes} notifications`
  );

  const opsReach = await call(opsToken, "PUT", `/leader/tasks/${deptTaskId}`, { priority: "low" });
  check("another department's manager cannot touch it", opsReach.status === 404);

  /* ------------------------------------------------ what the figures read */

  console.log("\n▸ The department figures pick it up");

  const perf = await call(mgrToken, "GET", "/leader/reports/departments");
  const salesRow = (perf.data?.departments || [])
    .find((d) => d.department === "sales")
    ?.teams?.find((t) => String(t._id) === String(sales._id));
  check("the Sales team appears in department performance", Boolean(salesRow), perf.data?.message);
  check(
    "and its task count includes the department work",
    (salesRow?.tasks || 0) >= 3,
    `${salesRow?.tasks} tasks`
  );

  /* -------------------------------------------------------------- tidy up */

  const removed = await call(mgrToken, "DELETE", `/leader/tasks/${deptTaskId}`);
  check("a manager can delete their own department's work", removed.status === 200);

  await cleanup();
  await mongoose.disconnect();

  console.log("\n" + "─".repeat(60));
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log("─".repeat(60) + "\n");
  if (failures.length) {
    console.log("Failures:");
    failures.forEach((f) => console.log("  · " + f));
    console.log();
  }
  process.exit(fail ? 1 : 0);
};

run().catch(async (err) => {
  console.error("\nSuite crashed:", err);
  try {
    await cleanup();
    await mongoose.disconnect();
  } catch {
    /* the crash is the news, not the tidy-up */
  }
  process.exit(1);
});
