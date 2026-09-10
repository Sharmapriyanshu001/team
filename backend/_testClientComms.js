// Admin ↔ Client communication, and who else is authorised to join in.
//
// The rule the company runs on: the administrator can always talk to a
// client, and nobody else can unless the administrator says so. Operations Managers
// and employees each have their own switch, off or on independently, and a
// switch that only hides a tab is not a switch at all — so what is checked
// here is the server, with the tab bypassed entirely.
//
// The three threads are separate conversations, not one room with three
// people in it:
//
//   client        the client and the administrators
//   client_leader the client and the leads on their projects
//   client_employee the client and the people doing the work
//
// A client's own messages must never leak between them, and neither must a
// client's thread reach a leader who has nothing to do with that client.
//
// Run against a server started on PORT_UNDER_TEST (default 5099).
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Client from "./models/Client.js";
import Project from "./models/Project.js";
import Message from "./models/Message.js";
import Setting from "./models/Setting.js";
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

const TAG = `cc_${Date.now()}`;
const PASSWORD = "9700000000";

const madeUsers = [];
const madeClients = [];
const madeProjects = [];

/**
 * The general settings row is a live company record, not a fixture. Whatever
 * the two client-chat switches were set to when this started is put back at
 * the end, whether the suite passes, fails or throws.
 */
let originalFlags = null;

const setFlags = async ({ leader, employee }) => {
  await Setting.updateOne(
    { key: "general" },
    { $set: { leaderClientChat: leader, employeeClientChat: employee } },
    { upsert: true }
  );
};

const seedUser = async (role, name) => {
  const person = await User.create({
    name: `${name} ${TAG}`,
    email: `${name.toLowerCase()}.${TAG}@example.com`,
    password: hashPassword(PASSWORD),
    role,
    phone: PASSWORD,
    status: "active",
  });
  madeUsers.push(person._id);
  return person;
};

