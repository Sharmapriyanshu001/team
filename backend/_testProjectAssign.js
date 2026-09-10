// Assigning people to a project from the admin panel, and what the admin is
// then told about it.
//
// Two things were wrong before this.
//
// The first is that an admin adding somebody to a project told them nothing.
// The leader's own assign flow has always notified and always written down
// who did the adding; the admin's path did neither, so three people added
// from Assign Team found out by noticing a new project in their list, and the
// project's own record of who put them there was blank.
//
// The second is the progress figure. `Project.progress` is a number typed
// into the create form and nothing has ever recalculated it — on this
// database nine of ten projects disagree with their own task board, and that
// same figure is what the client is shown in their portal. The detail
// endpoint now returns both, named for what they are, and changes neither on
// its own.
//
// Run against a server started on PORT_UNDER_TEST (default 5099).
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Client from "./models/Client.js";
import Project from "./models/Project.js";
import Task from "./models/Task.js";
import WorkLog from "./models/WorkLog.js";
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

const TAG = `pa_${Date.now()}`;
const PASSWORD = "9700000000";

const madeUsers = [];
const madeProjects = [];
const madeClients = [];
const madeTasks = [];
const madeLogs = [];

const seed = async (role, name) => {
  const person = await User.create({
    name: `${name} ${TAG}`,
    email: `${name.toLowerCase()}.${TAG}@example.com`,
    password: hashPassword(PASSWORD),
    role,
    phone: PASSWORD,
    status: "active",
    designation: name,
  });
  madeUsers.push(person._id);
  return person;
};

const cleanup = async () => {
  await WorkLog.deleteMany({ _id: { $in: madeLogs } });
  await Task.deleteMany({ $or: [{ _id: { $in: madeTasks } }, { project: { $in: madeProjects } }] });
  await Project.deleteMany({ _id: { $in: madeProjects } });
  await Client.deleteMany({ _id: { $in: madeClients } });
  await Notification.deleteMany({ user: { $in: madeUsers } });
  await User.deleteMany({ _id: { $in: madeUsers } });
  await User.deleteMany({ email: new RegExp(TAG) });
};

