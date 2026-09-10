// Phase 13: the admin gets told.
//
// Plenty of code was already writing notifications for admins — a client
// messaging them, a client asking for a meeting, an employee submitting code —
// and the admin panel had no route that returned any of it. The rows were
// created and read by nobody.
//
// So this checks both halves: that a message or a meeting request really does
// reach the admin's inbox and names who sent it, and that the inbox itself
// behaves — unread counts, marking read, and staying one admin's own.
//
// It runs against an admin account of its own rather than the real one. Not
// fussiness: the run marks everything read, and doing that to a working
// inbox would wipe out a backlog somebody had not got to yet. Notifications
// go to every admin, so a throwaway one receives the same rows.
import dotenv from "dotenv";
import mongoose from "mongoose";

import User, { ADMIN_ROLES } from "./models/User.js";
import Client from "./models/Client.js";
import Notification from "./models/Notification.js";
import Meeting from "./models/Meeting.js";
import Message from "./models/Message.js";
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

const CLIENT_EMAIL = "phase13.client@example.com";
const CLIENT_PASSWORD = "phase13-test-pass";
const ADMIN_EMAIL = "phase13.admin@example.com";
const ADMIN_PASSWORD = "phase13-admin-pass";
const STAMP = `PHASE13-${Date.now()}`;