const cleanup = async () => {
  if (originalFlags) await setFlags(originalFlags);
  // roomId is an ObjectId on the schema — matching it as a string deletes nothing
  await Message.deleteMany({ roomId: { $in: madeClients } });
  await Project.deleteMany({ _id: { $in: madeProjects } });
  await Client.deleteMany({ _id: { $in: madeClients } });
  await User.deleteMany({ _id: { $in: madeUsers } });
  await User.deleteMany({ email: new RegExp(TAG) });
  await Notification.deleteMany({ user: { $in: [...madeUsers, ...madeClients] } });
};

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

  const settings = await Setting.findOne({ key: "general" });
  originalFlags = {
    leader: Boolean(settings?.leaderClientChat),
    employee: Boolean(settings?.employeeClientChat),
  };

  console.log("\n▸ A client, their project, and the people on it");

  const leader = await seedUser("operations_manager", "ChatLead");
  const otherLeader = await seedUser("operations_manager", "OtherLead");
  const employee = await seedUser("employee", "ChatEmp");

  const client = await Client.create({
    name: `Client ${TAG}`,
    email: `client.${TAG}@example.com`,
    company: `Acme ${TAG}`,
    password: hashPassword(PASSWORD),
    status: "active",
  });
  madeClients.push(client._id);

  const project = await Project.create({
    name: `Project ${TAG}`,
    client: client._id,
    operationsManager: leader._id,
    members: [employee._id],
  });
  madeProjects.push(project._id);

  const adminToken = (
    await call(null, "POST", "/admin/login", {
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    })
  ).data?.token;

  const clientToken = (
    await call(null, "POST", "/client/login", { email: client.email, password: PASSWORD })
  ).data?.token;

  const leaderToken = (
    await call(null, "POST", "/leader/login", { email: leader.email, password: PASSWORD })
  ).data?.token;

  const otherToken = (
    await call(null, "POST", "/leader/login", { email: otherLeader.email, password: PASSWORD })
  ).data?.token;

  const employeeToken = (
    await call(null, "POST", "/employee/login", { email: employee.email, password: PASSWORD })
  ).data?.token;

  check("the administrator can sign in", Boolean(adminToken));
  check("the client can sign in", Boolean(clientToken));
  check("the project's lead can sign in", Boolean(leaderToken));
  check("an unrelated lead can sign in", Boolean(otherToken));
  check("the employee on the project can sign in", Boolean(employeeToken));

  /* ---------------------------------------------- admin ↔ client, always on */

  console.log("\n▸ Admin ↔ Client — never gated");

  // Both switches off: the admin channel must be unaffected by either
  await setFlags({ leader: false, employee: false });

  const clientToAdmin = await call(clientToken, "POST", `/client/chat/admin/${client._id}`, {
    text: `Where are we with the build? ${TAG}`,
  });
  check(
    "a client can write to the administrator with every other channel switched off",
    clientToAdmin.status === 201 || clientToAdmin.status === 200,
    clientToAdmin.data?.message
  );

  const adminRooms = await call(adminToken, "GET", "/admin/chat/rooms/client");
  const room = (adminRooms.data?.rooms || []).find((r) => String(r.id) === String(client._id));
  check("the client's thread appears in the admin's list", Boolean(room), adminRooms.data?.message);

  const adminReads = await call(adminToken, "GET", `/admin/chat/client/${client._id}`);
  check(
    "and the admin can read what they wrote",
    (adminReads.data?.messages || []).some((m) => m.text.includes(TAG)),
    `${adminReads.data?.messages?.length} messages`
  );

  const adminReplies = await call(adminToken, "POST", `/admin/chat/client/${client._id}`, {
    text: `Drawings go out on Friday ${TAG}`,
  });
  check(
    "the admin can reply",
    adminReplies.status === 201 || adminReplies.status === 200,
    adminReplies.data?.message
  );

  const clientNote = await waitFor(() =>
    Notification.findOne({ user: client._id, userModel: "Client", type: "chat" })
  );
  check(
    "and the client is told, rather than having to go and look",
    Boolean(clientNote),
    clientNote?.title
  );

  /* ------------------------------------------------------- the leader switch */

  console.log("\n▸ The operations manager channel, switched off");

  const leaderOff = await call(leaderToken, "GET", "/leader/chat/rooms/client");
  check(
    "the lead is told the channel is off",
    leaderOff.status === 403,
    `${leaderOff.status} ${leaderOff.data?.message}`
  );

  /**
   * The tab is hidden, which is the easy half. This is the half that matters:
   * the room id is known, so a request that skips the UI entirely still has
   * to be refused by the server.
   */
  const leaderSneaksIn = await call(leaderToken, "POST", `/leader/chat/client/${client._id}`, {
    text: `Going round the switch ${TAG}`,
  });
  check(
    "and cannot write to the client anyway, with the tab bypassed",
    leaderSneaksIn.status === 403,
    `${leaderSneaksIn.status} ${leaderSneaksIn.data?.message}`
  );

  const leaderSneaksRead = await call(leaderToken, "GET", `/leader/chat/client/${client._id}`);
  check(
    "nor read the thread",
    leaderSneaksRead.status === 403,
    `${leaderSneaksRead.status} ${leaderSneaksRead.data?.message}`
  );

  console.log("\n▸ The operations manager channel, switched on");

  await setFlags({ leader: true, employee: false });

  const leaderOn = await call(leaderToken, "GET", "/leader/chat/rooms/client");
  check("the lead now has the client in their list", leaderOn.status === 200);
  check(
    "and it is their own client",
    (leaderOn.data?.rooms || []).some((r) => String(r.id) === String(client._id)),
    JSON.stringify((leaderOn.data?.rooms || []).map((r) => r.name))
  );

  const leaderWrites = await call(leaderToken, "POST", `/leader/chat/client/${client._id}`, {
    text: `Lead here — drawings are with the printer ${TAG}`,
  });
  check(
    "the lead can write to their client",
    leaderWrites.status === 201 || leaderWrites.status === 200,
    leaderWrites.data?.message
  );

  const strangerWrites = await call(otherToken, "POST", `/leader/chat/client/${client._id}`, {
    text: `A lead with no business here ${TAG}`,
  });
  check(
    "but a lead with no project for this client still cannot — the switch is not a free pass",
    strangerWrites.status === 403,
    `${strangerWrites.status} ${strangerWrites.data?.message}`
  );

  /* ---------------------------------------------------- the employee switch */

  console.log("\n▸ The two switches are independent");

  const employeeStillOff = await call(employeeToken, "GET", "/employee/chat/rooms/client");
  check(
    "turning the lead channel on did not turn the employee one on",
    employeeStillOff.status === 403,
    `${employeeStillOff.status} ${employeeStillOff.data?.message}`
  );

  const employeeSneaksIn = await call(employeeToken, "POST", `/employee/chat/client/${client._id}`, {
    text: `Employee going round the switch ${TAG}`,
  });
  check(
    "and the employee is refused at the server, not just in the UI",
    employeeSneaksIn.status === 403,
    `${employeeSneaksIn.status} ${employeeSneaksIn.data?.message}`
  );

  await setFlags({ leader: false, employee: true });

  const employeeOn = await call(employeeToken, "GET", "/employee/chat/rooms/client");
  check("switched on, the employee reaches their client", employeeOn.status === 200);

  const leaderOffAgain = await call(leaderToken, "POST", `/leader/chat/client/${client._id}`, {
    text: `Lead after the switch went off ${TAG}`,
  });
  check(
    "and the lead is shut out again the moment their own switch goes off",
    leaderOffAgain.status === 403,
    `${leaderOffAgain.status} ${leaderOffAgain.data?.message}`
  );

  /* -------------------------------------------------- the threads stay apart */

  console.log("\n▸ The three threads are three conversations");

  const adminThread = await call(adminToken, "GET", `/admin/chat/client/${client._id}`);
  const adminTexts = (adminThread.data?.messages || []).map((m) => m.text);
  check(
    "what the lead wrote to the client is not in the admin thread",
    !adminTexts.some((t) => t.includes("Lead here")),
    JSON.stringify(adminTexts.filter((t) => t.includes(TAG)))
  );
  check(
    "and what the client wrote to the admin still is",
    adminTexts.some((t) => t.includes("Where are we with the build"))
  );

  const scopes = await Message.aggregate([
    { $match: { roomId: client._id } },
    { $group: { _id: "$scope", count: { $sum: 1 } } },
  ]);
  const byScope = Object.fromEntries(scopes.map((s) => [s._id, s.count]));
  check(
    "the client thread and the lead thread are stored under different scopes",
    (byScope.client || 0) > 0 && (byScope.client_leader || 0) > 0,
    JSON.stringify(byScope)
  );

  /* ------------------------------------------------------- what the client sees */

  console.log("\n▸ And the client sees only what is switched on");

  const clientLeaderTab = await call(clientToken, "GET", "/client/chat/rooms/operations_manager");
  check(
    "with the lead channel off, the client's lead tab is off too",
    clientLeaderTab.status === 403,
    `${clientLeaderTab.status} ${clientLeaderTab.data?.message}`
  );

  const clientAdminTab = await call(clientToken, "GET", "/client/chat/rooms/admin");
  check("while the admin tab is always there", clientAdminTab.status === 200);

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