/** Notifications are fire-and-forget, so the read looks again rather than once. */
const waitFor = async (read, tries = 20) => {
  for (let i = 0; i < tries; i += 1) {
    const value = await read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("\n▸ A project with a leader and one person on it");

  const leader = await seed("operations_manager", "ProjLead");
  const otherLeader = await seed("operations_manager", "OtherProjLead");
  const first = await seed("employee", "FirstOn");
  const second = await seed("employee", "SecondOn");
  const third = await seed("employee", "ThirdOn");

  const client = await Client.create({
    name: `Client ${TAG}`,
    email: `client.${TAG}@example.com`,
    company: `Acme ${TAG}`,
    password: hashPassword(PASSWORD),
    status: "active",
  });
  madeClients.push(client._id);

  const project = await Project.create({
    name: `Assignable ${TAG}`,
    code: TAG,
    client: client._id,
    operationsManager: leader._id,
    members: [first._id],
    // Deliberately a lie, and exactly the lie the live data is full of
    progress: 80,
    status: "in_progress",
  });
  madeProjects.push(project._id);

  // Four tasks, one finished — so the board says 25%, not 80%
  for (const [index, title] of ["Wireframes", "API", "Frontend", "Launch"].entries()) {
    const task = await Task.create({
      title: `${title} ${TAG}`,
      project: project._id,
      assignedTo: index < 2 ? first._id : null,
      assignedBy: leader._id,
      status: index === 0 ? "completed" : index === 1 ? "review" : "pending",
      dueDate: index === 1 ? new Date(Date.now() - 3 * 86400000) : undefined,
    });
    madeTasks.push(task._id);
  }

  const log = await WorkLog.create({
    employee: first._id,
    date: new Date(),
    hours: 6.5,
    summary: `Did the wireframes ${TAG}`,
  });
  madeLogs.push(log._id);

  const adminToken = (
    await call(null, "POST", "/admin/login", {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    })
  ).data?.token;
  check("the admin can sign in", Boolean(adminToken));

  /* ------------------------------------------------------ what it reports */

  console.log("\n▸ How far along it really is");

  const detail = await call(adminToken, "GET", `/admin/projects/${project._id}/details`);
  check("the detail endpoint answers", detail.status === 200, detail.data?.message);

  const progress = detail.data?.progress;
  check("it reports the figure that was typed", progress?.recorded === 80, String(progress?.recorded));
  check(
    "and the one the task board actually supports",
    progress?.actual === 25,
    `${progress?.actual}% from ${progress?.completed}/${progress?.total}`
  );
  check("and says outright that the two disagree", progress?.matches === false);

  check(
    "the stored figure is left alone — changing what a client sees is not the app's call",
    (await Project.findById(project._id)).progress === 80
  );

  /* ----------------------------------------------------- who has done what */

  const rows = detail.data?.contributions || [];
  const firstRow = rows.find((r) => String(r._id) === String(first._id));
  const leaderRow = rows.find((r) => String(r._id) === String(leader._id));

  check("every person on the project has a row", rows.length >= 2, `${rows.length} rows`);
  check(
    "the person doing the work has their tasks counted",
    firstRow?.assigned === 2 && firstRow?.completed === 1 && firstRow?.inReview === 1,
    JSON.stringify({ a: firstRow?.assigned, c: firstRow?.completed, r: firstRow?.inReview })
  );
  check("their overdue work is called out", firstRow?.overdue === 1, String(firstRow?.overdue));
  check("and their logged hours are on the row", firstRow?.hours === 6.5, String(firstRow?.hours));
  check(
    "the leader appears too, with nothing assigned rather than being dropped",
    leaderRow && leaderRow.assigned === 0,
    JSON.stringify(leaderRow && { name: leaderRow.name, assigned: leaderRow.assigned })
  );
  check(
    "unassigned work is counted, so it cannot sit there unnoticed",
    detail.data?.stats?.unassigned === 2,
    String(detail.data?.stats?.unassigned)
  );
  check("and the hours reach the summary", detail.data?.stats?.hoursThisWeek === 6.5);

  /* --------------------------------------------------------- adding people */

  console.log("\n▸ Adding two more people from the admin panel");

  const added = await call(adminToken, "PUT", `/admin/projects/${project._id}`, {
    operationsManager: String(leader._id),
    members: [String(first._id), String(second._id), String(third._id)],
  });
  check("the admin can add people to a project", added.status === 200, added.data?.message);
  check(
    "and the project now holds all three",
    (added.data?.item?.members || []).length === 3,
    `${added.data?.item?.members?.length} members`
  );

  const secondNote = await waitFor(() =>
    Notification.findOne({ user: second._id, type: "project" }).sort({ createdAt: -1 })
  );
  check(
    "the person added is told — before this they were never told at all",
    Boolean(secondNote),
    secondNote?.title
  );
  check(
    "and the message names the project",
    (secondNote?.message || "").includes(TAG),
    secondNote?.message
  );

  const thirdNote = await waitFor(() =>
    Notification.findOne({ user: third._id, type: "project" }).sort({ createdAt: -1 })
  );
  check("everybody added is told, not just the first of them", Boolean(thirdNote));

  const firstNoteCount = await Notification.countDocuments({
    user: first._id,
    type: "project",
  });
  check(
    "somebody already on the project is not told again",
    firstNoteCount === 0,
    `${firstNoteCount} notifications`
  );

  const recorded = await waitFor(async () => {
    const doc = await Project.findById(project._id).select("memberAssignments");
    return doc.memberAssignments?.length >= 2 ? doc : null;
  });
  const forSecond = (recorded?.memberAssignments || []).find(
    (row) => String(row.user) === String(second._id)
  );
  check(
    "and the project records who put them there",
    Boolean(forSecond?.assignedByName),
    forSecond?.assignedByName
  );
  check(
    "with the admin named, not the leader",
    forSecond?.assignedByRole && !["operations_manager", "manager"].includes(forSecond.assignedByRole),
    forSecond?.assignedByRole
  );

  /* ------------------------------------------------------- taking them off */

  console.log("\n▸ Taking somebody off");

  const removed = await call(adminToken, "PUT", `/admin/projects/${project._id}`, {
    operationsManager: String(leader._id),
    members: [String(first._id), String(second._id)],
  });
  check("the admin can take somebody off a project", removed.status === 200);

  const offNote = await waitFor(async () => {
    const notes = await Notification.find({ user: third._id, type: "project" }).sort({
      createdAt: -1,
    });
    return notes.find((n) => /taken off/i.test(n.title)) || null;
  });
  check("and they are told that too", Boolean(offNote), offNote?.title);

  const after = await Project.findById(project._id).select("memberAssignments members");
  check(
    "their assignment record goes with them",
    !(after.memberAssignments || []).some((row) => String(row.user) === String(third._id))
  );
  check(
    "while the people still on it keep theirs",
    (after.memberAssignments || []).some((row) => String(row.user) === String(second._id))
  );

  /* -------------------------------------------------------- changing lead */

  console.log("\n▸ Changing the lead");

  const relead = await call(adminToken, "PUT", `/admin/projects/${project._id}`, {
    operationsManager: String(otherLeader._id),
    members: [String(first._id), String(second._id)],
  });
  check("the admin can change the operations manager", relead.status === 200);

  const leadNote = await waitFor(() =>
    Notification.findOne({ user: otherLeader._id, type: "project" }).sort({ createdAt: -1 })
  );
  check("the new lead is told", Boolean(leadNote), leadNote?.title);

  /* ---------------------------------------------------- syncing the figure */

  console.log("\n▸ Syncing the progress figure, when the admin asks");

  const synced = await call(adminToken, "PUT", `/admin/projects/${project._id}`, { progress: 25 });
  check("the admin can set the recorded figure", synced.status === 200);
  check(
    "and it is what the board said",
    (await Project.findById(project._id)).progress === 25
  );

  const after2 = await call(adminToken, "GET", `/admin/projects/${project._id}/details`);
  check(
    "the two figures now agree",
    after2.data?.progress?.matches === true,
    JSON.stringify(after2.data?.progress)
  );

  /* ------------------------------------------------ a project with no tasks */

  console.log("\n▸ A project nobody has broken into work yet");

  const empty = await Project.create({
    name: `Untouched ${TAG}`,
    client: client._id,
    progress: 40,
  });
  madeProjects.push(empty._id);

  const emptyDetail = await call(adminToken, "GET", `/admin/projects/${empty._id}/details`);
  check(
    "is reported as unmeasured, not as zero — the two are different things",
    emptyDetail.data?.progress?.actual === null,
    JSON.stringify(emptyDetail.data?.progress)
  );
  check(
    "and is not flagged as disagreeing with itself",
    emptyDetail.data?.progress?.matches === true
  );

  /* -------------------------------------------------------------- tidy up */

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