/* --------------------------------------------------------------------- run */

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  /**
   * An admin of this test's own. Everything below marks things read, and
   * doing that to the real admin's inbox would clear a backlog nobody asked
   * to have cleared. Every admin is notified of the same things, so this one
   * sees exactly what the real one would.
   */
  await User.deleteMany({ email: ADMIN_EMAIL });
  await User.create({
    name: "Phase 13 Admin",
    email: ADMIN_EMAIL,
    password: hashPassword(ADMIN_PASSWORD),
    role: "admin",
    status: "active",
  });

  const admin = await json(null, "POST", "/admin/login", {
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
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
    console.error("Could not sign in as admin, operations manager and employee");
    process.exit(1);
  }

  const A = admin.data.token;
  const L = leader.data.token;
  const E = employee.data.token;

  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;
  const employeeId = (await json(E, "GET", "/employee/me")).data?.employee?.id;

  // Clear anything a killed run left behind
  await Client.deleteMany({ email: CLIENT_EMAIL });
  await Notification.deleteMany({ message: /^PHASE13/ });
  await Message.deleteMany({ text: /^PHASE13/ });
  await Meeting.deleteMany({ title: /^PHASE13/ });

  const client = await Client.create({
    name: "Phase 13 Client",
    company: "Phase 13 Ltd",
    email: CLIENT_EMAIL,
    password: hashPassword(CLIENT_PASSWORD),
    portalAccess: true,
    status: "active",
  });

  const clientLogin = await json(null, "POST", "/client/login", {
    email: CLIENT_EMAIL,
    password: CLIENT_PASSWORD,
  });
  check("the test client can sign in", clientLogin.status === 200, clientLogin.data?.message);
  const C = clientLogin.data?.token;

  const cleanup = async () => {
    // By message, so the copies sent to every other admin go as well
    await Notification.deleteMany({ message: /^PHASE13/ });
    await Message.deleteMany({ text: /^PHASE13/ });
    await Meeting.deleteMany({ title: /^PHASE13/ });
    await Client.deleteMany({ email: CLIENT_EMAIL });
    await User.deleteMany({ email: ADMIN_EMAIL });
  };

  if (!C) {
    await cleanup();
    await mongoose.disconnect();
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  console.log("Signed in as admin, operations manager, employee and client\n");

  /* ---------------------------------------- the inbox exists at all now */

  console.log("=== the admin has an inbox ===");

  const before = await json(A, "GET", "/admin/notifications");
  check("it answers", before.status === 200, `${before.status}`);
  check("with a list and an unread count", Array.isArray(before.data?.items));

  const startingUnread = before.data?.unread || 0;

  /* ------------------------------------------ a client sends a message */

  console.log("\n=== a client messages the admin ===");

  const clientMsg = await json(C, "POST", `/client/chat/admin/${client._id}`, {
    text: `${STAMP} client to admin`,
  });
  check("the message is sent", clientMsg.status === 201, clientMsg.data?.message);

  const afterClient = await json(A, "GET", "/admin/notifications");
  const fromClient = (afterClient.data?.items || []).find((n) =>
    (n.message || "").includes(`${STAMP} client to admin`)
  );

  check("the admin is told", Boolean(fromClient));
  check("and told who by", fromClient?.title === "Message from Phase 13 Client", fromClient?.title);
  check("filed as a chat", fromClient?.type === "chat", fromClient?.type);
  check(
    "pointing at the thread it came from",
    fromClient?.link === "/admin/chat/clients",
    fromClient?.link
  );
  check("and unread", fromClient?.read === false);

  /* ------------------------------------------- a client asks to meet */

  console.log("\n=== a client asks for a meeting ===");

  const when = new Date(Date.now() + 3 * 86400000).toISOString();
  const meeting = await json(C, "POST", "/client/meetings", {
    title: `${STAMP} kickoff`,
    scheduledAt: when,
    agenda: "Talk it through",
  });
  check("the request goes in", meeting.status === 201, meeting.data?.message);

  const afterMeeting = await json(A, "GET", "/admin/notifications");
  const fromMeeting = (afterMeeting.data?.items || []).find((n) =>
    (n.title || "").includes("Meeting requested")
  );

  check("the admin is told about that too", Boolean(fromMeeting));
  check(
    "naming the client who asked",
    (fromMeeting?.title || "").includes("Phase 13 Client"),
    fromMeeting?.title
  );
  check(
    "and linking to where it can be answered",
    fromMeeting?.link === "/admin/clients/meetings",
    fromMeeting?.link
  );

  /* --------------------------------- an employee and a leader write in */

  console.log("\n=== staff message the admin ===");

  const empMsg = await json(E, "POST", `/employee/chat/admin/${employeeId}`, {
    text: `${STAMP} employee to admin`,
  });
  check("an employee can write in", empMsg.status === 201, empMsg.data?.message);

  /**
   * This one had no branch at all: a leader writing to the admin was the one
   * message in the app that pinged nobody, and the admin found out by
   * happening to open the thread.
   */
  const leadMsg = await json(L, "POST", `/leader/chat/admin/${leaderId}`, {
    text: `${STAMP} leader to admin`,
  });
  check("an operations manager can too", leadMsg.status === 201, leadMsg.data?.message);

  const afterStaff = await json(A, "GET", "/admin/notifications");
  const items = afterStaff.data?.items || [];

  check(
    "the employee's message reached the inbox",
    items.some((n) => (n.message || "").includes(`${STAMP} employee to admin`))
  );
  check(
    "and so did the operations manager's",
    items.some((n) => (n.message || "").includes(`${STAMP} leader to admin`)),
    items.filter((n) => (n.message || "").startsWith(STAMP)).length + " stamped rows"
  );

  const fromLeader = items.find((n) => (n.message || "").includes(`${STAMP} leader to admin`));
  check("named after the leader", fromLeader?.title === "Message from kamal", fromLeader?.title);
  check(
    "and pointing at the operations manager threads",
    fromLeader?.link === "/admin/chat/operations-managers",
    fromLeader?.link
  );

  /* ------------------------------------------------ the count adds up */

  console.log("\n=== the unread count and marking read ===");

  const counted = await json(A, "GET", "/admin/notifications");
  check(
    "exactly the four new things are waiting",
    (counted.data?.unread || 0) === startingUnread + 4,
    `${counted.data?.unread} vs ${startingUnread} before`
  );

  const unreadOnly = await json(A, "GET", "/admin/notifications?filter=unread");
  check(
    "the unread filter returns only unread rows",
    (unreadOnly.data?.items || []).every((n) => n.read === false)
  );
  check(
    "and the count is the whole count, not the filtered one",
    unreadOnly.data?.unread === counted.data?.unread,
    `${unreadOnly.data?.unread} vs ${counted.data?.unread}`
  );

  const chatOnly = await json(A, "GET", "/admin/notifications?type=chat");
  check(
    "filtering by type works",
    (chatOnly.data?.items || []).every((n) => n.type === "chat") &&
      (chatOnly.data?.items || []).length > 0
  );

  const one = await json(A, "PUT", `/admin/notifications/${fromClient._id}/read`);
  check("one can be marked read", one.status === 200, one.data?.message);

  const afterOne = await json(A, "GET", "/admin/notifications");
  check(
    "and the count drops by one",
    (afterOne.data?.unread || 0) === (counted.data?.unread || 0) - 1,
    `${afterOne.data?.unread} vs ${counted.data?.unread}`
  );

  const all = await json(A, "PUT", "/admin/notifications/read-all");
  check("everything can be marked read", all.status === 200, all.data?.message);

  const afterAll = await json(A, "GET", "/admin/notifications");
  check("leaving nothing unread", (afterAll.data?.unread || 0) === 0, `${afterAll.data?.unread}`);

  /* --------------------------------------------------------- security */

  console.log("\n=== the inbox is one account's own ===");

  for (const [label, token] of [
    ["operations manager", L],
    ["employee", E],
    ["client", C],
  ]) {
    const reach = await json(token, "GET", "/admin/notifications");
    check(`a ${label} cannot open it`, reach.status === 403, `${reach.status}`);
  }

  const noToken = await json(null, "GET", "/admin/notifications");
  check("nor can somebody with no token", noToken.status === 401, `${noToken.status}`);

  /**
   * One admin marking another's row read would be reaching into somebody
   * else's inbox. The route is scoped to the reader, so it answers 404 rather
   * than quietly doing it.
   */
  const strangerRow = await Notification.create({
    user: leaderId,
    userModel: "User",
    type: "system",
    title: "PHASE13 not the admin's",
    message: `${STAMP} belongs to the leader`,
  });

  const notMine = await json(A, "PUT", `/admin/notifications/${strangerRow._id}/read`);
  check("cannot mark a row that is not theirs", notMine.status === 404, `${notMine.status}`);
  check(
    "and it really was left unread",
    (await Notification.findById(strangerRow._id))?.read === false
  );

  const stillHidden = await json(A, "GET", "/admin/notifications");
  check(
    "nor does it show up in their list",
    !(stillHidden.data?.items || []).some((n) => String(n._id) === String(strangerRow._id))
  );

  /* --------------------------------------------------------------- cleanup */

  await Notification.deleteMany({ _id: strangerRow._id });
  await cleanup();

  const left =
    (await Notification.countDocuments({ message: /^PHASE13/ })) +
    (await Client.countDocuments({ email: CLIENT_EMAIL })) +
    (await User.countDocuments({ email: ADMIN_EMAIL })) +
    (await Meeting.countDocuments({ title: /^PHASE13/ }));
  check("nothing left behind", left === 0, `${left}`);

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
