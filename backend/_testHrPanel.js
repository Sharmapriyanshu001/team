// The dedicated HR panel, end to end.
//
//   an HR head signs in at /api/hr and nowhere else
//   they create several HR Managers, each with a login of their own
//   an HR Manager gets every HR screen except the one that mints logins
//   neither can reach a lead, an invoice, a project, the vault or the roles
//   leave, attendance, candidates, documents and reports run on the real data
//   the admin panel is unchanged
//
// Run against a server started on PORT_UNDER_TEST (default 5099). Everything
// it creates is removed at the end, including on failure.
import dotenv from "dotenv";
import mongoose from "mongoose";

import Candidate from "./models/Candidate.js";
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

const TAG = `hrtest_${Date.now()}`;
const made = { users: [], leaves: [], candidates: [], policies: [] };

const cleanup = async () => {
  await Promise.all([
    User.deleteMany({ _id: { $in: made.users } }),
    Leave.deleteMany({ _id: { $in: made.leaves } }),
    Candidate.deleteMany({ _id: { $in: made.candidates } }),
    LeavePolicy.deleteMany({ _id: { $in: made.policies } }),
  ]);
  await Promise.all([
    User.deleteMany({ email: new RegExp(TAG) }),
    Candidate.deleteMany({ email: new RegExp(TAG) }),
  ]);
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  /* ------------------------------------- an admin sets up the HR head */

  console.log("\n▸ The HR head");

  const adminLogin = await call(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  check("an administrator signs in", adminLogin.status === 200, adminLogin.data?.message);
  if (adminLogin.status !== 200) throw new Error("cannot continue without an admin token");
  const admin = adminLogin.data.token;

  const madeHead = await call(admin, "POST", "/admin/department-accounts", {
    name: "Test HR Head",
    email: `head.${TAG}@example.com`,
    role: "hr",
    phone: "9700000001",
    designation: "HR Head",
  });
  check("the administrator creates the HR head", madeHead.status === 201, madeHead.data?.message);
  if (madeHead.status !== 201) throw new Error("no HR head to test with");
  made.users.push(madeHead.data.item._id);

  const headCreds = madeHead.data.credentials;

  const headLogin = await call(null, "POST", "/hr/login", {
    email: headCreds.loginId,
    password: headCreds.password,
  });
  check("the head signs in at the HR panel", headLogin.status === 200, headLogin.data?.message);
  const head = headLogin.data?.token;
  check("and is reported as the HR head", headLogin.data?.access?.isHrAdmin === true);
  check(
    "with the HR Managers module",
    Array.isArray(headLogin.data?.access?.modules?.hr_managers)
  );

  /* ------------------------------------------- HR is only reachable at /hr */

  console.log("\n▸ The panel boundary");

  check(
    "an HR token is refused by the admin panel",
    (await call(head, "GET", "/admin/dashboard")).status === 403
  );
  check(
    "an HR token is refused by the operations manager panel",
    (await call(head, "GET", "/leader/dashboard")).status === 403
  );
  check(
    "an HR token is refused by the employee panel",
    (await call(head, "GET", "/employee/dashboard")).status === 403
  );
  check(
    "and the HR account cannot sign in at the admin login",
    (await call(null, "POST", "/admin/login", {
      email: headCreds.loginId,
      password: headCreds.password,
    })).status === 403
  );

  const adminToHr = await call(admin, "GET", "/hr/dashboard");
  check("an admin token is refused by the HR panel", adminToHr.status === 403, `HTTP ${adminToHr.status}`);

  /* -------------------------------------------- many HR Managers, not one */

  console.log("\n▸ HR Managers — several at once");

  const managers = [];
  for (let i = 1; i <= 4; i += 1) {
    const created = await call(head, "POST", "/hr/managers", {
      name: `HR Manager ${i}`,
      email: `mgr${i}.${TAG}@example.com`,
      phone: `97000001${i}${i}`,
      designation: "HR Executive",
    });
    check(`HR Manager ${i} of 4 created`, created.status === 201, created.data?.message);
    if (created.status === 201) {
      managers.push({
        id: created.data.item._id,
        email: created.data.credentials.loginId,
        password: created.data.credentials.password,
      });
      made.users.push(created.data.item._id);
    }
  }
  check("four HR Managers exist side by side", managers.length === 4, `${managers.length} made`);

  const listed = await call(head, "GET", "/hr/managers");
  // The head's own row carries the tag too, so it is excluded by role
  const listedManagers =
    listed.data?.items?.filter((row) => row.email.includes(TAG) && !row.isHead) || [];
  check("all four show in the head's list", listedManagers.length === 4, `${listedManagers.length} listed`);
  check(
    "each is an HR Manager, not a head",
    listedManagers.every((row) => row.role === "hr_manager")
  );
  check(
    "the list counts them without a ceiling",
    (listed.data?.byRole?.hr_manager?.total || 0) >= 4,
    `total ${listed.data?.byRole?.hr_manager?.total}`
  );

  const tokens = [];
  for (const manager of managers) {
    const signIn = await call(null, "POST", "/hr/login", {
      email: manager.email,
      password: manager.password,
    });
    if (signIn.status === 200) tokens.push(signIn.data.token);
  }
  check("every HR Manager signs in on their own", tokens.length === 4, `${tokens.length} of 4`);

  const duplicate = await call(head, "POST", "/hr/managers", {
    name: "Duplicate",
    email: managers[0].email,
    phone: "9700009999",
  });
  check("a second account cannot take the same email", duplicate.status === 409);

  /* ----------------------------------------- the role can never be chosen */

  console.log("\n▸ The role is never taken from the request");

  for (const role of ["super_admin", "admin", "hr", "operations", "sales"]) {
    const attempt = await call(head, "POST", "/hr/managers", {
      name: `Escalation ${role}`,
      email: `esc.${role}.${TAG}@example.com`,
      phone: "9700008888",
      role,
    });

    const created = attempt.data?.item;
    if (created?._id) made.users.push(created._id);

    check(
      `asking for role "${role}" still produces an HR Manager`,
      attempt.status === 201 && created?.role === "hr_manager",
      `got ${created?.role || attempt.status}`
    );
  }

  /* ------------------------------------ what an HR Manager may and may not */

  console.log("\n▸ An HR Manager");

  const manager = tokens[0];

  const managerMe = await call(manager, "GET", "/hr/me");
  check("is not the HR head", managerMe.data?.access?.isHrAdmin === false);
  check(
    "and holds no HR Managers module at all",
    managerMe.data?.access?.modules?.hr_managers === undefined
  );

  for (const route of [
    "/hr/dashboard",
    "/hr/employees",
    "/hr/attendance/summary",
    "/hr/leaves",
    "/hr/leaves/balances",
    "/hr/leave-policies",
    "/hr/candidates",
    "/hr/documents",
    "/hr/reports",
    "/hr/settings",
  ]) {
    const res = await call(manager, "GET", route);
    check(`may GET ${route}`, res.status === 200, `HTTP ${res.status}`);
  }

  check(
    "may not list the HR logins",
    (await call(manager, "GET", "/hr/managers")).status === 403
  );
  check(
    "may not create one",
    (await call(manager, "POST", "/hr/managers", {
      name: "Sneaky",
      email: `sneaky.${TAG}@example.com`,
      phone: "9700007777",
    })).status === 403
  );
  check(
    "may not delete one",
    (await call(manager, "DELETE", `/hr/managers/${managers[1].id}`)).status === 403
  );

  /* ------------------------------------------------ nothing outside HR */

  console.log("\n▸ Nothing outside HR is reachable");

  for (const route of [
    "/hr/crm/leads",
    "/hr/clients",
    "/hr/projects",
    "/hr/vault",
    "/hr/roles",
    "/hr/ads/accounts",
    "/hr/portfolio",
  ]) {
    const res = await call(head, "GET", route);
    check(`${route} does not exist`, res.status === 404, `HTTP ${res.status}`);
  }

  /* --------------------------------------------------- the head's own record */

  console.log("\n▸ The head's account is not editable from the team screen");

  const headRow = listed.data.items.find((row) => row.isHead && row.email.includes(TAG));
  check("the head appears in the list, marked as such", Boolean(headRow));
  check(
    "and cannot be edited from there",
    (await call(head, "PUT", `/hr/managers/${headRow._id}`, { name: "Renamed" })).status === 403
  );
  check(
    "nor deleted",
    (await call(head, "DELETE", `/hr/managers/${headRow._id}`)).status === 403
  );

  /* -------------------------------------------------------- the real work */

  console.log("\n▸ HR work, on the real collections");

  const people = await call(head, "GET", "/hr/employees?limit=1");
  const someone = people.data?.items?.[0];
  check("there is an employee to work with", Boolean(someone), someone?.name);

  const leave = await call(manager, "POST", "/hr/leaves", {
    employee: someone._id,
    type: "casual",
    fromDate: "2032-04-05",
    toDate: "2032-04-07",
    reason: `hr panel test ${TAG}`,
  });
  check("an HR Manager files a leave", leave.status === 201, leave.data?.message);
  if (leave.status === 201) made.leaves.push(leave.data.item._id);
  check("the days are counted", leave.data?.item?.days === 3, `${leave.data?.item?.days}`);

  const decided = await call(manager, "PUT", `/hr/leaves/${leave.data.item._id}/decide`, {
    status: "approved",
    decisionNote: "fine",
  });
  check("and approves it", decided.status === 200, decided.data?.message);
  check(
    "the decision records the HR account that made it",
    Boolean(decided.data?.item?.decidedByName),
    decided.data?.item?.decidedByName
  );

  // The bug that made two live rows uneditable: an overlap check that ran on
  // every update, including one that never touched a date
  const renote = await call(manager, "PUT", `/hr/leaves/${leave.data.item._id}`, {
    reason: "edited, dates untouched",
  });
  check("a leave can be edited without moving its dates", renote.status === 200, renote.data?.message);

  const clash = await call(manager, "POST", "/hr/leaves", {
    employee: someone._id,
    type: "casual",
    fromDate: "2032-04-06",
    toDate: "2032-04-08",
    reason: "should clash",
  });
  check("a genuine overlap is still refused", clash.status === 400, clash.data?.message);

  const existingLeaves = await call(head, "GET", "/hr/leaves");
  check(
    "leave rows already in the database are readable",
    existingLeaves.data?.total >= 4,
    `${existingLeaves.data?.total} rows`
  );

  const candidate = await call(manager, "POST", "/hr/candidates", {
    name: `HR Panel Candidate ${TAG}`,
    email: `cand.${TAG}@example.com`,
    phone: "9700006666",
    position: "Developer",
    hireAs: "employee",
  });
  check("an HR Manager adds a candidate", candidate.status === 201, candidate.data?.message);
  if (candidate.status === 201) made.candidates.push(candidate.data.item._id);

  const escalateHire = await call(manager, "POST", `/hr/candidates/${candidate.data.item._id}/hire`, {
    role: "hr",
  });
  check(
    "hiring somebody into a department role is refused",
    escalateHire.status === 403,
    escalateHire.data?.message
  );

  const superHire = await call(manager, "POST", `/hr/candidates/${candidate.data.item._id}/hire`, {
    role: "super_admin",
  });
  check("and into an administrator role is refused", superHire.status === 400, superHire.data?.message);

  const hired = await call(manager, "POST", `/hr/candidates/${candidate.data.item._id}/hire`, {
    role: "employee",
  });
  check("hiring as an employee works", hired.status === 201, hired.data?.message);
  if (hired.status === 201) made.users.push(hired.data.user._id);

  const documents = await call(manager, "GET", "/hr/documents");
  check("the document register answers", documents.status === 200);
  check(
    "and lists what each person is missing",
    Array.isArray(documents.data?.items) &&
      documents.data.items.every((row) => Array.isArray(row.missing))
  );

  const reports = await call(manager, "GET", "/hr/reports");
  check("the monthly report answers", reports.status === 200);
  check(
    "with headcount, attendance, leave and hiring",
    ["headcount", "attendance", "leave", "recruitment"].every(
      (key) => reports.data?.[key] && typeof reports.data[key] === "object"
    )
  );

  const settings = await call(manager, "GET", "/hr/settings");
  check("settings are readable", settings.status === 200);
  check("and marked read-only", settings.data?.editable === false);

  /* ------------------------------------------------- deactivate and delete */

  console.log("\n▸ Deactivating and deleting");

  const off = await call(head, "PUT", `/hr/managers/${managers[3].id}`, { status: "inactive" });
  check("the head deactivates an HR Manager", off.status === 200, off.data?.message);
  check(
    "their live session stops working",
    [401, 403].includes((await call(tokens[3], "GET", "/hr/dashboard")).status)
  );
  check(
    "and they can no longer sign in",
    (await call(null, "POST", "/hr/login", {
      email: managers[3].email,
      password: managers[3].password,
    })).status === 403
  );

  const removed = await call(head, "DELETE", `/hr/managers/${managers[2].id}`);
  check("the head deletes an HR Manager", removed.status === 200, removed.data?.message);
  check(
    "their session dies with them",
    (await call(tokens[2], "GET", "/hr/dashboard")).status === 403
  );

  /* --------------------------------------------- the admin panel is intact */

  console.log("\n▸ The admin panel is unchanged");

  for (const route of [
    "/admin/dashboard",
    "/admin/employees",
    "/admin/clients",
    "/admin/projects",
    "/admin/crm/leads",
    "/admin/hr/leaves",
    "/admin/hr/candidates",
    "/admin/hr/overview",
    "/admin/department-accounts",
    "/admin/roles",
    "/admin/attendance/summary",
    "/admin/settings",
  ]) {
    const res = await call(admin, "GET", route);
    check(`admin GET ${route}`, res.status === 200, res.status === 200 ? "" : `HTTP ${res.status}`);
  }

  const salesStillWorks = await call(admin, "GET", "/admin/department-accounts?role=sales");
  check("Sales accounts still belong to the admin panel", salesStillWorks.status === 200);
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
