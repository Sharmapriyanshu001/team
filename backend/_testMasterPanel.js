// The admin panel as the master control panel, end to end.
//
//   every route that worked before still works
//   an admin is unrestricted, exactly as before
//   several HR accounts can exist at once, and each signs in as itself
//   a department account reaches its own department and is refused everywhere else
//   HR's leave and recruitment run on the real collections
//   a lead becomes a client, is handed to Operations, and Client 360 joins it up
//
// Run against a server started on PORT_UNDER_TEST (default 5099). Everything it
// creates is removed at the end, including on failure.
import dotenv from "dotenv";
import mongoose from "mongoose";

import Candidate from "./models/Candidate.js";
import Client from "./models/Client.js";
import Lead from "./models/Lead.js";
import Project from "./models/Project.js";
import Leave from "./models/Leave.js";
import LeavePolicy from "./models/LeavePolicy.js";
import User from "./models/User.js";

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

/** A tag on everything this run creates, so cleanup can find it all. */
const TAG = `mptest_${Date.now()}`;
const made = {
  users: [],
  clients: [],
  projects: [],
  leads: [],
  leaves: [],
  candidates: [],
  policies: [],
};

const cleanup = async () => {
  await Promise.all([
    User.deleteMany({ _id: { $in: made.users } }),
    Client.deleteMany({ _id: { $in: made.clients } }),
    Project.deleteMany({ _id: { $in: made.projects } }),
    Lead.deleteMany({ _id: { $in: made.leads } }),
    Leave.deleteMany({ _id: { $in: made.leaves } }),
    Candidate.deleteMany({ _id: { $in: made.candidates } }),
    LeavePolicy.deleteMany({ _id: { $in: made.policies } }),
  ]);
  // Anything a route created on its own (a hire's account, a conversion's
  // client) is caught by the tag rather than by an id we remembered
  await Promise.all([
    User.deleteMany({ email: new RegExp(TAG) }),
    Client.deleteMany({ email: new RegExp(TAG) }),
    Project.deleteMany({ name: new RegExp(TAG) }),
  ]);
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  /* ------------------------------------------------------- admin signs in */

  console.log("\n▸ Admin");

  const login = await call(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  check("admin signs in", login.status === 200, login.data?.message);
  if (login.status !== 200) throw new Error("cannot continue without an admin token");

  const admin = login.data.token;

  const me = await call(admin, "GET", "/admin/me");
  check("admin is unrestricted, as before", me.data?.permissions?.unrestricted === true);
  check("admin reports as a full admin", me.data?.permissions?.isFullAdmin === true);

  /* --------------------------------------- every existing route still works */

  console.log("\n▸ Existing routes (regression)");

  const EXISTING = [
    "/admin/dashboard",
    "/admin/clients",
    "/admin/employees",
    "/admin/operations-managers",
    "/admin/managers",
    "/admin/employees/performance",
    "/admin/operations-managers/performance",
    "/admin/attendance/summary",
    "/admin/projects",
    "/admin/tasks",
    "/admin/issues",
    "/admin/files",
    "/admin/reports",
    "/admin/activity-logs",
    "/admin/roles",
    "/admin/roles/meta",
    "/admin/settings",
    "/admin/lookups",
    "/admin/notifications",
    "/admin/meetings",
    "/admin/crm/leads",
    "/admin/crm/pipeline",
    "/admin/crm/quotations",
    "/admin/crm/invoices",
    "/admin/crm/services",
    "/admin/crm/receivables",
    "/admin/teams",
    "/admin/teams/overview",
    "/admin/targets",
    "/admin/portfolio",
    "/admin/ads/overview",
    "/admin/ads/accounts",
    "/admin/seo/projects",
    "/admin/play/overview",
    "/admin/play/consoles",
    "/admin/play/apps",
    "/admin/code-projects",
    "/admin/code",
    "/admin/code-share/people",
  ];

  for (const route of EXISTING) {
    const res = await call(admin, "GET", route);
    check(`GET ${route}`, res.status === 200, res.status === 200 ? "" : `HTTP ${res.status}`);
  }

  /* ------------------------------------------- many HR accounts, not just one */

  console.log("\n▸ Department accounts — several HR at once");

  const meta = await call(admin, "GET", "/admin/department-accounts/meta");
  check(
    "the panel offers every department account",
    // Grows as departments are added — assert the shape, not a frozen list
    ["hr", "sales", "operations"].every((role) =>
      meta.data?.departments?.some((d) => d.value === role)
    ),
    JSON.stringify(meta.data?.departments?.map((d) => d.value))
  );
  /**
   * There is one login now, so the path no longer varies by department — the
   * server works out the panel from the role after the password is checked.
   * What still has to vary is the label: an administrator handing over a
   * login needs to be able to say "this is a Sales account", even though the
   * door is the same door.
   */
  check(
    "every department signs in at the same address",
    meta.data?.departments?.every((d) => d.portal?.path === "/"),
    JSON.stringify(meta.data?.departments?.map((d) => d.portal?.path))
  );
  check(
    "and each still says which panel it is",
    meta.data.departments.find((d) => d.value === "hr")?.portal.label === "HR panel" &&
      meta.data.departments.find((d) => d.value === "sales")?.portal.label === "Sales panel" &&
      meta.data.departments.find((d) => d.value === "operations")?.portal.label === "Admin panel"
  );

  const hrAccounts = [];
  for (let i = 1; i <= 4; i += 1) {
    const created = await call(admin, "POST", "/admin/department-accounts", {
      name: `HR Person ${i}`,
      email: `hr${i}.${TAG}@example.com`,
      role: "hr",
      phone: `90000000${i}${i}`,
      designation: "HR Executive",
    });

    check(`HR account ${i} of 4 created`, created.status === 201, created.data?.message);
    if (created.status === 201) {
      hrAccounts.push({
        id: created.data.item._id,
        email: created.data.credentials.loginId,
        password: created.data.credentials.password,
      });
      made.users.push(created.data.item._id);
    }
  }

  check("four HR accounts exist side by side", hrAccounts.length === 4, `${hrAccounts.length} made`);

  const listed = await call(admin, "GET", "/admin/department-accounts?role=hr");
  check(
    "all four show in the admin's list",
    listed.data?.items?.filter((row) => row.email.includes(TAG)).length === 4
  );
  check(
    "the list counts HR without a ceiling",
    (listed.data?.byDepartment?.hr?.total || 0) >= 4,
    `total ${listed.data?.byDepartment?.hr?.total}`
  );

  /**
   * Each one is a separate login, and it opens the HR panel rather than this
   * one. HR was moved out of the admin door when it got a panel of its own —
   * see backend/routes/hrRoutes.js — so an HR account is refused here and
   * accepted there, which is the isolation the split exists for.
   */
  const hrTokens = [];
  for (const account of hrAccounts) {
    const signIn = await call(null, "POST", "/hr/login", {
      email: account.email,
      password: account.password,
    });
    if (signIn.status === 200) hrTokens.push(signIn.data.token);
  }
  check("every HR account signs in at the HR panel", hrTokens.length === 4, `${hrTokens.length} of 4`);

  check(
    "and none of them can sign in at the admin panel",
    (await call(null, "POST", "/admin/login", {
      email: hrAccounts[0].email,
      password: hrAccounts[0].password,
    })).status === 403
  );

  const hrMe = await call(hrTokens[0], "GET", "/hr/me");
  check("an HR account is the HR head here", hrMe.data?.access?.isHrAdmin === true);
  check(
    "and its token is refused by the admin panel",
    (await call(hrTokens[0], "GET", "/admin/dashboard")).status === 403
  );

  const duplicate = await call(admin, "POST", "/admin/department-accounts", {
    name: "Duplicate",
    email: hrAccounts[0].email,
    role: "hr",
    phone: "9000000099",
  });
  check("a second account cannot take the same email", duplicate.status === 409);

  /* ------------------------------------ a department stays inside its department */

  console.log("\n▸ Department boundaries");

  const hr = hrTokens[0];

  /**
   * HR's own boundary is not a permission any more — it is the routing table.
   * Its whole panel is exercised by _testHrPanel.js; what matters here is that
   * an HR token reaches nothing at all on this side.
   */
  const hrRefused = [
    "/admin/hr/overview",
    "/admin/hr/leaves",
    "/admin/employees",
    "/admin/crm/leads",
    "/admin/crm/invoices",
    "/admin/vault",
    "/admin/ads/accounts",
    "/admin/portfolio",
    "/admin/roles",
    "/admin/department-accounts",
    "/admin/settings",
  ];
  for (const route of hrRefused) {
    const res = await call(hr, "GET", route);
    check(`an HR token is refused ${route}`, res.status === 403, `HTTP ${res.status}`);
  }

  // Sales
  const salesMade = await call(admin, "POST", "/admin/department-accounts", {
    name: "Sales Person",
    email: `sales.${TAG}@example.com`,
    role: "sales",
    phone: "9111111111",
  });
  check("a Sales account is created", salesMade.status === 201, salesMade.data?.message);
  if (salesMade.status === 201) made.users.push(salesMade.data.item._id);

  /**
   * Sales has a panel of its own now, the same way HR does, so a sales token
   * is refused by this one outright rather than being scoped inside it. Its
   * own behaviour is covered by the sales suite; what matters here is that it
   * reaches nothing on the admin side.
   */
  const salesLogin = await call(null, "POST", "/sales/login", {
    email: salesMade.data.credentials.loginId,
    password: salesMade.data.credentials.password,
  });
  const sales = salesLogin.data?.token;
  check("Sales signs in at its own panel", salesLogin.status === 200, salesLogin.data?.message);

  check(
    "and is refused by the admin login",
    (await call(null, "POST", "/admin/login", {
      email: salesMade.data.credentials.loginId,
      password: salesMade.data.credentials.password,
    })).status === 403
  );

  for (const route of [
    "/admin/crm/leads",
    "/admin/clients",
    "/admin/hr/leaves",
    "/admin/hr/candidates",
    "/admin/department-accounts",
    "/admin/dashboard",
  ]) {
    const res = await call(sales, "GET", route);
    check(`a Sales token is refused ${route}`, res.status === 403, `HTTP ${res.status}`);
  }

  check(
    "Sales cannot mint accounts",
    (await call(sales, "POST", "/admin/department-accounts", {
      name: "Sneaky",
      email: `sneaky.${TAG}@example.com`,
      role: "hr",
      phone: "9222222222",
    })).status === 403
  );

  // Operations
  const opsMade = await call(admin, "POST", "/admin/department-accounts", {
    name: "Ops Person",
    email: `ops.${TAG}@example.com`,
    role: "operations",
    phone: "9333333333",
  });
  check("an Operations account is created", opsMade.status === 201, opsMade.data?.message);
  if (opsMade.status === 201) made.users.push(opsMade.data.item._id);

  const opsLogin = await call(null, "POST", "/admin/login", {
    email: opsMade.data.credentials.loginId,
    password: opsMade.data.credentials.password,
  });
  const ops = opsLogin.data?.token;

  check("Operations reaches projects", (await call(ops, "GET", "/admin/projects")).status === 200);
  check("Operations reaches tasks", (await call(ops, "GET", "/admin/tasks")).status === 200);
  check("Operations reads clients", (await call(ops, "GET", "/admin/clients")).status === 200);
  check(
    "Operations cannot delete a client",
    (await call(ops, "DELETE", "/admin/clients/000000000000000000000000")).status === 403
  );
  check(
    "Operations is refused the pipeline",
    (await call(ops, "GET", "/admin/crm/leads")).status === 403
  );

  /* -------------------------------------------- deactivating cuts access off */

  const off = await call(admin, "PUT", `/admin/department-accounts/${hrAccounts[3].id}`, {
    status: "inactive",
  });
  check("an HR account can be deactivated", off.status === 200, off.data?.message);
  /**
   * Either refusal is correct and which one comes back depends on the order of
   * two checks in adminAuth: the inactive-account check answers 403 and sits
   * above the token-version check, which answers 401. Both end the session —
   * pinning the test to one of them would be testing the order, not the rule.
   */
  const deadSession = await call(hrTokens[3], "GET", "/hr/dashboard");
  check(
    "a deactivated account's live session stops working",
    [401, 403].includes(deadSession.status),
    `HTTP ${deadSession.status}`
  );
  check(
    "and it can no longer sign in",
    (await call(null, "POST", "/hr/login", {
      email: hrAccounts[3].email,
      password: hrAccounts[3].password,
    })).status === 403
  );

  /* --------------------------------------------------------------- HR work */

  console.log("\n▸ HR — leave and recruitment on real data");

  /**
   * Run as the administrator. The admin panel keeps its own HR section — it is
   * the master control panel, and a director asking how many people are away
   * should not have to sign in somewhere else — so these are the same records
   * reached through /admin/hr rather than /hr.
   */
  const hrActor = admin;

  const staff = await call(admin, "GET", "/admin/employees?limit=1");
  const someone = staff.data?.items?.[0];
  check("there is an employee to work with", Boolean(someone), someone?.name);

  /**
   * "earned" rather than "casual": the six policies already on file cover six
   * of the types, and the collection carries a unique index on `type` from an
   * earlier build. Adding a second casual policy is supposed to fail.
   */
  const policy = await call(hrActor, "POST", "/admin/hr/leave-policies", {
    name: `Earned ${TAG}`,
    type: "earned",
    annualQuota: 12,
    paid: true,
  });
  check("HR creates a leave policy", policy.status === 201, policy.data?.message);
  if (policy.status === 201) made.policies.push(policy.data.item._id);

  const secondCasual = await call(hrActor, "POST", "/admin/hr/leave-policies", {
    name: `Another casual ${TAG}`,
    type: "casual",
    annualQuota: 5,
  });
  check("a second policy for one type is refused", secondCasual.status === 400);
  check(
    "and the refusal names the policy in the way",
    /already the policy for casual/.test(secondCasual.data?.message || ""),
    secondCasual.data?.message
  );

  const leave = await call(hrActor, "POST", "/admin/hr/leaves", {
    employee: someone._id,
    type: "casual",
    fromDate: "2031-03-02",
    toDate: "2031-03-04",
    reason: `test leave ${TAG}`,
  });
  check("HR files a leave", leave.status === 201, leave.data?.message);
  if (leave.status === 201) made.leaves.push(leave.data.item._id);
  check("the days are counted, not taken on trust", leave.data?.item?.days === 3, `${leave.data?.item?.days}`);

  const clash = await call(hrActor, "POST", "/admin/hr/leaves", {
    employee: someone._id,
    type: "casual",
    fromDate: "2031-03-03",
    toDate: "2031-03-05",
    reason: "overlapping",
  });
  check("an overlapping leave is refused", clash.status === 400, clash.data?.message);

  const decided = await call(hrActor, "PUT", `/admin/hr/leaves/${leave.data.item._id}/decide`, {
    status: "approved",
    decisionNote: "fine",
  });
  check("HR approves it", decided.status === 200, decided.data?.message);
  check("the decision records who made it", Boolean(decided.data?.item?.decidedByName));

  // The test leave is in 2031, so the balance for 2031 is the one to ask for —
  // balances default to the current year, which is the right default and the
  // wrong question here.
  const balances = await call(hrActor, "GET", "/admin/hr/leaves/balances?year=2031");
  check("balances are computed from the approvals", balances.status === 200);
  const row = balances.data?.rows?.find((r) => String(r.employee._id) === String(someone._id));
  check("the approved days show against that person", row?.totalUsed === 3, `${row?.totalUsed}`);

  const existingLeaves = await call(hrActor, "GET", "/admin/hr/leaves");
  check(
    "leave rows already in the database are readable",
    existingLeaves.data?.total >= 4,
    `${existingLeaves.data?.total} rows`
  );

  const existingCandidates = await call(hrActor, "GET", "/admin/hr/candidates");
  check(
    "candidate rows already in the database are readable",
    existingCandidates.data?.total >= 1,
    `${existingCandidates.data?.total} rows`
  );

  const candidate = await call(hrActor, "POST", "/admin/hr/candidates", {
    name: `Test Candidate ${TAG}`,
    email: `cand.${TAG}@example.com`,
    phone: "9444444444",
    position: "Developer",
    stage: "applied",
    hireAs: "employee",
  });
  check("HR adds a candidate", candidate.status === 201, candidate.data?.message);
  if (candidate.status === 201) made.candidates.push(candidate.data.item._id);

  const candidateId = candidate.data.item._id;

  const interview = await call(hrActor, "POST", `/admin/hr/candidates/${candidateId}/interviews`, {
    round: "Technical",
    scheduledAt: "2031-04-01T10:00:00.000Z",
    mode: "online",
  });
  check("an interview round is scheduled", interview.status === 201, interview.data?.message);
  check("scheduling moves the stage on", interview.data?.item?.stage === "interview");

  const sneakyHire = await call(hrActor, "PUT", `/admin/hr/candidates/${candidateId}`, {
    stage: "hired",
  });
  check("a plain edit cannot mark somebody hired", sneakyHire.status === 400, sneakyHire.data?.message);

  const hired = await call(hrActor, "POST", `/admin/hr/candidates/${candidateId}/hire`, {
    role: "employee",
    designation: "Developer",
  });
  check("hiring creates the staff account", hired.status === 201, hired.data?.message);
  check("and hands back the login", Boolean(hired.data?.credentials?.password));
  if (hired.status === 201) made.users.push(hired.data.user._id);

  const hiredAgain = await call(hrActor, "POST", `/admin/hr/candidates/${candidateId}/hire`, {});
  check("the same candidate cannot be hired twice", hiredAgain.status === 409);

  const newStaffLogin = await call(null, "POST", "/employee/login", {
    email: hired.data.credentials.loginId,
    password: hired.data.credentials.password,
  });
  check("the hired person can sign in to their panel", newStaffLogin.status === 200, newStaffLogin.data?.message);

  const overview = await call(hrActor, "GET", "/admin/hr/overview");
  check("the HR overview answers", overview.status === 200);
  check("headcount is counted, not typed", (overview.data?.headcount?.total || 0) > 0);
  check("the recruitment pipeline is there", typeof overview.data?.recruitment?.pipeline === "object");

  /* ------------------------------------------- lead → client → operations */

  console.log("\n▸ The company flow: Sales → Operations → Client 360");

  const lead = await call(admin, "POST", "/admin/crm/leads", {
    name: `Test Lead ${TAG}`,
    company: "Testing Ltd",
    email: `lead.${TAG}@example.com`,
    phone: "9555555555",
    source: "referral",
    requirement: "A website",
    estimatedValue: 250000,
    stage: "qualified",
  });
  check("Sales adds a lead", lead.status === 201, lead.data?.message);
  if (lead.status === 201) made.leads.push(lead.data.item._id);

  const leadId = lead.data.item._id;

  const noted = await call(admin, "POST", `/admin/crm/leads/${leadId}/notes`, {
    body: "Called, they want a quote",
    stage: "negotiating",
    followUpOn: "2031-05-01",
  });
  check("a follow-up note is logged", noted.status === 200, noted.data?.message);

  const converted = await call(admin, "POST", `/admin/crm/leads/${leadId}/convert`);
  check("winning the deal creates the client", converted.status === 201, converted.data?.message);
  const clientId = converted.data?.client?._id;
  if (clientId) made.clients.push(clientId);

  check("the client remembers the lead it came from", String(converted.data?.client?.sourceLead) === String(leadId));
  check("and who owns the relationship", Boolean(converted.data?.client?.owner));

  const pending = await call(admin, "GET", "/admin/clients/pending-handover");
  check("it shows as waiting for Operations", pending.data?.items?.some((c) => String(c._id) === String(clientId)));

  const lookups = await call(admin, "GET", "/admin/lookups");
  check("the handover form has Operations staff to offer", (lookups.data?.operationsStaff?.length || 0) > 0);
  check("existing lookup keys are untouched", Array.isArray(lookups.data?.operationsManagers) && Array.isArray(lookups.data?.employees));

  const opsUserId = opsMade.data.item._id;
  const handover = await call(admin, "PUT", `/admin/clients/${clientId}/handover`, {
    accountManager: opsUserId,
    note: "Kickoff next Monday",
  });
  check("Sales hands the client to Operations", handover.status === 200, handover.data?.message);

  const stillPending = await call(admin, "GET", "/admin/clients/pending-handover");
  check(
    "and it drops off the waiting list",
    !stillPending.data?.items?.some((c) => String(c._id) === String(clientId))
  );

  const three60 = await call(admin, "GET", `/admin/clients/${clientId}/360`);
  check("Client 360 answers", three60.status === 200, three60.data?.message);
  check("it carries the sales history", String(three60.data?.sales?.lead?._id) === String(leadId));
  check("the lead's notes come with it", (three60.data?.sales?.lead?.notes?.length || 0) > 0);
  check("it shows the handover", three60.data?.handover?.done === true);
  check("it names the account manager", String(three60.data?.handover?.accountManager?._id) === String(opsUserId));
  check("it has the operations side", typeof three60.data?.operations?.tasks === "object");
  check("it has the money", typeof three60.data?.sales?.money?.outstanding === "number");
  check("and one timeline across departments", (three60.data?.timeline?.length || 0) >= 3, `${three60.data?.timeline?.length} events`);
  check(
    "the timeline is newest first",
    (three60.data?.timeline || []).every((e, i, all) => i === 0 || new Date(all[i - 1].at) >= new Date(e.at))
  );

  // An existing client with no lead behind it must still open
  const anyClient = await call(admin, "GET", "/admin/clients?limit=1");
  const older = anyClient.data?.items?.[0];
  const older360 = await call(admin, "GET", `/admin/clients/${older._id}/360`);
  check("a client that predates all this still opens", older360.status === 200, older360.data?.message);

  check(
    "the admin sees the 360 whichever department produced the client",
    (await call(admin, "GET", `/admin/clients/${clientId}/360`)).status === 200
  );
  check(
    "an HR token cannot — HR has a panel of its own",
    (await call(hr, "GET", `/admin/clients/${clientId}/360`)).status === 403
  );
  check(
    "nor can a Sales token — so does Sales",
    (await call(sales, "GET", `/admin/clients/${clientId}/360`)).status === 403
  );

  /* ----------------------------------------- a returning client's history */

  /**
   * "Have we built for them before?" is answered once, on the client, and
   * carried onto every project created for them afterwards. That inheritance
   * is the whole feature — without it the answer would have to be repeated on
   * each project, which is the sort of thing done for the first and forgotten
   * by the third.
   */

  console.log("\n▸ Previous project");

  const idOf = (value) => String(value?._id || value || "");

  const oldClient = await call(admin, "POST", "/admin/clients", {
    name: `Old Co ${TAG}`,
    email: `oldco.${TAG}@example.com`,
    phone: "9800000021",
  });
  made.clients.push(oldClient.data.item._id);

  const oldProject = await call(admin, "POST", "/admin/projects", {
    name: `Original App ${TAG}`,
    code: `ORIG-${TAG.slice(-4)}`,
    client: oldClient.data.item._id,
    status: "completed",
  });
  made.projects.push(oldProject.data.item._id);
  check("a project with no predecessor links nothing", !oldProject.data.item.previousProject);

  const returning = await call(admin, "POST", "/admin/clients", {
    name: `Returning Co ${TAG}`,
    email: `returning.${TAG}@example.com`,
    phone: "9800000022",
    previousProject: oldProject.data.item._id,
  });
  made.clients.push(returning.data.item._id);
  check("a client can be added as a returning one", returning.status === 201, returning.data?.message);
  check(
    "and the earlier project is stored against them",
    idOf(returning.data.item.previousProject) === String(oldProject.data.item._id)
  );

  const inherited = await call(admin, "POST", "/admin/projects", {
    name: `Version Two ${TAG}`,
    code: `V2-${TAG.slice(-4)}`,
    client: returning.data.item._id,
  });
  made.projects.push(inherited.data.item._id);
  check(
    "a new project for them inherits the link automatically",
    idOf(inherited.data.item.previousProject) === String(oldProject.data.item._id),
    inherited.data.item.previousProject?.name
  );

  const unrelated = await call(admin, "POST", "/admin/projects", {
    name: `Unrelated ${TAG}`,
    code: `UN-${TAG.slice(-4)}`,
    client: oldClient.data.item._id,
  });
  made.projects.push(unrelated.data.item._id);
  check("a client who answered no links nothing", !unrelated.data.item.previousProject);

  /**
   * Clearing has to stick. cleanRefs deletes an empty value rather than
   * writing it, which left the old link in place on an edit — so answering
   * "no" after "yes" looked like it worked and changed nothing.
   */
  const clearedOnClient = await call(admin, "PUT", `/admin/clients/${returning.data.item._id}`, {
    previousProject: "",
  });
  check("answering no on an edit clears it", !clearedOnClient.data.item.previousProject);
  const rereadClient = await call(admin, "GET", `/admin/clients/${returning.data.item._id}`);
  check("and it stays cleared", !rereadClient.data.item.previousProject);

  const clearedOnProject = await call(admin, "PUT", `/admin/projects/${inherited.data.item._id}`, {
    previousProject: "",
  });
  check("a project's link can be cleared too", !clearedOnProject.data.item.previousProject);

  await call(admin, "PUT", `/admin/projects/${inherited.data.item._id}`, {
    previousProject: oldProject.data.item._id,
  });
  const renamed = await call(admin, "PUT", `/admin/projects/${inherited.data.item._id}`, {
    name: `Version Two renamed ${TAG}`,
  });
  check(
    "an edit that does not mention the link leaves it alone",
    idOf(renamed.data.item.previousProject) === String(oldProject.data.item._id)
  );

  const lineage = await call(admin, "GET", `/admin/projects/${inherited.data.item._id}/details`);
  check(
    "project details says what it continues from",
    lineage.data?.project?.previousProject?.name?.includes("Original")
  );
  const backwards = await call(admin, "GET", `/admin/projects/${oldProject.data.item._id}/details`);
  check(
    "and the original says what followed it",
    backwards.data?.followedBy?.some((p) => String(p._id) === String(inherited.data.item._id)),
    backwards.data?.followedBy?.map((p) => p.name).join(", ")
  );

  await call(admin, "PUT", `/admin/clients/${returning.data.item._id}`, {
    previousProject: oldProject.data.item._id,
  });
  const returning360 = await call(admin, "GET", `/admin/clients/${returning.data.item._id}/360`);
  check(
    "client 360 shows the returning-client link",
    returning360.data?.client?.previousProject?.name?.includes("Original")
  );
  check(
    "and each project row carries its own",
    returning360.data?.operations?.projects?.some((p) => p.previousProject)
  );

  // The two scopes the picker offers
  const ownScope = await call(
    admin,
    "GET",
    `/admin/projects?client=${oldClient.data.item._id}&limit=200`
  );
  check(
    "the picker can list one client's own projects",
    ownScope.data?.items?.length > 0 &&
      ownScope.data.items.every((p) => idOf(p.client) === String(oldClient.data.item._id))
  );
  const allScope = await call(
    admin,
    "GET",
    `/admin/projects?search=${encodeURIComponent(`Original App ${TAG}`)}`
  );
  check("and search every project", allScope.data?.items?.length === 1);

  /* ------------------------------- what the new screens actually read back */

  /**
   * The panel's new pages read specific keys out of these responses. A rename
   * on the server that the pages have not followed shows up as an empty table
   * rather than an error, so the shapes are asserted rather than assumed.
   */

  console.log("\n▸ Response shapes the new screens depend on");

  const overviewShape = await call(admin, "GET", "/admin/hr/overview");
  check(
    "HR overview carries headcount, leave, recruitment and attendance",
    ["headcount", "leave", "recruitment", "attendance"].every(
      (key) => overviewShape.data?.[key] && typeof overviewShape.data[key] === "object"
    )
  );
  check(
    "and the arrays the cards iterate",
    Array.isArray(overviewShape.data?.leave?.onLeaveToday) &&
      Array.isArray(overviewShape.data?.recruitment?.upcoming) &&
      Array.isArray(overviewShape.data?.teams)
  );

  const leavesShape = await call(admin, "GET", "/admin/hr/leaves");
  check(
    "the leave list paginates like every other list",
    ["items", "total", "page", "pages"].every((key) => leavesShape.data?.[key] !== undefined)
  );
  check(
    "and populates the person so the table can print a name",
    leavesShape.data.items.length === 0 ||
      typeof leavesShape.data.items[0].employee === "object"
  );

  const balancesShape = await call(admin, "GET", "/admin/hr/leaves/balances");
  check(
    "balances carry rows, quotas and the policies behind them",
    Array.isArray(balancesShape.data?.rows) &&
      typeof balancesShape.data?.quotas === "object" &&
      Array.isArray(balancesShape.data?.policies)
  );

  const metaShape = await call(admin, "GET", "/admin/department-accounts/meta");
  check(
    "the department form is told what each department reaches",
    metaShape.data?.departments?.every(
      (d) => d.value && d.label && Array.isArray(d.modules) && typeof d.permissions === "object"
    )
  );
  check("and offers the roles that can override it", Array.isArray(metaShape.data?.roles));

  const accountsShape = await call(admin, "GET", "/admin/department-accounts");
  check(
    "the accounts list carries the per-department counts the cards show",
    ["hr", "sales", "operations"].every(
      (key) =>
        accountsShape.data?.byDepartment?.[key] &&
        typeof accountsShape.data.byDepartment[key].total === "number" &&
        accountsShape.data.byDepartment[key].label
    )
  );
  check(
    "and labels each row's department",
    accountsShape.data.items.every((row) => row.departmentLabel)
  );

  const rolesMeta = await call(admin, "GET", "/admin/roles/meta");
  check(
    "the role editor is told the new modules exist",
    ["leaves", "recruitment", "department_accounts"].every((module) =>
      rolesMeta.data?.modules?.includes(module)
    )
  );
  check("and which department each module belongs to", typeof rolesMeta.data?.departments === "object");

  const c360 = await call(admin, "GET", `/admin/clients/${clientId}/360`);
  check(
    "Client 360 carries every block the page renders",
    ["client", "sales", "handover", "operations", "files", "meetings", "timeline", "stats"].every(
      (key) => c360.data?.[key] !== undefined
    )
  );
  check(
    "the money block has the three figures the cards print",
    ["invoiced", "received", "outstanding", "quoted"].every(
      (key) => typeof c360.data?.sales?.money?.[key] === "number"
    )
  );
  check(
    "the operations block has projects, team and the task rollup",
    Array.isArray(c360.data?.operations?.projects) &&
      Array.isArray(c360.data?.operations?.team) &&
      typeof c360.data?.operations?.tasks?.total === "number"
  );
  check(
    "and no password rides along on the client record",
    c360.data?.client?.password === undefined
  );

  const queueShape = await call(admin, "GET", "/admin/clients/pending-handover");
  check(
    "the handover queue flags what has nothing started",
    Array.isArray(queueShape.data?.items) && typeof queueShape.data?.unstarted === "number"
  );
  check(
    "and every row says whether work has begun",
    queueShape.data.items.every((row) => typeof row.hasProject === "boolean")
  );

  /* ------------------------------------------------------------ tidying up */

  console.log("\n▸ Removing a department account");

  const removed = await call(admin, "DELETE", `/admin/department-accounts/${hrAccounts[2].id}`);
  check("an HR account can be deleted", removed.status === 200, removed.data?.message);
  check(
    "and its session dies with it",
    (await call(hrTokens[2], "GET", "/hr/dashboard")).status === 403
  );

  const stillThree = await call(admin, "GET", "/admin/department-accounts?role=hr");
  check(
    "the remaining HR accounts are untouched",
    stillThree.data?.items?.filter((r) => r.email.includes(TAG)).length === 3
  );
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
