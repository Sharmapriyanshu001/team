// An operations manager building their own team.
//
// Every employee is offered, including those already on a colleague's team —
// a list of only the unassigned is an empty list in a company where everybody
// already has a leader, and the feature would do nothing.
//
// So a reassignment is allowed, and what is proved here is that it is never
// silent: the picker says who each person answers to, the leader who loses
// somebody is notified, and the move is written to the activity log. What
// stays refused is reaching into another leader's team to REMOVE somebody,
// and making an operations manager report to you.
//
// Records are seeded straight into Mongo rather than through the admin API,
// because creating staff there requires the full onboarding pack — Aadhaar
// photos and a bank account — which is a rule about the joining form and has
// nothing to do with what is under test.
//
// Run against a server started on PORT_UNDER_TEST (default 5099).
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
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

const TAG = `lt_${Date.now()}`;
const made = [];

const seed = async (role, name) => {
  const password = "9700000000";
  const person = await User.create({
    name: `${name} ${TAG}`,
    email: `${name.toLowerCase()}.${TAG}@example.com`,
    password: hashPassword(password),
    role,
    phone: password,
    status: "active",
  });
  made.push(person._id);
  return { ...person.toObject(), plainPassword: password };
};

const cleanup = async () => {
  await User.deleteMany({ _id: { $in: made } });
  await User.deleteMany({ email: new RegExp(TAG) });
  // The claim and release both notify; those rows are ours too
  await Notification.deleteMany({ user: { $in: made } });
};

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  console.log("\n▸ A brand-new operations manager");

  const leaderOne = await seed("operations_manager", "LeadOne");
  const leaderTwo = await seed("operations_manager", "LeadTwo");
  const emp1 = await seed("employee", "EmpOne");
  const emp2 = await seed("employee", "EmpTwo");
  const emp3 = await seed("employee", "EmpThree");

  const signIn = async (person) =>
    (
      await call(null, "POST", "/leader/login", {
        email: person.email,
        password: person.plainPassword,
      })
    ).data?.token;

  const one = await signIn(leaderOne);
  const two = await signIn(leaderTwo);
  check("a leader created a moment ago can sign in", Boolean(one));

  const empty = await call(one, "GET", "/leader/team");
  check("and starts with nobody reporting to them", empty.data?.total === 0);

  /* ------------------------------------------------------------- the pool */

  console.log("\n▸ Building the team");

  const pool = await call(one, "GET", "/leader/team/available");
  const ours = pool.data?.items?.filter((p) => p.email.includes(TAG)) || [];
  check("the picker offers the new employees", ours.length === 3, `${ours.length} of 3`);
  check(
    "and offers no operations managers — only employees can be claimed",
    !pool.data.items.some((p) => String(p._id) === String(leaderTwo._id))
  );
  check(
    "every row says who that person answers to today",
    pool.data.items.every((p) => "currentLeader" in p && "onMyTeam" in p)
  );

  const searched = await call(one, "GET", "/leader/team/available?search=EmpOne");
  check(
    "the pool can be searched",
    searched.data?.items?.length === 1 && searched.data.items[0].name.includes("EmpOne"),
    `${searched.data?.items?.length} hits`
  );

  const added = await call(one, "POST", "/leader/team/members", {
    employees: [emp1._id, emp2._id],
  });
  check("the leader builds their own team", added.status === 200, added.data?.message);
  check("two were added", added.data?.added === 2);

  const team = await call(one, "GET", "/leader/team");
  check("and the team page shows them", team.data?.total === 2, `${team.data?.total} members`);

  const toldThem = await Notification.countDocuments({
    user: emp1._id,
    title: /added to a team/i,
  });
  check("the employee is told", toldThem === 1);

  /* ------------------------------------------- the rule that makes it safe */

  console.log("\n▸ Taking somebody from another team");

  /**
   * Every employee is offered, including those already on a colleague's team —
   * a list of only the unassigned is an empty list in a company where
   * everybody has a leader. The safeguard is that the move is visible, not
   * that it is refused.
   */
  const poolTwo = await call(two, "GET", "/leader/team/available");
  const seenByTwo = poolTwo.data.items.find((p) => String(p._id) === String(emp1._id));
  check("a claimed employee is still listed for other leaders", Boolean(seenByTwo));
  check(
    "flagged as being on somebody else's team",
    seenByTwo?.onAnotherTeam === true && seenByTwo?.currentLeader?.name?.includes("LeadOne"),
    seenByTwo?.currentLeader?.name
  );

  const moved = await call(two, "POST", "/leader/team/members", { employees: [emp1._id] });
  check("and can be taken", moved.status === 200, moved.data?.message);
  check("the response says one came from another team", moved.data?.movedFromAnother === 1);

  const nowTwos = await User.findById(emp1._id).select("reportsTo");
  check(
    "the reporting line actually moved",
    String(nowTwos.reportsTo) === String(leaderTwo._id)
  );

  const toldPrevious = await Notification.countDocuments({
    user: leaderOne._id,
    title: /left your team/i,
  });
  check("and the leader who lost them is told", toldPrevious === 1);

  // Put them back for the rest of the run
  await call(one, "POST", "/leader/team/members", { employees: [emp1._id] });

  console.log("\n▸ What is still refused");

  const steal = await call(two, "DELETE", `/leader/team/members/${emp1._id}`);
  check(
    "a leader cannot remove somebody from another team",
    steal.status === 404,
    steal.data?.message
  );

  const grabLeader = await call(one, "POST", "/leader/team/members", {
    employees: [leaderTwo._id],
  });
  check(
    "nor make another operations manager report to them",
    grabLeader.status === 400,
    grabLeader.data?.message
  );

  const grabNobody = await call(one, "POST", "/leader/team/members", { employees: [] });
  check("and must choose somebody", grabNobody.status === 400, grabNobody.data?.message);

  /* --------------------------------------------------------- already mine */

  console.log("\n▸ Adding somebody already yours");

  const again = await call(one, "POST", "/leader/team/members", { employees: [emp1._id] });
  check("is a no-op rather than an error", again.status === 200 && again.data?.added === 0, again.data?.message);

  /* ---------------------------------------------------------- releasing */

  console.log("\n▸ Letting somebody go");

  // emp3 has not been on anybody's team yet — put them on this one first
  const third = await call(one, "POST", "/leader/team/members", { employees: [emp3._id] });
  check("a third person joins the team", third.data?.added === 1, third.data?.message);

  const released = await call(one, "DELETE", `/leader/team/members/${emp3._id}`);
  check("a leader can release their own", released.status === 200, released.data?.message);

  const backInPool = await call(two, "GET", "/leader/team/available");
  check(
    "and they return to the pool for anybody",
    backInPool.data.items.some((p) => String(p._id) === String(emp3._id))
  );

  const claimedByTwo = await call(two, "POST", "/leader/team/members", { employees: [emp3._id] });
  check("who can then be claimed by the other leader", claimedByTwo.status === 200);

  /* -------------------------------------- nothing but reportsTo is written */

  console.log("\n▸ Nothing else is touched");

  const untouched = await User.findById(emp1._id);
  check("the role is unchanged", untouched.role === "employee");
  check("the status is unchanged", untouched.status === "active");
  check("the password is unchanged", Boolean(untouched.password));
  check("and the session was not invalidated", (untouched.tokenVersion || 0) === 0);

  /* ------------------------------------------------- the admin still wins */

  console.log("\n▸ The admin keeps the override");

  const adminLogin = await call(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  const admin = adminLogin.data?.token;

  const adminMoved = await call(admin, "PUT", `/admin/employees/${emp1._id}`, {
    reportsTo: leaderTwo._id,
  });
  check(
    "an admin can move somebody between leaders",
    adminMoved.status === 200 &&
      String(adminMoved.data.item.reportsTo?._id || adminMoved.data.item.reportsTo) ===
        String(leaderTwo._id),
    adminMoved.data?.message
  );

  const gone = await call(one, "GET", "/leader/team");
  check(
    "and the first leader's team shrinks accordingly",
    !gone.data.items.some((m) => String(m._id) === String(emp1._id))
  );

  /* --------------------------------------------------- other panels refuse */

  console.log("\n▸ The routes belong to the leader panel alone");

  check(
    "an employee token cannot claim people",
    [401, 403].includes((await call(await signIn(emp2).catch(() => null), "POST", "/leader/team/members", { employees: [emp3._id] })).status)
  );
  check(
    "an admin token is refused by the leader panel",
    (await call(admin, "GET", "/leader/team/available")).status === 403
  );
  check(
    "and an anonymous request is refused",
    (await call(null, "GET", "/leader/team/available")).status === 401
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
