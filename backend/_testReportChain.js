// The reporting hierarchy, end to end.
//
//   Team Member  --member_update-->  Manager
//   Manager      --team_update---->  HR
//   HR           --hr_report------>  Admin
//
// and the answer travelling back down. Sales and Operations are separate
// departments throughout, with separate managers, teams and figures.
//
// Records are seeded straight into Mongo — creating staff through the admin API
// requires the full onboarding pack, which is a rule about the joining form and
// has nothing to do with what is under test.
//
// Run against a server started on PORT_UNDER_TEST (default 5099).
import dotenv from "dotenv";
import mongoose from "mongoose";

import Notification from "./models/Notification.js";
import Report from "./models/Report.js";
import Team from "./models/Team.js";
import User from "./models/User.js";
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

const TAG = `rc_${Date.now()}`;
const made = { users: [], teams: [], reports: [] };

const PW = "9800000000";

const seedUser = async (role, name) => {
  const person = await User.create({
    name: `${name} ${TAG}`,
    email: `${name.toLowerCase()}.${TAG}@example.com`,
    password: hashPassword(PW),
    role,
    phone: PW,
    status: "active",
  });
  made.users.push(person._id);
  return person;
};

const cleanup = async () => {
  await Report.deleteMany({ $or: [{ author: { $in: made.users } }, { team: { $in: made.teams } }] });
  await Team.deleteMany({ _id: { $in: made.teams } });
  await Notification.deleteMany({ user: { $in: made.users } });
  await User.deleteMany({ _id: { $in: made.users } });
  await User.deleteMany({ email: new RegExp(TAG) });
};

