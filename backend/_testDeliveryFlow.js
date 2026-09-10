/**
 * The whole chain, end to end, in the order it actually happens:
 *
 *   Sales opens a project on a won client
 *   Sales head hands it to an operations manager and a developer
 *   The manager assigns a task with dates, a bonus and a progress target
 *   The developer reports progress, then submits for review
 *   The manager approves — and the bonus is recorded
 *   The client watches their own progress, and only their own
 *   The client asks for a change; the developer works it; it closes
 *   The administrator reads the money, and nobody else can
 *
 * The permission checks matter as much as the happy path. Every step that
 * should be refused is asked for from the wrong panel and expected to fail.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import ChangeRequest from "./models/ChangeRequest.js";
import Client from "./models/Client.js";
import Invoice from "./models/Invoice.js";
import Project from "./models/Project.js";
import Task from "./models/Task.js";
import User from "./models/User.js";
import { hashPassword } from "./utils/password.js";
import { estimateCompletion } from "./utils/projectEstimate.js";

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

const signIn = async (panel, email, password) =>
  (await json(null, "POST", `/${panel}/login`, { email, password })).data?.token;

const PASSWORD = "delivery-flow-test-pass";
const P = {
  salesHead: "flow.saleshead@example.com",
  opsManager: "flow.opsmanager@example.com",
  developer: "flow.developer@example.com",
  outsider: "flow.outsider@example.com",
};
const CLIENT_EMAIL = "flow.client@example.com";
const CLIENT_NAME = "Flow Test Client";
const PROJECT_NAME = "Flow Test Build";

const cleanup = async () => {
  const clients = await Client.find({ email: CLIENT_EMAIL }).select("_id");
  const projects = await Project.find({ name: PROJECT_NAME }).select("_id");
  const ids = projects.map((p) => p._id);

  await ChangeRequest.deleteMany({ project: { $in: ids } });
  await Task.deleteMany({ project: { $in: ids } });
  await Invoice.deleteMany({ project: { $in: ids } });
  await Project.deleteMany({ _id: { $in: ids } });
  await Client.deleteMany({ _id: { $in: clients.map((c) => c._id) } });
  await User.deleteMany({ email: { $in: Object.values(P) } });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await cleanup();

  /* ------------------------------------------------------------- the cast */

  const [salesHead, opsManager, developer, outsider] = await Promise.all([
    User.create({ name: "Sales Head", email: P.salesHead, password: hashPassword(PASSWORD), role: "sales", status: "active" }),
    User.create({ name: "Ops Manager", email: P.opsManager, password: hashPassword(PASSWORD), role: "manager", status: "active" }),
    User.create({ name: "Dev Person", email: P.developer, password: hashPassword(PASSWORD), role: "employee", status: "active" }),
    User.create({ name: "Other Dev", email: P.outsider, password: hashPassword(PASSWORD), role: "employee", status: "active" }),
  ]);

  const client = await Client.create({
    name: CLIENT_NAME,
    email: CLIENT_EMAIL,
    password: hashPassword(PASSWORD),
    company: "Flow Ltd",
    status: "active",
    owner: salesHead._id,
  });

  const salesToken = await signIn("sales", P.salesHead, PASSWORD);
  const leaderToken = await signIn("leader", P.opsManager, PASSWORD);
  const devToken = await signIn("employee", P.developer, PASSWORD);
  const outsiderToken = await signIn("employee", P.outsider, PASSWORD);
  const clientToken = await signIn("client", CLIENT_EMAIL, PASSWORD);
  const adminToken = await signIn("admin", process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

  check(
    "every panel signs in",
    Boolean(salesToken && leaderToken && devToken && clientToken && adminToken),
    [
      salesToken ? "" : "sales",
      leaderToken ? "" : "leader",
      devToken ? "" : "employee",
      clientToken ? "" : "client",
      adminToken ? "" : "admin",
    ]
      .filter(Boolean)
      .join(" ") || "all"
  );

  /* ------------------------------------------------- 1. Sales → a project */

  section("Sales opens a project on a won client");

  const opened = await json(salesToken, "POST", `/sales/clients/${client._id}/project`, {
    name: PROJECT_NAME,
    description: "Built by the end-to-end test",
    budget: 500000,
  });
  check("sales opens a project from the client", opened.status === 201, opened.data?.message);

  const project = await Project.findOne({ name: PROJECT_NAME });
  check("it is linked to the client", String(project?.client) === String(client._id));
  check("and lands with nobody running it yet", !project?.operationsManager);

  /* --------------------------------------------- 2. handover to Operations */

  section("Sales head hands it to Operations");

  const people = await json(salesToken, "GET", "/sales/delivery-team");
  check("the delivery team list loads", people.status === 200);
  const groups = new Set((people.data?.items || []).map((p) => p.group));
  check("it separates managers from developers", groups.has("Operations Managers") && groups.has("Developers & staff"));

  const badAssign = await json(salesToken, "PUT", `/sales/projects/${project._id}/assign`, {
    operationsManager: String(developer._id),
  });
  check(
    "a developer cannot be put in charge of delivery",
    badAssign.status === 400,
    badAssign.data?.message
  );

  const assigned = await json(salesToken, "PUT", `/sales/projects/${project._id}/assign`, {
    operationsManager: String(opsManager._id),
    members: [String(developer._id)],
  });
  check("the head hands it to the operations manager", assigned.status === 200, assigned.data?.message);

  const handed = await Project.findById(project._id);
  check("the manager is on it", String(handed.operationsManager) === String(opsManager._id));
  check("so is the developer", handed.members.some((m) => String(m) === String(developer._id)));
  check("the manager is also a member, not just the lead", handed.members.some((m) => String(m) === String(opsManager._id)));
  check("handing it over starts it", handed.status === "in_progress");

  const salesEdit = await json(salesToken, "PUT", `/sales/projects/${project._id}`, { budget: 1 });
  check("sales has no route to edit the project itself", salesEdit.status === 404 || salesEdit.status === 403);

  /* ------------------------------------------------------ 3. the task */

  section("The operations manager assigns work");

  const badDates = await json(leaderToken, "POST", "/leader/tasks", {
    title: "Dates the wrong way round",
    project: String(project._id),
    assignedTo: String(developer._id),
    startDate: "2026-06-10",
    dueDate: "2026-06-01",
  });
  check("a start date after the due date is refused", badDates.status === 400, badDates.data?.message);

  const created = await json(leaderToken, "POST", "/leader/tasks", {
    title: "Build the landing page",
    description: "Hero, pricing and contact",
    project: String(project._id),
    assignedTo: String(developer._id),
    priority: "high",
    startDate: "2026-06-01",
    dueDate: "2026-06-30",
    bonus: 2000,
  });
  check("the manager assigns a task", created.status === 201, created.data?.message);

  const task = await Task.findOne({ title: "Build the landing page" });
  check("with a start date", Boolean(task?.startDate));
  check("and a bonus on it", task?.bonus === 2000);
  check("which is not earned yet", !task?.bonusAwardedAt);

  const clamped = await json(leaderToken, "PUT", `/leader/tasks/${task._id}`, { progress: 500 });
  check("an impossible progress is squared off, not stored", clamped.status === 200);
  check("clamped to 100", (await Task.findById(task._id)).progress === 100);
  await json(leaderToken, "PUT", `/leader/tasks/${task._id}`, { progress: 0 });

  /* ------------------------------------------- 4. the developer works it */

  section("The developer reports progress");

  const mine = await json(devToken, "GET", "/employee/tasks");
  check("the task is on the developer's list", (mine.data?.items || []).some((t) => String(t._id) === String(task._id)));

  const moved = await json(devToken, "PUT", `/employee/tasks/${task._id}`, { progress: 40 });
  check("progress alone is a valid update", moved.status === 200, moved.data?.message);

  const at40 = await Task.findById(task._id);
  check("the figure is stored", at40.progress === 40);
  check("and reporting work started it", at40.status === "in_progress");

  const rolled = await Project.findById(project._id);
  check("the project's own progress followed the task", rolled.progress === 40, `${rolled.progress}%`);

  const notMine = await json(outsiderToken, "PUT", `/employee/tasks/${task._id}`, { progress: 90 });
  check("somebody else's task is not theirs to move", notMine.status === 404);

  const cheat = await json(devToken, "PUT", `/employee/tasks/${task._id}`, { status: "completed" });
  check("a developer cannot mark their own work complete", cheat.status === 400, cheat.data?.message);

  const submitted = await json(devToken, "PUT", `/employee/tasks/${task._id}`, {
    status: "review",
    progress: 100,
  });
  check("they submit it for review", submitted.status === 200);
  check("still unearned while it sits in review", !(await Task.findById(task._id)).bonusAwardedAt);

  /* ------------------------------------------------- 5. approval and bonus */

  section("The manager approves, and the bonus lands");

  const approved = await json(leaderToken, "PUT", `/leader/review/${task._id}`, {
    decision: "approve",
    reviewRating: 5,
    reviewNote: "Good work",
  });
  check("the manager approves it", approved.status === 200, approved.data?.message);

  const done = await Task.findById(task._id);
  check("the task is complete", done.status === "completed");
  check("the bonus is recorded", Boolean(done.bonusAwardedAt));
  check("and completion forces progress to 100", done.progress === 100);

  const bonuses = await json(devToken, "GET", "/employee/bonuses");
  check("the developer can see what they earned", bonuses.data?.totals?.earned === 2000, String(bonuses.data?.totals?.earned));

  const leaderBonuses = await json(leaderToken, "GET", "/leader/bonuses");
  const paidTo = (leaderBonuses.data?.people || []).find(
    (p) => String(p.employee?._id) === String(developer._id)
  );
  check("the manager sees who it went to", paidTo?.earned === 2000, String(paidTo?.earned));

  const sentBack = await json(leaderToken, "PUT", `/leader/review/${task._id}`, {
    decision: "rework",
    reviewNote: "One more thing",
  });
  check("sending it back un-earns the bonus", sentBack.status === 200 && !(await Task.findById(task._id)).bonusAwardedAt);

  await json(leaderToken, "PUT", `/leader/review/${task._id}`, { decision: "approve" });
  check("re-approving earns it again", Boolean((await Task.findById(task._id)).bonusAwardedAt));

  /* ---------------------------------------------- 6. what the client sees */

  section("The client watches their own project");

  const progress = await json(clientToken, "GET", "/client/progress");
  const row = (progress.data?.items || []).find((p) => String(p.id) === String(project._id));
  check("their project is on their progress screen", Boolean(row));
  check("with the total work", row?.tasks === 1, String(row?.tasks));
  check("the completed work", row?.tasksCompleted === 1);
  check("what is left", row?.tasksRemaining === 0);
  check("and a progress percentage", row?.taskProgress === 100);
  check("no budget reaches the client", row?.budget === undefined);

  const projectList = await json(clientToken, "GET", "/client/projects");
  const listed = (projectList.data?.items || []).find((p) => String(p._id) === String(project._id));
  check("nor through the project list", listed && listed.budget === undefined);

  const clientDash = await json(clientToken, "GET", "/client/dashboard");
  check("nor on their dashboard", clientDash.data?.stats?.totalBudget === undefined);

  const noMoney = await json(clientToken, "GET", `/admin/project-payments/${project._id}`);
  check("a client token cannot reach the payments route", noMoney.status === 401 || noMoney.status === 403);

  /* --------------------------------------- 7. the estimate, on real data */

  section("The estimated finish, from the work itself");

  const blank = estimateCompletion({ status: "planning", startDate: new Date() }, { total: 0, completed: 0 });
  check("no tasks means no date, and says why", blank.estimatedDate === null && /nothing to measure/.test(blank.basis));

  const started = new Date();
  started.setDate(started.getDate() - 10);
  const halfway = estimateCompletion(
    { status: "in_progress", startDate: started },
    { total: 10, completed: 5 }
  );
  check("five in ten days projects ten more days", halfway.daysNeeded === 10, String(halfway.daysNeeded));
  check("and shows its working", /5 of 10 tasks finished in 10 days/.test(halfway.basis), halfway.basis);

  const stalled = estimateCompletion(
    { status: "in_progress", startDate: started },
    { total: 4, completed: 0 }
  );
  check("nothing finished means no guess", stalled.estimatedDate === null && /no rate to project from/.test(stalled.basis));

  /* ------------------------------------------------- 8. a change request */

  section("The client asks for a change");

  const raised = await json(clientToken, "POST", "/client/change-requests", {
    project: String(project._id),
    title: "Move the pricing section up",
    detail: "It should sit above the testimonials",
    priority: "high",
  });
  check("the client raises one", raised.status === 201, raised.data?.message);
  const requestId = raised.data?.item?._id;

  const otherProject = await Project.create({ name: "Not theirs", status: "planning" });
  const wrongProject = await json(clientToken, "POST", "/client/change-requests", {
    project: String(otherProject._id),
    title: "Should be refused",
  });
  check("but not against somebody else's project", wrongProject.status === 404);
  await Project.deleteOne({ _id: otherProject._id });

  const teamSees = await json(leaderToken, "GET", "/leader/change-requests");
  check("the manager sees it", (teamSees.data?.items || []).some((r) => String(r._id) === String(requestId)));
  check("counted as outstanding", teamSees.data?.counts?.outstanding >= 1);

  const clientAssign = await json(clientToken, "PUT", `/client/change-requests/${requestId}/assign`, {
    assignedTo: String(developer._id),
  });
  check("a client cannot choose who does it", clientAssign.status === 404 || clientAssign.status === 403);

  const offProject = await json(leaderToken, "PUT", `/leader/change-requests/${requestId}/assign`, {
    assignedTo: String(outsider._id),
  });
  check("nor can it go to somebody off the project", offProject.status === 400, offProject.data?.message);

  const handedOver = await json(leaderToken, "PUT", `/leader/change-requests/${requestId}/assign`, {
    assignedTo: String(developer._id),
  });
  check("the manager hands it to the developer", handedOver.status === 200, handedOver.data?.message);

  const devSees = await json(devToken, "GET", "/employee/change-requests?view=mine");
  check("it reaches the developer", (devSees.data?.items || []).some((r) => String(r._id) === String(requestId)));

  const worked = await json(devToken, "PUT", `/employee/change-requests/${requestId}`, {
    progress: 60,
    note: "Section moved, checking the spacing",
  });
  check("they report progress on it", worked.status === 200);
  check("which is recorded", worked.data?.item?.progress === 60);

  const devReject = await json(devToken, "PUT", `/employee/change-requests/${requestId}`, {
    status: "rejected",
    note: "Not doing it",
  });
  check("a developer cannot turn a client down", devReject.status === 403, devReject.data?.message);

  const finished = await json(devToken, "PUT", `/employee/change-requests/${requestId}`, {
    status: "completed",
    note: "Done and deployed",
  });
  check("they can finish it", finished.status === 200);
  check("which squares the progress off", finished.data?.item?.progress === 100);

  const clientReads = await json(clientToken, "GET", `/client/change-requests/${requestId}`);
  check("the client can read the whole history", (clientReads.data?.item?.updates || []).length >= 4, `${clientReads.data?.item?.updates?.length} entries`);
  check("including who wrote each entry", clientReads.data.item.updates.every((u) => u.authorName));

  const adminHistory = await json(adminToken, "GET", "/admin/change-requests");
  check("the admin monitors all of them", (adminHistory.data?.items || []).some((r) => String(r._id) === String(requestId)));

  const outsiderPeek = await json(outsiderToken, "GET", "/employee/change-requests");
  check(
    "somebody off the project sees none of it",
    !(outsiderPeek.data?.items || []).some((r) => String(r._id) === String(requestId))
  );

  /* ---------------------------------------------- 9. money, admin only */

  section("The money, and who may read it");

  const invoice = await Invoice.create({
    number: `FLOW-TEST-${Date.now()}`,
    client: client._id,
    project: project._id,
    title: "Phase one",
    total: 300000,
    status: "sent",
    dueOn: new Date(Date.now() - 5 * 86400000),
    payments: [{ amount: 100000, mode: "bank_transfer", reference: "TESTREF", recordedByName: "Test" }],
  });
  invoice.settleStatus();
  await invoice.save();

  const money = await json(adminToken, "GET", `/admin/project-payments/${project._id}`);
  check("the admin reads the project's money", money.status === 200, money.data?.message);
  check("the contract value", money.data?.totals?.contractValue === 500000);
  check("what has been invoiced", money.data?.totals?.invoiced === 300000);
  check("what has been paid", money.data?.totals?.paid === 100000);
  check("what is outstanding", money.data?.totals?.outstanding === 200000);
  check("and what was never billed", money.data?.totals?.unbilled === 200000);
  check("the payment history is there", (money.data?.history || []).length === 1);
  check("with its reference and date", money.data.history[0].reference === "TESTREF" && Boolean(money.data.history[0].receivedOn));
  check("the pending invoice is flagged overdue", money.data?.pending?.[0]?.overdue === true);

  const overview = await json(adminToken, "GET", "/admin/project-payments");
  check("the overview lists it too", (overview.data?.items || []).some((p) => String(p._id) === String(project._id)));

  for (const [who, token] of [
    ["sales", salesToken],
    ["the operations manager", leaderToken],
    ["the developer", devToken],
    ["the client", clientToken],
  ]) {
    const peek = await json(token, "GET", `/admin/project-payments/${project._id}`);
    check(`${who} cannot reach it`, peek.status === 401 || peek.status === 403, String(peek.status));
  }

  /* ----------------------------------------------------------- 10. audit */

  section("What was written down");

  const logs = await json(adminToken, "GET", "/admin/activity-logs?limit=100");
  const messages = (logs.data?.items || []).map((l) => l.message || "").join(" | ");
  check("the handover is in the activity log", /handed to Ops Manager for delivery/.test(messages));
  check("so is the change request", /requested a change/.test(messages));

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
