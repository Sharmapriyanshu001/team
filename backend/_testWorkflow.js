// Phase 10: the whole chain, end to end.
//
//   admin creates a project and assigns an operations manager
//   the leader assigns an employee a task
//   the employee works, submits code
//   the leader reviews it — sends it back, then approves
//   approving closes the task
//
// The part being proved is that a submission reaches the *operations manager*, not the
// admin, and that reviewing it is something only the person it was routed to
// can do. Project deletion is covered end to end in _testDeleteFlow.js; the
// last section here re-checks only that neither of them can destroy anything.
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Task from "./models/Task.js";
import Project from "./models/Project.js";
import CodeSubmission from "./models/CodeSubmission.js";

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

const PROJECT_NAME = "PHASE10 Office Management System";

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

  /**
   * A leader may only hand work to people who report to them, which is an
   * existing rule and not one this test should quietly bypass. So the seeded
   * reporting line is made to match — and put back exactly as found at the end.
   */
  const employeeDoc = await User.findById(employeeId).select("reportsTo");
  const originalReportsTo = employeeDoc.reportsTo;
  if (String(originalReportsTo || "") !== String(leaderId)) {
    await User.updateOne({ _id: employeeId }, { $set: { reportsTo: leaderId } });
  }

  const restore = async () => {
    await User.updateOne(
      { _id: employeeId },
      originalReportsTo ? { $set: { reportsTo: originalReportsTo } } : { $unset: { reportsTo: 1 } }
    );
  };

  console.log("Signed in as admin, operations manager and employee\n");

  /* ================================================ 1. the admin's project */

  console.log("=== Test 1 — the admin creates the project ===");

  // Clear anything a killed run left behind
  await Project.deleteMany({ name: PROJECT_NAME });
  await CodeSubmission.deleteMany({ title: /^PHASE10/ });
  await Task.deleteMany({ title: /^PHASE10/ });

  const clients = (await json(A, "GET", "/admin/lookups")).data?.clients || [];

  const created = await json(A, "POST", "/admin/projects", {
    name: PROJECT_NAME,
    code: "PHASE10",
    description: "Brought in by the client, run by the admin",
    client: clients[0]?._id || "",
    operationsManager: leaderId,
    members: [employeeId],
    status: "in_progress",
    priority: "high",
  });
  check("project created", created.status === 201, created.data?.message);

  const projectId = created.data?.item?._id;
  if (!projectId) {
    await restore();
    await mongoose.disconnect();
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  check("the admin is its owner, not the leader", true);

  /* ============================================= 2. it reaches the leader */

  console.log("\n=== Test 2 — it appears in the operations manager's projects ===");

  const leaderProjects = await json(L, "GET", "/leader/projects");
  check(
    "the leader sees it in My Projects",
    (leaderProjects.data?.items || []).some((p) => p._id === projectId)
  );

  const leaderDetail = await json(L, "GET", `/leader/projects/${projectId}`);
  check("and can open it", leaderDetail.status === 200);

  // Ownership stays where it was: the leader has no route that changes it
  const takeOver = await json(L, "PUT", `/admin/projects/${projectId}`, { operationsManager: leaderId });
  check("but cannot reach the admin's project routes", takeOver.status === 403, `${takeOver.status}`);

  /* ============================================ 3. the leader hands it on */

  console.log("\n=== Test 3 — the leader assigns an employee ===");

  // Assigning to themselves: a real account, but not an employee. A leader
  // may give work to any employee — the line is the role, not the org chart.
  const stranger = await json(L, "POST", "/leader/tasks", {
    title: "PHASE10 Not an employee",
    project: projectId,
    assignedTo: leaderId,
  });
  check(
    "work can only be given to an employee",
    stranger.status === 400,
    `${stranger.status} ${stranger.data?.message}`
  );

  const task = await json(L, "POST", "/leader/tasks", {
    title: "PHASE10 Build the attendance export",
    description: "CSV export for the attendance sheet",
    project: projectId,
    assignedTo: employeeId,
    priority: "high",
  });
  check("task created and assigned", task.status === 201, task.data?.message);

  const taskId = task.data?.item?._id;

  const employeeTasks = await json(E, "GET", "/employee/tasks");
  check(
    "the employee sees the task",
    (employeeTasks.data?.items || []).some((t) => t._id === taskId)
  );

  const employeeProjects = await json(E, "GET", "/employee/projects");
  check(
    "and the project it belongs to",
    (employeeProjects.data?.items || []).some((p) => p._id === projectId)
  );

  /* ================================================ 4/5. submitting code */

  console.log("\n=== Test 4 & 5 — the employee submits, the leader receives ===");

  const notMine = await json(E, "POST", "/employee/code", {
    title: "PHASE10 Wrong task",
    code: "console.log(1)",
    project: projectId,
    task: (await Task.create({ title: "PHASE10 Someone else's", assignedTo: leaderId }))._id,
  });
  check("a submission cannot name somebody else's task", notMine.status === 400, notMine.data?.message);
  await Task.deleteMany({ title: "PHASE10 Someone else's" });

  const submitted = await json(E, "POST", "/employee/code", {
    title: "PHASE10 Attendance export",
    description: "First cut of the CSV export",
    language: "javascript",
    project: projectId,
    task: taskId,
    code: "export const toCsv = (rows) => rows.join(',')\n",
    note: "Ready for review",
  });
  check("employee submits code", submitted.status === 201, submitted.data?.message);
  check(
    "and is told it went to their operations manager",
    /operations manager/i.test(submitted.data?.message || ""),
    submitted.data?.message
  );

  const submissionId = submitted.data?.item?._id;
  const stored = await CodeSubmission.findById(submissionId);
  check("it is routed to the project's operations manager", String(stored?.reviewer) === String(leaderId));
  check("the task travelled with it", String(stored?.task) === String(taskId));
  check("and it is waiting", stored?.status === "pending");

  const queue = await json(L, "GET", "/leader/code/review");
  check(
    "it is in the leader's review queue",
    (queue.data?.items || []).some((s) => s._id === submissionId),
    `waiting: ${queue.data?.waiting}`
  );

  const opened = await json(L, "GET", `/leader/code/${submissionId}`);
  check("the leader can open it", opened.status === 200, `${opened.status}`);
  check(
    "including the unapproved version, which is the point",
    (opened.data?.item?.versions || []).some((v) => v.version === 1 && v.code),
    JSON.stringify((opened.data?.item?.versions || []).map((v) => v.version))
  );

  /* ============================================== 6. changes are required */

  console.log("\n=== Test 6 — the leader asks for changes ===");

  const bare = await json(L, "PUT", `/leader/code/${submissionId}/review`, { decision: "changes" });
  check("sending it back needs a comment", bare.status === 400, bare.data?.message);

  const sentBack = await json(L, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "changes",
    note: "The export drops the header row — please add it",
  });
  check("changes requested", sentBack.status === 200, sentBack.data?.message);

  const afterChanges = await CodeSubmission.findById(submissionId);
  check("status is changes_required", afterChanges.status === "changes_required", afterChanges.status);
  check("nothing was approved", afterChanges.approvedVersion === 0);
  check("the comment is stored", Boolean(afterChanges.reviewNote), afterChanges.reviewNote);
  check("recorded against the leader", afterChanges.reviewedByRole === "operations_manager");

  const taskReopened = await Task.findById(taskId);
  check("and the task went back to in progress", taskReopened.status === "in_progress", taskReopened.status);

  const employeeSees = await json(E, "GET", "/employee/code");
  const myRow = (employeeSees.data?.items || []).find((s) => s._id === submissionId);
  check("the employee sees the decision", myRow?.status === "changes_required", myRow?.status);
  check("and the comment", /header row/.test(myRow?.reviewNote || ""), myRow?.reviewNote);
  check("and who has it", String(myRow?.reviewer?._id || myRow?.reviewer) === String(leaderId));

  /* ==================================================== resubmit and pass */

  console.log("\n=== Test 6b & 7 — the employee fixes it and resubmits ===");

  const resubmitted = await json(E, "POST", `/employee/code/${submissionId}/versions`, {
    code: "export const toCsv = (rows) => ['name,date', ...rows].join('\\n')\n",
    note: "Header row added",
  });
  check("employee resubmits", resubmitted.status === 200, resubmitted.data?.message);

  const afterResubmit = await CodeSubmission.findById(submissionId);
  check("it is waiting again", afterResubmit.status === "pending", afterResubmit.status);
  check("as version 2", afterResubmit.versions.length === 2);
  check("still with the same leader", String(afterResubmit.reviewer) === String(leaderId));
  check("and version 1 was not overwritten", afterResubmit.versions[0].code.includes("rows.join(',')"));

  const queueAgain = await json(L, "GET", "/leader/code/review");
  check(
    "back in the leader's queue",
    (queueAgain.data?.items || []).some((s) => s._id === submissionId)
  );

  const approved = await json(L, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "approve",
    note: "Good to go",
  });
  check("the leader approves it", approved.status === 200, approved.data?.message);

  const finalDoc = await CodeSubmission.findById(submissionId);
  check("status is approved", finalDoc.status === "approved", finalDoc.status);
  check("v2 is the approved version", finalDoc.approvedVersion === 2, `v${finalDoc.approvedVersion}`);

  const taskDone = await Task.findById(taskId);
  check("and the task is complete", taskDone.status === "completed", taskDone.status);
  check("with the completion stamped", Boolean(taskDone.completedAt));

  const decidedTwice = await json(L, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "approve",
  });
  check("a decided submission cannot be decided again", decidedTwice.status === 409, decidedTwice.data?.message);

  /* ------------------------------------ the history survived all of that */

  console.log("  -- the submission history is intact --");
  check("both versions are still there", finalDoc.versions.length === 2);
  check(
    "the trail records submit, resubmit and both decisions",
    ["submitted", "version_added", "changes_requested", "approved"].every((a) =>
      finalDoc.accessLog.some((row) => row.action === a)
    ),
    finalDoc.accessLog.map((r) => r.action).join(", ")
  );

  /* ==================================================== the admin's word */

  console.log("\n=== the admin still has the final say ===");

  const adminSees = await json(A, "GET", "/admin/code?status=all&limit=200");
  check(
    "the admin sees it in their own list",
    (adminSees.data?.items || []).some((s) => s._id === submissionId)
  );

  const overruled = await json(A, "PUT", `/admin/code/${submissionId}/review`, {
    decision: "reject",
    note: "The client changed their mind",
  });
  check("and can overrule the leader", overruled.status === 200, overruled.data?.message);

  const overruledDoc = await CodeSubmission.findById(submissionId);
  check("recorded against the admin", overruledDoc.reviewedByRole !== "operations_manager", overruledDoc.reviewedByRole);
  check(
    "and what was already approved stays out there",
    overruledDoc.approvedVersion === 2,
    `v${overruledDoc.approvedVersion}`
  );

  /* ========================================================== 13. security */

  console.log("\n=== Test 13 — the review queue is not a back door ===");

  const employeeQueue = await json(E, "GET", "/leader/code/review");
  check("an employee cannot read a leader's queue", employeeQueue.status === 403, `${employeeQueue.status}`);

  const employeeReviews = await json(E, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "approve",
  });
  check("nor decide on their own submission", employeeReviews.status === 403, `${employeeReviews.status}`);

  const adminOnLeaderRoute = await json(A, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "approve",
  });
  check("nor can an admin token use the leader's route", adminOnLeaderRoute.status === 403, `${adminOnLeaderRoute.status}`);

  /**
   * The check that matters most here: being an operations manager is not the
   * permission — being *this submission's* reviewer is. Routed elsewhere, the
   * same leader with the same token is refused.
   */
  await CodeSubmission.updateOne({ _id: submissionId }, { $set: { reviewer: employeeId } });
  const notTheirs = await json(L, "PUT", `/leader/code/${submissionId}/review`, {
    decision: "approve",
  });
  check(
    "a leader cannot review what was routed to somebody else",
    notTheirs.status === 403,
    `${notTheirs.status} ${notTheirs.data?.message}`
  );

  const notTheirsRead = await json(L, "GET", `/leader/code/${submissionId}`);
  check("nor read it once it is not theirs", notTheirsRead.status === 403, `${notTheirsRead.status}`);
  await CodeSubmission.updateOne({ _id: submissionId }, { $set: { reviewer: leaderId } });

  // And the destructive routes, which no amount of this changes
  for (const [label, token] of [
    ["employee", E],
    ["operations manager", L],
  ]) {
    const purge = await json(token, "DELETE", "/admin/code-projects/anything/permanent", {
      confirm: "anything",
    });
    check(`${label} still gets 403 on permanent delete`, purge.status === 403, `${purge.status}`);
  }

  /* --------------------------------------------------------------- cleanup */

  await CodeSubmission.deleteMany({ title: /^PHASE10/ });
  await Task.deleteMany({ title: /^PHASE10/ });
  await Project.deleteMany({ name: PROJECT_NAME });
  await restore();

  const leftovers =
    (await Project.countDocuments({ name: PROJECT_NAME })) +
    (await Task.countDocuments({ title: /^PHASE10/ })) +
    (await CodeSubmission.countDocuments({ title: /^PHASE10/ }));
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