const now = new Date();
const YEAR = now.getFullYear();
const MONTH = now.getMonth() + 1;

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  /* ------------------------------------------------------- the org chart */

  console.log("\n▸ Building the hierarchy");

  const hrHead = await seedUser("hr", "ChainHR");
  const salesMgr = await seedUser("manager", "SalesMgr");
  const opsMgr = await seedUser("manager", "OpsMgr");
  const salesMember = await seedUser("employee", "SalesMember");
  const opsMember = await seedUser("employee", "OpsMember");

  const salesTeam = await Team.create({
    name: `Sales ${TAG}`,
    kind: "sales",
    manager: salesMgr._id,
    members: [salesMember._id],
    active: true,
  });
  const opsTeam = await Team.create({
    name: `Operations ${TAG}`,
    kind: "operations",
    manager: opsMgr._id,
    members: [opsMember._id],
    active: true,
  });
  made.teams.push(salesTeam._id, opsTeam._id);

  const signIn = async (person, panel) =>
    (await call(null, "POST", `/${panel}/login`, { email: person.email, password: PW })).data
      ?.token;

  const [hrToken, salesMgrToken, opsMgrToken, memberToken, opsMemberToken] = await Promise.all([
    signIn(hrHead, "hr"),
    signIn(salesMgr, "leader"),
    signIn(opsMgr, "leader"),
    signIn(salesMember, "employee"),
    signIn(opsMember, "employee"),
  ]);

  check("an HR head signs in", Boolean(hrToken));
  check("both department managers sign in", Boolean(salesMgrToken) && Boolean(opsMgrToken));
  check("both team members sign in", Boolean(memberToken) && Boolean(opsMemberToken));

  const adminToken = (
    await call(null, "POST", "/admin/login", {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    })
  ).data?.token;
  check("an administrator signs in", Boolean(adminToken));

  /* ---------------------------------------------- who reports to whom */

  console.log("\n▸ Everybody knows who is above them");

  const memberCtx = await call(memberToken, "GET", "/employee/reports/context");
  check("a member writes a member update", memberCtx.data?.kind === "member_update");
  check(
    "and it goes to their department manager",
    memberCtx.data?.goesTo?.name?.includes("SalesMgr"),
    memberCtx.data?.goesTo?.name
  );
  check("their department is known", memberCtx.data?.department === "sales", memberCtx.data?.department);

  const mgrCtx = await call(salesMgrToken, "GET", "/leader/reports/context");
  check("a manager writes a team update", mgrCtx.data?.kind === "team_update");
  check(
    "and it goes to HR as a function, not one person",
    mgrCtx.data?.goesTo?.name === "HR" && mgrCtx.data?.goesTo?.count >= 1,
    `${mgrCtx.data?.goesTo?.name} (${mgrCtx.data?.goesTo?.count})`
  );

  const hrCtx = await call(hrToken, "GET", "/hr/reports/context");
  check("HR writes an HR report", hrCtx.data?.kind === "hr_report");
  check("and it goes to the administrators", hrCtx.data?.goesTo?.count >= 1, hrCtx.data?.goesTo?.name);

  /* -------------------------------------------------- 1. member → manager */

  console.log("\n▸ 1. Team Member → Manager");

  const memberReport = await call(memberToken, "POST", "/employee/reports", {
    title: `Sales week ${TAG}`,
    summary: "Called twelve leads.",
    highlights: ["Closed the Sharma deal"],
    blockers: ["Waiting on pricing approval"],
    metrics: { calls: 12 },
    year: YEAR,
    month: MONTH,
  });
  check("a member submits their update", memberReport.status === 201, memberReport.data?.message);
  made.reports.push(memberReport.data?.item?._id);
  check("it is addressed to the manager", memberReport.data?.item?.submittedToName?.includes("SalesMgr"));
  check("and is marked submitted", memberReport.data?.item?.status === "submitted");

  const mgrInbox = await call(salesMgrToken, "GET", "/leader/reports/inbox");
  check(
    "it lands in the manager's inbox",
    mgrInbox.data?.items?.some((r) => String(r._id) === String(memberReport.data.item._id))
  );
  check("the inbox counts the blockers", mgrInbox.data?.blockers >= 1, `${mgrInbox.data?.blockers}`);

  const otherMgrInbox = await call(opsMgrToken, "GET", "/leader/reports/inbox");
  check(
    "and NOT in the other department's manager's inbox",
    !otherMgrInbox.data?.items?.some((r) => String(r._id) === String(memberReport.data.item._id))
  );

  const reviewed = await call(
    salesMgrToken,
    "PUT",
    `/leader/reports/${memberReport.data.item._id}/review`,
    { note: "Read, thanks" }
  );
  check("the manager marks it read", reviewed.status === 200, reviewed.data?.message);
  check("which is not the same as answering it", reviewed.data?.item?.status === "reviewed");

  const memberTold = await Notification.countDocuments({
    user: salesMember._id,
    title: /read your report/i,
  });
  check("the member is told it was read", memberTold === 1);

  /* ------------------------------------------------------ 2. manager → HR */

  console.log("\n▸ 2. Manager → HR");

  const teamUpdate = await call(salesMgrToken, "POST", "/leader/reports", {
    title: `Sales team ${TAG}`,
    summary: "Team closed four deals.",
    blockers: ["Pricing approval is slow"],
    sources: [memberReport.data.item._id],
    year: YEAR,
    month: MONTH,
  });
  check("the manager submits a team update", teamUpdate.status === 201, teamUpdate.data?.message);
  made.reports.push(teamUpdate.data?.item?._id);
  check("it goes to HR", teamUpdate.data?.item?.submittedToName === "HR");
  check(
    "and names the member update it summarises",
    teamUpdate.data?.item?.sources?.length === 1
  );

  const rolled = await Report.findById(memberReport.data.item._id).select("rolledInto");
  check(
    "the member update knows it was rolled up",
    String(rolled.rolledInto) === String(teamUpdate.data.item._id)
  );

  const hrInbox = await call(hrToken, "GET", "/hr/reports/inbox");
  check(
    "HR sees it",
    hrInbox.data?.items?.some((r) => String(r._id) === String(teamUpdate.data.item._id))
  );

  const answered = await call(
    hrToken,
    "PUT",
    `/hr/reports/${teamUpdate.data.item._id}/respond`,
    { note: "Pricing approval is with the admin — chasing." }
  );
  check("HR answers it", answered.status === 200, answered.data?.message);
  check("which is recorded as answered, not just read", answered.data?.item?.status === "responded");

  const mgrSees = await call(salesMgrToken, "GET", "/leader/reports/mine");
  const mine = mgrSees.data?.items?.find((r) => String(r._id) === String(teamUpdate.data.item._id));
  check("the manager sees the answer come back", mine?.response?.note?.includes("Pricing"));
  check("and their outbox counts it as answered", mgrSees.data?.answered >= 1);

  /* --------------------------------------------------------- 3. HR → Admin */

  console.log("\n▸ 3. HR → Admin");

  const hrReport = await call(hrToken, "POST", "/hr/reports", {
    title: `Company ${TAG}`,
    summary: "Two departments reporting, one blocker outstanding.",
    blockers: ["Pricing approval"],
    sources: [teamUpdate.data.item._id],
    year: YEAR,
    month: MONTH,
  });
  check("HR submits to the administrators", hrReport.status === 201, hrReport.data?.message);
  made.reports.push(hrReport.data?.item?._id);
  check("addressed to the administrators as a body", hrReport.data?.item?.submittedToName === "Administrators");

  const adminInbox = await call(adminToken, "GET", "/admin/reports/chain/inbox");
  check(
    "the admin sees it",
    adminInbox.data?.items?.some((r) => String(r._id) === String(hrReport.data.item._id))
  );

  const adminAnswer = await call(
    adminToken,
    "PUT",
    `/admin/reports/chain/${hrReport.data.item._id}/respond`,
    { note: "Pricing approved. Tell the team." }
  );
  check("and answers it", adminAnswer.status === 200, adminAnswer.data?.message);

  const hrOutbox = await call(hrToken, "GET", "/hr/reports/mine");
  check(
    "HR sees the admin's answer",
    hrOutbox.data?.items?.some((r) => r.response?.note?.includes("Pricing approved"))
  );

  /* -------------------------------------------------------- the drill-down */

  console.log("\n▸ Following the chain back down");

  const drill = await call(adminToken, "GET", `/admin/reports/chain/${hrReport.data.item._id}`);
  check("the admin can open the HR report", drill.status === 200);
  check(
    "and see the team update underneath it",
    drill.data?.item?.sources?.some((s) => String(s._id) === String(teamUpdate.data.item._id))
  );

  const deepest = await call(adminToken, "GET", `/admin/reports/chain/${memberReport.data.item._id}`);
  check(
    "and open the individual member update behind the figure",
    deepest.status === 200 && deepest.data?.item?.title?.includes("Sales week")
  );

  /* --------------------------------------------------- department separation */

  console.log("\n▸ Sales and Operations stay separate");

  const opsReport = await call(opsMemberToken, "POST", "/employee/reports", {
    title: `Ops week ${TAG}`,
    summary: "Two deliveries.",
    year: YEAR,
    month: MONTH,
  });
  made.reports.push(opsReport.data?.item?._id);
  check("an operations member reports to the operations manager", opsReport.status === 201);
  check(
    "tagged to the operations department",
    opsReport.data?.item?.department === "operations",
    opsReport.data?.item?.department
  );

  const opsInbox = await call(opsMgrToken, "GET", "/leader/reports/inbox");
  check(
    "it reaches the operations manager only",
    opsInbox.data?.items?.some((r) => String(r._id) === String(opsReport.data.item._id))
  );
  const salesInboxAgain = await call(salesMgrToken, "GET", "/leader/reports/inbox");
  check(
    "and never the sales manager",
    !salesInboxAgain.data?.items?.some((r) => String(r._id) === String(opsReport.data.item._id))
  );

  const perf = await call(adminToken, "GET", "/admin/reports/chain/departments");
  const sales = perf.data?.departments?.find((d) => d.department === "sales");
  const ops = perf.data?.departments?.find((d) => d.department === "operations");
  check("the admin sees both departments separately", Boolean(sales) && Boolean(ops));
  check(
    "each with its own teams and headcount",
    sales?.teams?.length >= 1 && ops?.teams?.length >= 1,
    `sales ${sales?.teams?.length} teams, ops ${ops?.teams?.length}`
  );
  check("and its own manager named", sales?.teams?.some((t) => t.manager?.name?.includes("SalesMgr")));

  /* -------------------------------------------------------- the refusals */

  console.log("\n▸ What the chain refuses");

  /**
   * Asking to file a team update as a member. Next month, so the one-per-month
   * rule is not what refuses it — the point is that `kind` is ignored, not
   * that a duplicate is caught.
   */
  const nextMonth = MONTH === 12 ? 1 : MONTH + 1;
  const nextYear = MONTH === 12 ? YEAR + 1 : YEAR;

  const skipLevel = await call(memberToken, "POST", "/employee/reports", {
    title: `Trying to file a team update ${TAG}`,
    kind: "team_update",
    year: nextYear,
    month: nextMonth,
  });
  const filed = await Report.findById(skipLevel.data?.item?._id).select("kind submittedTo");
  check(
    "a member asking to file a team update still files a member update",
    filed?.kind === "member_update",
    `filed as ${filed?.kind}`
  );
  check(
    "and it still goes to their manager, not HR",
    String(filed?.submittedTo) === String(salesMgr._id)
  );

  const twice = await call(memberToken, "POST", "/employee/reports", {
    title: `Second attempt ${TAG}`,
    year: YEAR,
    month: MONTH,
  });
  check(
    "a second report for a month already read is refused",
    twice.status === 409,
    twice.data?.message
  );

  const notMine = await call(
    opsMgrToken,
    "PUT",
    `/leader/reports/${memberReport.data.item._id}/review`,
    { note: "not mine" }
  );
  check("a manager cannot review another department's report", notMine.status === 403, notMine.data?.message);

  const peek = await call(opsMemberToken, "GET", `/employee/reports/${memberReport.data.item._id}`);
  check("a member cannot read a colleague's report", peek.status === 403, peek.data?.message);

  const emptyResponse = await call(
    hrToken,
    "PUT",
    `/hr/reports/${teamUpdate.data.item._id}/respond`,
    { note: "" }
  );
  check("an empty response is refused", emptyResponse.status === 400, emptyResponse.data?.message);

  const withdrawRead = await call(
    salesMgrToken,
    "DELETE",
    `/leader/reports/${teamUpdate.data.item._id}`
  );
  check(
    "a report that has been read cannot be withdrawn",
    withdrawRead.status === 409,
    withdrawRead.data?.message
  );

  /* ------------------------------------------------- the gaps are visible */

  console.log("\n▸ The chain says where it is broken");

  const orphan = await seedUser("employee", "Orphan");
  const orphanToken = await signIn(orphan, "employee");
  const orphanCtx = await call(orphanToken, "GET", "/employee/reports/context");
  check("somebody on no team is told they cannot report yet", orphanCtx.data?.blocked === true);

  const orphanTry = await call(orphanToken, "POST", "/employee/reports", {
    title: "Nowhere to send this",
    year: YEAR,
    month: MONTH,
  });
  check("and submitting is refused with a reason", orphanTry.status === 409, orphanTry.data?.message);

  const org = await call(adminToken, "GET", "/admin/reports/chain/org");
  check(
    "the org chart names people with nobody above them",
    org.data?.gaps?.unattached?.some((p) => p.name.includes("Orphan"))
  );
  check("and lists both departments", org.data?.departments?.length >= 2);

  /* ------------------------------------------------ nothing else regressed */

  console.log("\n▸ The rest of the panels still work");

  for (const [token, route, panel] of [
    [adminToken, "/admin/dashboard", "admin"],
    [hrToken, "/hr/dashboard", "hr"],
    [salesMgrToken, "/leader/dashboard", "leader"],
    [memberToken, "/employee/dashboard", "employee"],
  ]) {
    const res = await call(token, "GET", route);
    check(`${panel} dashboard still answers`, res.status === 200, `HTTP ${res.status}`);
  }
};

run()
  .catch((err) => {
    console.error("\n💥 " + (err?.stack || err));
    fail += 1;
    failures.push(`threw: ${err?.message}`);
  })
  .finally(async () => {
    await cleanup().catch((err) => console.error("cleanup:", err.message));
    await mongoose.disconnect();

    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${pass} passed, ${fail} failed`);
    if (failures.length) {
      console.log("\n  Failures:");
      failures.forEach((f) => console.log("   ✗ " + f));
    }
    console.log(`${"─".repeat(60)}\n`);
    process.exit(fail ? 1 : 0);
  });
