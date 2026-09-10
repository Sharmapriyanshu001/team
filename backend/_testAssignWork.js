// Phase 11: the leader hands a project down, and the code comes back up.
//
//   admin gives a project to an operations manager, with nobody on it
//   the leader puts their own employee on it        <- the missing middle
//   the leader gives them a task
//   the leader gives them the workspace
//   the employee opens it, pushes code, submits it
//   it lands back in that same leader's review queue
//
// Plus the part that makes it safe: everything a leader can reach here is
// their own project and their own team, and no request shape gets past that.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Task from "./models/Task.js";
import Project from "./models/Project.js";
import CodeProject from "./models/CodeProject.js";
import CodeSubmission from "./models/CodeSubmission.js";
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

/* ------------------------------------------------------- stored-zip writer */

let table = null;
const crc32 = (buf) => {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const buildZip = (entries) => {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "", "utf8");
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);

    parts.push(head, nameBuf, data);
    const localOffset = offset;
    offset += head.length + nameBuf.length + data.length;

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(localOffset, 42);
    central.push(c, nameBuf);
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, centralBuf, end]);
};

/* ------------------------------------------------------------------ helpers */

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

const upload = async (token, zipBuffer, fields) => {
  const form = new FormData();
  form.append("file", new Blob([zipBuffer], { type: "application/zip" }), fields.filename);
  Object.entries(fields).forEach(([k, v]) => k !== "filename" && form.append(k, v));

  const res = await fetch(BASE + "/admin/code-projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};

/** The leader's own upload — a ZIP sent down with the work. */
const leaderUpload = async (token, zipBuffer, fields) => {
  const form = new FormData();
  form.append("file", new Blob([zipBuffer], { type: "application/zip" }), fields.filename);
  Object.entries(fields).forEach(([k, v]) => k !== "filename" && form.append(k, v));

  const res = await fetch(BASE + "/leader/code-projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};

const purge = async (token, projectId) => {
  const found = await json(token, "GET", `/admin/code-projects/${projectId}`);
  if (found.status !== 200) return found;
  if (!found.data?.item?.deletedAt) {
    await json(token, "DELETE", `/admin/code-projects/${projectId}`);
  }
  return json(token, "DELETE", `/admin/code-projects/${projectId}/permanent`, {
    confirm: found.data?.item?.name,
  });
};

const has = (list, id) => (list || []).some((row) => String(row._id) === String(id));

const PROJECT_NAME = "PHASE11 Handed Down";
const OUTSIDER_EMAIL = "phase11.outsider@example.com";

/* --------------------------------------------------------------------- run */

const main = async () => {
  const admin = await json(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  const leader = await json(null, "POST", "/leader/login", {
    email: "kamal@gmail.com",
    password: "7896897896",
  });
  const employee = await json(null, "POST", "/employee/login", {
    email: "rahul123@gmail.com",
    password: "8003609515",
  });

  if (admin.status !== 200 || leader.status !== 200 || employee.status !== 200) {
    console.error("Could not sign in all three roles");
    process.exit(1);
  }

  const A = admin.data.token;
  const L = leader.data.token;
  const E = employee.data.token;

  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;
  const employeeId = (await json(E, "GET", "/employee/me")).data?.employee?.id;

  await mongoose.connect(process.env.MONGO_URI);

  // Clear anything a killed run left behind. Code projects go through the API
  // rather than the collection, so their workspaces and archives go too — a
  // run that dies half way otherwise leaves folders on disk forever.
  await Project.deleteMany({ name: /^PHASE11/ });
  await Task.deleteMany({ title: /^PHASE11/ });
  await CodeSubmission.deleteMany({ title: /^PHASE11/ });
  await User.deleteMany({ email: OUTSIDER_EMAIL });

  for (const stale of await CodeProject.find({ name: /^PHASE11/ }).select("_id")) {
    await purge(A, String(stale._id));
  }

  // The leader may only hand work to their own team, which is an existing
  // rule. Line the seed up with it, and put it back at the end.
  const before = await User.findById(employeeId).select("reportsTo");
  const originalReportsTo = before.reportsTo;
  await User.updateOne({ _id: employeeId }, { $set: { reportsTo: leaderId } });

  // Somebody who reports to nobody — the leader must not be able to name them
  const outsider = await User.create({
    name: "Phase 11 Outsider",
    email: OUTSIDER_EMAIL,
    password: hashPassword("phase11-test-pass"),
    role: "employee",
    status: "active",
  });

  const restore = async () => {
    await User.updateOne(
      { _id: employeeId },
      originalReportsTo ? { $set: { reportsTo: originalReportsTo } } : { $unset: { reportsTo: 1 } }
    );
    await User.deleteMany({ email: OUTSIDER_EMAIL });
  };

  console.log("Signed in as admin, operations manager and employee\n");

  /* ================================== 1. the admin gives it to the leader */

  console.log("=== the admin gives the leader a project with nobody on it ===");

  const created = await json(A, "POST", "/admin/projects", {
    name: PROJECT_NAME,
    code: "PHASE11",
    operationsManager: leaderId,
    members: [],
    status: "in_progress",
  });
  check("project created and assigned", created.status === 201, created.data?.message);

  const projectId = created.data?.item?._id;
  if (!projectId) {
    await restore();
    await mongoose.disconnect();
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  const empBefore = await json(E, "GET", "/employee/projects");
  check("the employee cannot see it yet", !has(empBefore.data?.items, projectId));

  /* ============================================= 2. the new sidebar screen */

  console.log("\n=== it shows up on the leader's Assign Work board ===");

  const board = await json(L, "GET", "/leader/assign-work");
  check("the board loads", board.status === 200, `${board.status}`);

  const row = (board.data?.items || []).find((p) => p._id === projectId);
  check("the project is on it", Boolean(row));
  check("with nobody assigned", (row?.members || []).length === 0);
  const offered = board.data?.team || [];
  check("the leader's own team is offered", offered.some((m) => m._id === employeeId));
  check(
    "their own report is flagged as such",
    offered.find((m) => m._id === employeeId)?.reportsToMe === true
  );

  /**
   * Every employee is offered, not only this leader's own reports — that is
   * the rule. What must still be absent is anybody who is not an employee.
   */
  check(
    "so is an employee who reports to somebody else",
    offered.some((m) => m._id === String(outsider._id))
  );
  check(
    "marked as not theirs",
    offered.find((m) => m._id === String(outsider._id))?.reportsToMe === false
  );
  check("and no operations manager is in the list", !offered.some((m) => m._id === String(leaderId)));

  /* ================================================ 3. the leader assigns */

  console.log("\n=== the leader puts their employee on it ===");

  const assigned = await json(L, "PUT", `/leader/projects/${projectId}/members`, {
    members: [employeeId],
  });
  check("members saved", assigned.status === 200, assigned.data?.message);

  const empAfter = await json(E, "GET", "/employee/projects");
  check("the employee sees the project now", has(empAfter.data?.items, projectId));

  /* --------------------------------------------------------- and a task */

  const task = await json(L, "POST", "/leader/tasks", {
    title: "PHASE11 Wire up the export",
    project: projectId,
    assignedTo: employeeId,
    priority: "high",
  });
  check("the leader gives them a task", task.status === 201, task.data?.message);

  const taskId = task.data?.item?._id;
  const empTasks = await json(E, "GET", "/employee/tasks");
  check("the employee sees the task", has(empTasks.data?.items, taskId));

  /* ================== 3b. assigning is what puts somebody on a project */

  console.log("\n=== assigning a task is enough on its own ===");

  // Take them back off, so the next assignment has to do the work itself
  await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [] });
  const emptied = await Project.findById(projectId);
  check("the project is back to nobody", emptied.members.length === 0);

  const straight = await json(L, "POST", "/leader/tasks", {
    title: "PHASE11 Assigned cold",
    project: projectId,
    assignedTo: employeeId,
  });
  check("the leader assigns a task with nobody on the project", straight.status === 201, straight.data?.message);
  check(
    "and is told they were put on it",
    straight.data?.joinedProject === true,
    straight.data?.message
  );

  const rejoined = await Project.findById(projectId);
  check(
    "the employee really is on the project now",
    rejoined.members.map(String).includes(String(employeeId))
  );

  const seesAgain = await json(E, "GET", "/employee/projects");
  check("so it is back on their screen", has(seesAgain.data?.items, projectId));

  const coldTaskId = straight.data?.item?._id;

  /* ------------------------------------- and the leader can run it from here */

  console.log("\n=== the leader manages the task without leaving the screen ===");

  const listed = await json(L, "GET", `/leader/tasks?project=${projectId}&limit=100`);
  check("the project's tasks are readable", listed.status === 200 && has(listed.data?.items, coldTaskId));

  const moved = await json(L, "PUT", `/leader/tasks/${coldTaskId}`, { status: "in_progress" });
  check("status can be changed inline", moved.status === 200, moved.data?.item?.status);
  check("and it stuck", (await Task.findById(coldTaskId)).status === "in_progress");

  const dated = await json(L, "PUT", `/leader/tasks/${coldTaskId}`, { dueDate: "2026-12-01" });
  check("the due date can be pushed", dated.status === 200, dated.data?.message);

  // Reassigning across teams is fine — they are still an employee
  const crossMove = await json(L, "PUT", `/leader/tasks/${coldTaskId}`, {
    assignedTo: String(outsider._id),
  });
  check(
    "can reassign to an employee on another team",
    crossMove.status === 200,
    `${crossMove.status} ${crossMove.data?.message}`
  );

  // Handing it to an operations manager is not
  const badMove = await json(L, "PUT", `/leader/tasks/${coldTaskId}`, {
    assignedTo: leaderId,
  });
  check(
    "cannot hand a task to an operations manager",
    badMove.status === 400,
    `${badMove.status} ${badMove.data?.message}`
  );

  // Back to the employee this test follows
  await json(L, "PUT", `/leader/tasks/${coldTaskId}`, { assignedTo: employeeId });

  const dropped = await json(L, "DELETE", `/leader/tasks/${coldTaskId}`);
  check("the task can be deleted from here", dropped.status === 200, dropped.data?.message);
  check("and it is gone", !(await Task.findById(coldTaskId)));

  const survived = await Project.findById(projectId);
  check(
    "deleting a task leaves the project and its team alone",
    Boolean(survived) && survived.members.map(String).includes(String(employeeId))
  );

  /* ============================================ 4. and then the workspace */

  console.log("\n=== the leader gives them the workspace ===");

  const zip = buildZip([
    { name: "index.html", content: "<h1>Handed down</h1>" },
    { name: "src/app.js", content: "console.log('start')\n" },
  ]);

  const code = await upload(A, zip, {
    filename: "handed.zip",
    name: "PHASE11 Workspace",
    project: projectId,
    operationsManagers: JSON.stringify([leaderId]),
    employees: "[]",
  });
  check("admin uploaded the code to the project", code.status === 201, code.data?.message);
  const codeId = code.data?.item?._id;

  const empNoCode = await json(E, "GET", `/employee/code-projects/${codeId}`);
  check("the employee cannot open it yet", empNoCode.status === 404, `${empNoCode.status}`);

  const board2 = await json(L, "GET", "/leader/assign-work");
  const row2 = (board2.data?.items || []).find((p) => p._id === projectId);
  check("the board shows the workspace under the project", has(row2?.codeProjects, codeId));

  const shared = await json(L, "PUT", `/leader/code-projects/${codeId}/employees`, {
    employees: [employeeId],
  });
  check("the leader shares it", shared.status === 200, shared.data?.message);

  const empCode = await json(E, "GET", `/employee/code-projects/${codeId}`);
  check("the employee can open it now", empCode.status === 200, `${empCode.status}`);

  const read = await json(
    E,
    "GET",
    `/employee/workspace/${codeId}/file?path=${encodeURIComponent("src/app.js")}`
  );
  check("and read the code", read.status === 200);

  const pushed = await json(E, "PUT", `/employee/workspace/${codeId}/file`, {
    path: "src/app.js",
    content: "console.log('done by the employee')\n",
  });
  check("and push a change into it", pushed.status === 200, pushed.data?.message);

  const onDisk = fs.readFileSync(
    path.resolve("uploads", "workspaces", String(codeId), "src", "app.js"),
    "utf8"
  );
  check("which really landed on disk", onDisk.includes("done by the employee"));

  /* ================================== 5. and the code comes back to them */

  console.log("\n=== what they submit comes back to that same leader ===");

  const submitted = await json(E, "POST", "/employee/code", {
    title: "PHASE11 Export ready",
    project: projectId,
    task: taskId,
    code: "export const run = () => true\n",
    note: "First pass",
  });
  check("the employee submits", submitted.status === 201, submitted.data?.message);

  const submissionId = submitted.data?.item?._id;
  const stored = await CodeSubmission.findById(submissionId);
  check("routed back to the leader who handed it down", String(stored?.reviewer) === String(leaderId));

  const queue = await json(L, "GET", "/leader/code/review");
  check("and it is in their review queue", has(queue.data?.items, submissionId));

  const board3 = await json(L, "GET", "/leader/assign-work");
  const row3 = (board3.data?.items || []).find((p) => p._id === projectId);
  check(
    "the board counts it against the project",
    row3?.submissionCounts?.pending === 1,
    JSON.stringify(row3?.submissionCounts)
  );
  check("and counts the open task", row3?.taskCounts?.pending === 1, JSON.stringify(row3?.taskCounts));

  const approved = await json(L, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "approve",
    note: "Looks right",
  });
  check("the leader signs it off", approved.status === 200, approved.data?.message);
  check("which closed the task", (await Task.findById(taskId)).status === "completed");

  /* =========================================================== 6. security */

  console.log("\n=== a leader reaches their own team and their own projects, nothing else ===");

  const outsiderId = String(outsider._id);

  /**
   * The boundary is the role, not the reporting line: an employee who reports
   * to somebody else is fair game, and putting them on works.
   */
  const borrow = await json(L, "PUT", `/leader/projects/${projectId}/members`, {
    members: [employeeId, outsiderId],
  });
  check(
    "can put an employee from another team on it",
    borrow.status === 200,
    `${borrow.status} ${borrow.data?.message}`
  );
  check(
    "and they really are on it",
    (await Project.findById(projectId)).members.map(String).includes(outsiderId)
  );

  // Put it back to just the one, for the rest of the test
  await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [employeeId] });

  const grabLeader = await json(L, "PUT", `/leader/projects/${projectId}/members`, {
    members: [leaderId],
  });
  check("but cannot put an operations manager on it", grabLeader.status === 403, `${grabLeader.status}`);

  const disabled = await User.findOneAndUpdate(
    { _id: outsider._id },
    { $set: { status: "inactive" } },
    { returnDocument: "after" }
  );
  const grabInactive = await json(L, "PUT", `/leader/projects/${projectId}/members`, {
    members: [employeeId, String(disabled._id)],
  });
  check(
    "nor a disabled account",
    grabInactive.status === 403,
    `${grabInactive.status} ${grabInactive.data?.message}`
  );
  await User.updateOne({ _id: outsider._id }, { $set: { status: "active" } });

  const stillOne = await Project.findById(projectId);
  check("and neither refusal changed anything", stillOne.members.length === 1);

  // A project this leader does not lead
  const other = await json(A, "POST", "/admin/projects", {
    name: "PHASE11 Somebody Else's",
    status: "planning",
  });
  const otherId = other.data?.item?._id;

  const reachOther = await json(L, "PUT", `/leader/projects/${otherId}/members`, {
    members: [employeeId],
  });
  check("cannot touch a project that is not theirs", reachOther.status === 404, `${reachOther.status}`);

  // A code project the admin did not assign to them
  const otherCode = await upload(A, zip, {
    filename: "notyours.zip",
    name: "PHASE11 Not Yours",
    operationsManagers: "[]",
    employees: "[]",
  });
  const otherCodeId = otherCode.data?.item?._id;

  const reachOtherCode = await json(L, "PUT", `/leader/code-projects/${otherCodeId}/employees`, {
    employees: [employeeId],
  });
  check(
    "cannot share a workspace that is not theirs",
    reachOtherCode.status === 404,
    `${reachOtherCode.status}`
  );

  /**
   * The one worth being explicit about: the workspace route takes a list of
   * employees and nothing else. Everything hopeful sent alongside it — another
   * operations manager, wider permissions, a different owner — has to be ignored.
   */
  const smuggle = await json(L, "PUT", `/leader/code-projects/${codeId}/employees`, {
    employees: [employeeId],
    operationsManagers: [leaderId, outsiderId],
    permissions: { canEdit: true, canCreateDelete: true, canRun: true },
    project: otherId,
    name: "Renamed by the leader",
  });
  check("the workspace route ignores everything but the employee list", smuggle.status === 200);

  const codeDoc = await CodeProject.findById(codeId);
  check("the operations managers are unchanged", codeDoc.operationsManagers.length === 1);
  check(
    "the permissions are unchanged",
    codeDoc.permissions.canCreateDelete === false,
    JSON.stringify(codeDoc.permissions)
  );
  check("the name is unchanged", codeDoc.name === "PHASE11 Workspace", codeDoc.name);
  check("and it still belongs to the same project", String(codeDoc.project) === String(projectId));

  // The employee cannot use any of it
  for (const [label, route, body] of [
    ["assign work board", "/leader/assign-work", null],
    ["project members", `/leader/projects/${projectId}/members`, { members: [] }],
    ["workspace sharing", `/leader/code-projects/${codeId}/employees`, { employees: [] }],
  ]) {
    const asEmployee = await json(E, body ? "PUT" : "GET", route, body);
    check(`an employee gets 403 on ${label}`, asEmployee.status === 403, `${asEmployee.status}`);
  }

  /* ============================================= 7. and taking it back */

  /* ============ every employee is on offer, and the record says who sent it */

  console.log("\n=== the picker offers every employee, not just a team ===");

  const activeEmployees = await User.countDocuments({
    role: "employee",
    status: "active",
  });
  const board4 = await json(L, "GET", "/leader/assign-work");
  check(
    "the board offers all of them",
    (board4.data?.team || []).length === activeEmployees,
    `${(board4.data?.team || []).length} offered of ${activeEmployees} active`
  );
  check(
    "their own reports come first",
    (board4.data?.team || [])[0]?.reportsToMe === true,
    JSON.stringify((board4.data?.team || []).map((m) => m.reportsToMe))
  );

  console.log("\n=== the employee is told who sent it, and when ===");

  /**
   * Off first, so this is a genuine new assignment. Re-saving a list somebody
   * is already on keeps the record they have — being included in a wider edit
   * is not somebody sending you the project again — so adding them on top of
   * an existing membership would leave the original date in place.
   */
  await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [] });

  const beforeAssign = Date.now();
  await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [employeeId] });

  const sentList = await json(E, "GET", "/employee/projects");
  const sentRow = (sentList.data?.items || []).find((r) => r._id === projectId);

  check("the project is on their list", Boolean(sentRow));
  check("and names the operations manager who sent it", sentRow?.assignedBy === "kamal", sentRow?.assignedBy);
  check("as an exact record, not a guess", sentRow?.assignedExact === true);
  check(
    "with the time it happened",
    sentRow?.assignedAt && new Date(sentRow.assignedAt).getTime() >= beforeAssign - 2000,
    sentRow?.assignedAt
  );
  check(
    "and nobody else's record travels with it",
    sentRow?.memberAssignments === undefined
  );

  /* --------------------------------------- the same when a task adds them */

  await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [] });
  await Project.updateOne({ _id: projectId }, { $set: { memberAssignments: [] } });

  const viaTask = await json(L, "POST", "/leader/tasks", {
    title: "PHASE11 Recorded by task",
    project: projectId,
    assignedTo: employeeId,
  });
  check("assigning a task puts them on it", viaTask.data?.joinedProject === true);

  const afterTask = await json(E, "GET", "/employee/projects");
  const taskRow = (afterTask.data?.items || []).find((r) => r._id === projectId);
  check(
    "and that route records the sender too",
    taskRow?.assignedBy === "kamal" && taskRow?.assignedExact === true,
    `${taskRow?.assignedBy} exact=${taskRow?.assignedExact}`
  );
  check("with a time", Boolean(taskRow?.assignedAt), taskRow?.assignedAt);

  const storedOnce = await Project.findById(projectId);
  check(
    "one record per person, not one per assignment",
    storedOnce.memberAssignments.filter((r) => String(r.user) === String(employeeId)).length === 1,
    `${storedOnce.memberAssignments.length} records`
  );

  await json(L, "DELETE", `/leader/tasks/${viaTask.data?.items?.[0]?._id || viaTask.data?.item?._id}`);

  /* ------------------------------ a membership with no record still reads */

  console.log("\n=== a membership made before this was tracked still reads ===");

  await Project.updateOne({ _id: projectId }, { $set: { memberAssignments: [] } });
  const legacy = await json(E, "GET", "/employee/projects");
  const legacyRow = (legacy.data?.items || []).find((r) => r._id === projectId);
  check(
    "it falls back to the project's operations manager",
    legacyRow?.assignedBy === "kamal",
    legacyRow?.assignedBy
  );
  check("says so rather than claiming to be exact", legacyRow?.assignedExact === false);
  check("and invents no date", legacyRow?.assignedAt === null, String(legacyRow?.assignedAt));

  /* -------------------------------------- and the same for the workspace */

  console.log("\n=== the workspace says who handed it over too ===");

  await json(L, "PUT", `/leader/code-projects/${codeId}/employees`, { employees: [employeeId] });

  const myCode = await json(E, "GET", "/employee/code-projects");
  const codeRow = (myCode.data?.items || []).find((r) => r._id === codeId);
  check("the workspace is on their list", Boolean(codeRow));
  check("and names who sent it", codeRow?.assignedBy === "kamal", codeRow?.assignedBy);
  check("with a time", Boolean(codeRow?.assignedAt), codeRow?.assignedAt);
  check(
    "and nobody else's record travels with it",
    codeRow?.employeeAssignments === undefined
  );

  // Put the project back to one member for the section that follows
  await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [employeeId] });

  /* ================= the leader sends code down with the work ============ */

  console.log("\n=== the leader can send a ZIP with the task ===");

  const handed = await leaderUpload(L, zip, {
    filename: "handoff.zip",
    name: "PHASE11 Sent By Leader",
    project: projectId,
    employees: JSON.stringify([employeeId]),
    // Everything below is hopeful and must be ignored
    operationsManagers: JSON.stringify([leaderId, String(outsider._id)]),
    canCreateDelete: "true",
    canRun: "false",
  });
  check("the upload is accepted", handed.status === 201, handed.data?.message);

  const handedId = handed.data?.item?._id;
  const handedDoc = handedId ? await CodeProject.findById(handedId) : null;

  check("it is extracted and ready", handedDoc?.workspaceReady === true);
  check(
    "linked to the project it was sent for",
    String(handedDoc?.project) === String(projectId)
  );
  check(
    "the leader is the only operations manager on it",
    handedDoc?.operationsManagers.length === 1 &&
      String(handedDoc.operationsManagers[0]) === String(leaderId),
    JSON.stringify(handedDoc?.operationsManagers)
  );
  check(
    "the employee it was sent to has it",
    handedDoc?.employees.map(String).includes(String(employeeId))
  );
  check(
    "and the per-project permissions took their defaults, not the payload",
    handedDoc?.permissions.canCreateDelete === false && handedDoc?.permissions.canRun === true,
    JSON.stringify(handedDoc?.permissions)
  );

  console.log("  -- and it reaches the employee --");

  const empCodeList = await json(E, "GET", "/employee/code-projects");
  const empCodeRow = (empCodeList.data?.items || []).find((r) => r._id === handedId);
  check("it is on their workspace list", Boolean(empCodeRow));
  check("saying who sent it", empCodeRow?.assignedBy === "kamal", empCodeRow?.assignedBy);
  check("and when", Boolean(empCodeRow?.assignedAt), empCodeRow?.assignedAt);

  const opened = await json(
    E,
    "GET",
    `/employee/workspace/${handedId}/file?path=${encodeURIComponent("src/app.js")}`
  );
  check("and they can open the code in it", opened.status === 200, `${opened.status}`);

  console.log("\n=== My Work shows the project, the task and the code together ===");

  const myWork = await json(E, "GET", "/employee/assigned");
  check("the page loads", myWork.status === 200, `${myWork.status}`);

  const group = (myWork.data?.items || []).find(
    (row) => String(row.project?._id) === String(projectId)
  );
  check("the project is one of the groups", Boolean(group));
  check(
    "and says which operations manager sent it",
    group?.project?.assignedBy === "kamal",
    group?.project?.assignedBy
  );
  check("with the date", Boolean(group?.project?.assignedAt), group?.project?.assignedAt);
  check(
    "the task the leader gave is in the same group",
    (group?.tasks || []).some((t) => String(t._id) === String(taskId)),
    `${(group?.tasks || []).length} tasks`
  );
  check(
    "naming who gave it",
    (group?.tasks || []).find((t) => String(t._id) === String(taskId))?.assignedBy?.name === "kamal"
  );
  check(
    "and the code sent with it is there too",
    (group?.codeProjects || []).some((c) => String(c._id) === String(handedId))
  );
  check(
    "carrying what they may do in it",
    (group?.codeProjects || []).find((c) => String(c._id) === String(handedId))?.myAccess
      ?.canEdit === true
  );
  check(
    "and nobody else's assignment record",
    (group?.codeProjects || []).every((c) => c.employeeAssignments === undefined) &&
      group?.project?.memberAssignments === undefined
  );

  console.log("\n=== and the upload route is not a way round anything ===");

  const notMine = await leaderUpload(L, zip, {
    filename: "notmine.zip",
    name: "PHASE11 Wrong Project",
    project: otherId,
    employees: JSON.stringify([employeeId]),
  });
  check("cannot upload into a project they do not run", notMine.status === 404, `${notMine.status} ${notMine.data?.message}`);

  const noProject = await leaderUpload(L, zip, {
    filename: "loose.zip",
    name: "PHASE11 No Project",
    employees: JSON.stringify([employeeId]),
  });
  check(
    "nor upload one attached to no project at all",
    noProject.status === 400,
    `${noProject.status} ${noProject.data?.message}`
  );

  const asEmployee = await leaderUpload(E, zip, {
    filename: "nope.zip",
    name: "PHASE11 By Employee",
    project: projectId,
  });
  check("and an employee cannot use it at all", asEmployee.status === 403, `${asEmployee.status}`);

  const strays = await CodeProject.countDocuments({
    name: { $in: ["PHASE11 Wrong Project", "PHASE11 No Project", "PHASE11 By Employee"] },
  });
  check("none of the refused uploads left a record behind", strays === 0, `${strays}`);

  await purge(A, handedId);

  console.log("\n=== taking somebody off works the same way ===");

  const removed = await json(L, "PUT", `/leader/projects/${projectId}/members`, { members: [] });
  check("the leader removes them", removed.status === 200, removed.data?.message);

  const empGone = await json(E, "GET", "/employee/projects");
  check("the project leaves their list", !has(empGone.data?.items, projectId));

  const cleared = await Project.findById(projectId);
  check(
    "and the record of who sent it goes with them",
    !cleared.memberAssignments.some((r) => String(r.user) === String(employeeId)),
    `${cleared.memberAssignments.length} records left`
  );

  const codeRevoked = await json(L, "PUT", `/leader/code-projects/${codeId}/employees`, {
    employees: [],
  });
  check("and the workspace too", codeRevoked.status === 200, codeRevoked.data?.message);

  const empCodeGone = await json(E, "GET", `/employee/code-projects/${codeId}`);
  check("which they can no longer open", empCodeGone.status === 404, `${empCodeGone.status}`);

  const stillOnDisk = fs.existsSync(path.resolve("uploads", "workspaces", String(codeId)));
  check("taking access away deleted nothing", stillOnDisk);

  /* --------------------------------------------------------------- cleanup */

  await purge(A, codeId);
  await purge(A, otherCodeId);
  await CodeSubmission.deleteMany({ title: /^PHASE11/ });
  await Task.deleteMany({ title: /^PHASE11/ });
  await Project.deleteMany({ name: /^PHASE11/ });
  await restore();

  const leftovers =
    (await Project.countDocuments({ name: /^PHASE11/ })) +
    (await CodeProject.countDocuments({ name: /^PHASE11/ })) +
    (await User.countDocuments({ email: OUTSIDER_EMAIL }));
  check("nothing left behind", leftovers === 0, `${leftovers}`);

  const back = await User.findById(employeeId).select("reportsTo");
  check(
    "the reporting line is as it was found",
    String(back.reportsTo || "") === String(originalReportsTo || "")
  );

  await mongoose.disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch(async (err) => {
  console.error("harness error:", err);
  try {
    await mongoose.disconnect();
  } catch {}
  process.exit(1);
});
