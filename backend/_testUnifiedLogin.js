/**
 * One login, seven kinds of person, and the doors that must stay shut.
 *
 * Two things are being proved. The first is that everybody can sign in at the
 * same address and is sent to their own panel. The second matters more: that
 * the token this new endpoint mints is the SAME token the per-panel logins
 * minted, so it unlocks exactly what it did before and nothing else — an
 * employee's session must still be refused by the admin API.
 *
 * Every role is created here rather than borrowed from live data, so the run
 * says the same thing on an empty database as on a busy one.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";

import Client from "./models/Client.js";
import User, { USER_ROLES } from "./models/User.js";
import { hashPassword } from "./utils/password.js";
import { panelForRole } from "./utils/panels.js";

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

const signIn = (email, password) => json(null, "POST", "/auth/login", { email, password });

const PASSWORD = "unified-login-test-pass";

/** One account per role, plus a client. */
const CAST = [
  ["super_admin", "/admin"],
  ["admin", "/admin"],
  ["operations", "/admin"],
  ["hr", "/hr"],
  ["hr_manager", "/hr"],
  ["sales", "/sales"],
  ["sales_exec", "/sales"],
  ["manager", "/operation-manager"],
  ["operations_manager", "/operation-manager"],
  ["employee", "/employee"],
];

const emailFor = (role) => `unified.${role}@example.com`;
const CLIENT_EMAIL = "unified.client@example.com";
const ORPHAN_EMAIL = "unified.orphan@example.com";

