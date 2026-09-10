// Sales: a manager's own team, and the work they hand to it.
//
// The two things being proved here are the ones that were not true before:
// an executive belongs to the manager who opened their account, and a manager
// can put work on that person which the person then sees and can move.
//
// The third is the one that matters most for a floor with two managers on it —
// neither of them can read, edit or assign onto the other's people.
import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "./models/User.js";
import Task from "./models/Task.js";
import { hashPassword } from "./utils/password.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || process.env.PORT || 5002;
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

const login = async (email, password) => {
  const r = await json(null, "POST", "/sales/login", { email, password });
  return r.data?.token;
};

const PASSWORD = "sales-team-test-pass";
const A_EMAIL = "salesmgr.a@example.com";
const B_EMAIL = "salesmgr.b@example.com";
const EXEC_A = "salesexec.a@example.com";
const EXEC_B = "salesexec.b@example.com";
const ORPHAN = "salesexec.orphan@example.com";
const EMAILS = [A_EMAIL, B_EMAIL, EXEC_A, EXEC_B, ORPHAN];

const cleanup = async () => {
  const users = await User.find({ email: { $in: EMAILS } }).select("_id");
  const ids = users.map((u) => u._id);
  await Task.deleteMany({ $or: [{ assignedTo: { $in: ids } }, { assignedBy: { $in: ids } }] });
  await User.deleteMany({ email: { $in: EMAILS } });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);
  await cleanup();

  const mgrA = await User.create({
    name: "Manager A",
    email: A_EMAIL,
    password: hashPassword(PASSWORD),
    role: "sales",
    status: "active",
  });
  const mgrB = await User.create({
    name: "Manager B",
    email: B_EMAIL,
    password: hashPassword(PASSWORD),
    role: "sales",
    status: "active",
  });
  // An executive from before the reporting line existed
  const orphan = await User.create({
    name: "Orphan Exec",
    email: ORPHAN,
    password: hashPassword(PASSWORD),
    role: "sales_exec",
    status: "active",
  });

  const tokenA = await login(A_EMAIL, PASSWORD);
  const tokenB = await login(B_EMAIL, PASSWORD);
  check("both managers can sign in", Boolean(tokenA && tokenB));

  /* ------------------------------------------- a manager builds their team */

  console.log("\nAdding people to a team");

  const createdA = await json(tokenA, "POST", "/sales/team", {
    name: "Exec A",
    email: EXEC_A,
    phone: "9990000001",
  });
  check("manager A opens an account", createdA.status === 201, createdA.data?.message);

  const execA = await User.findOne({ email: EXEC_A });
  check(
    "the new executive reports to the manager who opened it",
    String(execA?.reportsTo) === String(mgrA._id)
  );

  const createdB = await json(tokenB, "POST", "/sales/team", {
    name: "Exec B",
    email: EXEC_B,
    phone: "9990000002",
  });
  check("manager B opens their own account", createdB.status === 201);
  const execB = await User.findOne({ email: EXEC_B });

  /* ------------------------------------------------ one manager, one team */

  console.log("\nWhose team is whose");

  const listA = await json(tokenA, "GET", "/sales/team");
  const namesA = (listA.data?.items || []).map((i) => i.email);
  check("manager A sees their own executive", namesA.includes(EXEC_A));
  check("manager A does not see manager B's executive", !namesA.includes(EXEC_B));
  check("manager A does not see manager B", !namesA.includes(B_EMAIL));
  check("manager A sees themselves on the list", namesA.includes(A_EMAIL));

  const reachB = await json(tokenA, "GET", `/sales/team/${execB._id}`);
  check("reading another manager's person is a 404", reachB.status === 404);

  const editB = await json(tokenA, "PUT", `/sales/team/${execB._id}`, { name: "Renamed" });
  check("editing another manager's person is a 404", editB.status === 404);

  const killB = await json(tokenA, "DELETE", `/sales/team/${execB._id}`);
  check("deleting another manager's person is a 404", killB.status === 404);

  /* ------------------------------------------------- the unclaimed listing */

  console.log("\nExecutives nobody manages");

  const waiting = await json(tokenA, "GET", "/sales/team", null);
  check("the team list reports how many are unclaimed", (waiting.data?.counts?.unclaimed ?? 0) >= 1);

  const unclaimed = await json(tokenA, "GET", "/sales/team?view=unclaimed");
  const waitingEmails = (unclaimed.data?.items || []).map((i) => i.email);
  check("the pre-existing executive shows as unclaimed", waitingEmails.includes(ORPHAN));
  check("somebody already on a team is not listed as unclaimed", !waitingEmails.includes(EXEC_A));

  const claimed = await json(tokenA, "PUT", `/sales/team/${orphan._id}/claim`);
  check("a manager can claim them", claimed.status === 200, claimed.data?.message);

  const claimAgain = await json(tokenB, "PUT", `/sales/team/${orphan._id}/claim`);
  check("a second manager cannot take them afterwards", claimAgain.status === 404);

  const takeMine = await json(tokenB, "PUT", `/sales/team/${execA._id}/claim`);
  check("claiming somebody else's executive is refused", takeMine.status === 404);

  /* ------------------------------------------------------ assigning work */

  console.log("\nAssigning work");

  const execToken = await login(EXEC_A, "9990000001");
  check("the new executive can sign in with their mobile", Boolean(execToken));

  const assigned = await json(tokenA, "POST", "/sales/tasks", {
    title: "Call the Sharma account back",
    description: "They asked for revised pricing",
    assignedTo: String(execA._id),
    priority: "high",
    dueDate: "2020-01-01",
  });
  check("manager assigns a task", assigned.status === 201, assigned.data?.message);
  const taskId = assigned.data?.item?._id;

  const crossAssign = await json(tokenB, "POST", "/sales/tasks", {
    title: "Not yours",
    assignedTo: String(execA._id),
  });
  check(
    "a manager cannot assign onto another manager's executive",
    crossAssign.status === 400,
    crossAssign.data?.message
  );

  const execList = await json(execToken, "GET", "/sales/tasks");
  const execTitles = (execList.data?.items || []).map((t) => t.title);
  check("the executive sees the task on their own list", execTitles.includes("Call the Sharma account back"));
  check("the executive is not offered the assign button", execList.data?.canAssign === false);
  check("an overdue task is counted", (execList.data?.counts?.overdue ?? 0) >= 1);

  const dot = await json(execToken, "GET", "/sales/tasks/new-count");
  check("new work lights the dot", (dot.data?.count ?? 0) >= 1);
  await json(execToken, "PUT", "/sales/tasks/seen");
  const dotAfter = await json(execToken, "GET", "/sales/tasks/new-count");
  check("opening the list puts the dot out", dotAfter.data?.count === 0);

  /* ------------------------------------------- what an executive may change */

  console.log("\nWhat the executive may change");

  const cannotCreate = await json(execToken, "POST", "/sales/tasks", {
    title: "Made this up myself",
    assignedTo: String(execA._id),
  });
  check("an executive cannot assign tasks", cannotCreate.status === 403, cannotCreate.data?.message);

  const moved = await json(execToken, "PUT", `/sales/tasks/${taskId}`, {
    status: "completed",
    title: "Renamed by the assignee",
    priority: "low",
  });
  check("an executive may move the status", moved.status === 200);
  check("the status actually moved", moved.data?.item?.status === "completed");
  check("the title they also sent was ignored", moved.data?.item?.title === "Call the Sharma account back");
  check("so was the priority", moved.data?.item?.priority === "high");

  const cannotDelete = await json(execToken, "DELETE", `/sales/tasks/${taskId}`);
  check("an executive cannot delete a task", cannotDelete.status === 403);

  /* ------------------------------------------ the other manager sees none of it */

  console.log("\nTasks stay inside the team");

  const bList = await json(tokenB, "GET", "/sales/tasks");
  const bTitles = (bList.data?.items || []).map((t) => t.title);
  check("manager B's list does not carry manager A's task", !bTitles.includes("Call the Sharma account back"));

  const bRead = await json(tokenB, "GET", `/sales/tasks/${taskId}`);
  check("manager B cannot open it by id", bRead.status === 404);

  const bEdit = await json(tokenB, "PUT", `/sales/tasks/${taskId}`, { status: "pending" });
  check("manager B cannot edit it", bEdit.status === 404);

  const aRead = await json(tokenA, "GET", `/sales/tasks/${taskId}`);
  check("the manager who assigned it can still open it", aRead.status === 200);

  const aDelete = await json(tokenA, "DELETE", `/sales/tasks/${taskId}`);
  check("the manager who assigned it can delete it", aDelete.status === 200);

  /* ---------------------------------------------- the assign-to dropdown */

  console.log("\nThe assign-to list");

  const peopleA = await json(tokenA, "GET", "/sales/people");
  const peopleEmailsA = (peopleA.data?.items || []).map((p) => p.email);
  check("a manager's dropdown holds their own team", peopleEmailsA.includes(EXEC_A));
  check("and not another manager's", !peopleEmailsA.includes(EXEC_B));

  const peopleExec = await json(execToken, "GET", "/sales/people");
  const peopleEmailsExec = (peopleExec.data?.items || []).map((p) => p.email);
  check("an executive's dropdown holds their manager", peopleEmailsExec.includes(A_EMAIL));
  check("and not the other team", !peopleEmailsExec.includes(EXEC_B));

  await cleanup();
  await mongoose.disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
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