const cleanup = async () => {
  await User.deleteMany({
    email: { $in: [...CAST.map(([r]) => emailFor(r)), ORPHAN_EMAIL] },
  });
  await Client.deleteMany({ email: CLIENT_EMAIL });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await cleanup();

  await Promise.all(
    CAST.map(([role]) =>
      User.create({
        name: `Unified ${role}`,
        email: emailFor(role),
        password: hashPassword(PASSWORD),
        role,
        status: "active",
      })
    )
  );

  await Client.create({
    name: "Unified Client",
    email: CLIENT_EMAIL,
    password: hashPassword(PASSWORD),
    status: "active",
  });

  /* ------------------------------------------------ the map has no holes */

  section("Every role knows where it belongs");

  const unmapped = USER_ROLES.filter((role) => !panelForRole(role));
  check(
    'only "user" has no panel',
    unmapped.length === 1 && unmapped[0] === "user",
    unmapped.join(", ") || "none"
  );

  /* ---------------------------------------------- one door, seven panels */

  section("One login sends each role to its own panel");

  const tokens = {};

  for (const [role, expected] of CAST) {
    const r = await signIn(emailFor(role), PASSWORD);
    const ok = r.status === 200 && r.data?.path === expected;
    check(`${role.padEnd(19)} → ${expected}`, ok, ok ? "" : `${r.status} ${r.data?.path || r.data?.message}`);
    if (r.data?.token) tokens[role] = r.data;
  }

  const asClient = await signIn(CLIENT_EMAIL, PASSWORD);
  check("client              → /client", asClient.status === 200 && asClient.data?.path === "/client", asClient.data?.path || asClient.data?.message);

  /* ------------------------------------------- what the browser is told */

  section("The response carries everything a browser needs");

  const admin = tokens.admin;
  check("a token", Boolean(admin?.token));
  check("where to go", admin?.path === "/admin");
  check("which storage slot for the token", admin?.tokenKey === "adminToken", admin?.tokenKey);
  check("which slot for the user", admin?.userKey === "admin", admin?.userKey);
  check("and the account itself", admin?.user?.role === "admin" && Boolean(admin?.user?.name));

  check(
    "the client is told the client slots",
    asClient.data?.tokenKey === "clientToken" && asClient.data?.userKey === "client"
  );

  /* --------------------------------- the token unlocks exactly as before */

  section("The token is the same one the panel logins minted");

  const adminMe = await json(tokens.admin.token, "GET", "/admin/dashboard");
  check("an admin token opens the admin API", adminMe.status === 200, String(adminMe.status));

  const hrMe = await json(tokens.hr.token, "GET", "/hr/dashboard");
  check("an HR token opens the HR API", hrMe.status === 200, String(hrMe.status));

  const salesMe = await json(tokens.sales.token, "GET", "/sales/dashboard");
  check("a sales token opens the Sales API", salesMe.status === 200, String(salesMe.status));

  const omMe = await json(tokens.operations_manager.token, "GET", "/leader/dashboard");
  check("an operations manager token opens that API", omMe.status === 200, String(omMe.status));

  const empMe = await json(tokens.employee.token, "GET", "/employee/dashboard");
  check("an employee token opens the employee API", empMe.status === 200, String(empMe.status));

  const clientMe = await json(asClient.data.token, "GET", "/client/dashboard");
  check("a client token opens the portal API", clientMe.status === 200, String(clientMe.status));

  /* ------------------------------------------------ and unlocks no more */

  section("Route protection — every wrong door stays shut");

  const REFUSALS = [
    ["employee", "/admin/employees", "the admin API"],
    ["employee", "/hr/employees", "the HR API"],
    ["employee", "/sales/leads", "the Sales API"],
    ["employee", "/leader/tasks", "the operations manager API"],
    ["sales", "/admin/employees", "the admin API"],
    ["sales", "/leader/tasks", "the operations manager API"],
    ["hr", "/admin/employees", "the admin API"],
    ["hr", "/sales/leads", "the Sales API"],
    ["operations_manager", "/admin/employees", "the admin API"],
    ["operations_manager", "/hr/employees", "the HR API"],
    ["manager", "/sales/leads", "the Sales API"],
  ];

  for (const [role, route, what] of REFUSALS) {
    const r = await json(tokens[role].token, "GET", route);
    check(
      `${role.padEnd(19)} refused by ${what}`,
      r.status === 401 || r.status === 403,
      String(r.status)
    );
  }

  const clientPeek = await json(asClient.data.token, "GET", "/admin/employees");
  check("a client is refused by the admin API", clientPeek.status === 401 || clientPeek.status === 403, String(clientPeek.status));

  const noToken = await json(null, "GET", "/admin/employees");
  check("no token at all is refused", noToken.status === 401, String(noToken.status));

  /* -------------------------------------------------------- the refusals */

  section("What the login refuses, and how");

  const wrongPw = await signIn(emailFor("admin"), "not-the-password");
  check("a wrong password is refused", wrongPw.status === 401, wrongPw.data?.message);

  const noSuchAccount = await signIn("nobody.at.all@example.com", PASSWORD);
  check("an unknown email is refused", noSuchAccount.status === 401, noSuchAccount.data?.message);

  check(
    "both say the same thing, so neither confirms an address exists",
    wrongPw.data?.message === noSuchAccount.data?.message,
    wrongPw.data?.message
  );

  const orphan = await User.create({
    name: "Unified Orphan",
    email: ORPHAN_EMAIL,
    password: hashPassword(PASSWORD),
    role: "user",
    status: "active",
  });
  const noPanel = await signIn(ORPHAN_EMAIL, PASSWORD);
  check(
    "a role with no panel is told so plainly, not called a bad password",
    noPanel.status === 403 && /no panel/i.test(noPanel.data?.message || ""),
    noPanel.data?.message
  );

  await User.updateOne({ _id: orphan._id }, { $set: { role: "employee", status: "inactive" } });
  const inactive = await signIn(ORPHAN_EMAIL, PASSWORD);
  check(
    "an inactive account is told it is switched off",
    inactive.status === 403 && /inactive/i.test(inactive.data?.message || ""),
    inactive.data?.message
  );

  const blank = await signIn("", "");
  check("an empty form is refused before any lookup", blank.status === 400, blank.data?.message);

  /* ------------------------------------- the old logins still work as-is */

  section("The per-panel logins still work");

  const oldAdmin = await json(null, "POST", "/admin/login", {
    email: emailFor("admin"),
    password: PASSWORD,
  });
  check("POST /admin/login still signs in", oldAdmin.status === 200 && Boolean(oldAdmin.data?.token));

  const oldEmployee = await json(null, "POST", "/employee/login", {
    email: emailFor("employee"),
    password: PASSWORD,
  });
  check("POST /employee/login still signs in", oldEmployee.status === 200 && Boolean(oldEmployee.data?.token));

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
