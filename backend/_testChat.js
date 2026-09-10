// Phase 12: sending a chat message once.
//
// The bug this covers: a message the sender had just sent appeared twice on
// their own screen, while everybody else saw it once. Both copies were real —
// the server pushes a saved message to everyone watching the room, and the
// sender is watching it too, so the socket frame and the HTTP response are two
// deliveries of the same row.
//
// So the contract the fix leans on is what gets checked here: one send makes
// exactly one row, fires exactly one socket event, and that event carries the
// same _id the POST answered with. Without that last part no amount of
// de-duplicating in the browser would work.
import { createRequire } from "module";
import dotenv from "dotenv";
import mongoose from "mongoose";

import Message from "./models/Message.js";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const BASE = `http://localhost:${PORT}/api`;
const ORIGIN = `http://localhost:${PORT}`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

/**
 * socket.io-client is the browser's dependency, not the server's, so it is
 * borrowed from the frontend rather than added here for the sake of one test.
 */
const require = createRequire(import.meta.url);
let ioClient = null;
try {
  ({ io: ioClient } = require("../frontend/node_modules/socket.io-client"));
} catch {
  console.error("socket.io-client not found — run npm install in ../frontend first");
  process.exit(1);
}

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

/** Connect, and resolve once the handshake is through. */
const connect = (token) =>
  new Promise((resolve, reject) => {
    const socket = ioClient(ORIGIN, {
      auth: { token },
      transports: ["websocket"],
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (err) => reject(new Error(err.message)));
    setTimeout(() => reject(new Error("socket did not connect in time")), 8000);
  });

const join = (socket, scope, roomId) =>
  new Promise((resolve) => socket.emit("chat:join", { scope, roomId }, resolve));

/** Everything that lands in `ms`, so a second copy is caught rather than missed. */
const collectFor = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TEXT = `PHASE12 one-send ${Date.now()}`;

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

  if (admin.status !== 200 || leader.status !== 200) {
    console.error("Could not sign in as admin and operations manager");
    process.exit(1);
  }

  const A = admin.data.token;
  const L = leader.data.token;
  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;

  await mongoose.connect(process.env.MONGO_URI);
  await Message.deleteMany({ text: /^PHASE12/ });

  console.log("Signed in as admin and operations manager\n");

  /* ------------------------------------------------ both sides listening */

  console.log("=== the sender and the admin are both watching the thread ===");

  const leaderSocket = await connect(L);
  const adminSocket = await connect(A);
  check("the sender's socket connects", leaderSocket.connected);
  check("the admin's socket connects", adminSocket.connected);

  // scope "operations_manager", room = the leader's own id — the thread they share
  const joinedLeader = await join(leaderSocket, "operations_manager", leaderId);
  const joinedAdmin = await join(adminSocket, "operations_manager", leaderId);
  check("the sender joins their own thread", joinedLeader?.ok === true, joinedLeader?.message);
  check("the admin joins it too", joinedAdmin?.ok === true, joinedAdmin?.message);

  const seenByLeader = [];
  const seenByAdmin = [];
  leaderSocket.on("chat:message", (payload) => seenByLeader.push(payload));
  adminSocket.on("chat:message", (payload) => seenByAdmin.push(payload));

  /* ------------------------------------------------------------- one send */

  console.log("\n=== one send ===");

  const sent = await json(L, "POST", `/leader/chat/admin/${leaderId}`, { text: TEXT });
  check("the message is accepted", sent.status === 201, sent.data?.message);

  const httpId = String(sent.data?.data?._id || "");
  check("the response carries the saved message", Boolean(httpId));

  // Give any second delivery time to turn up rather than assuming it will not
  await collectFor(1200);

  console.log("  -- in the database --");
  const rows = await Message.find({ text: TEXT });
  check("exactly one row was written", rows.length === 1, `${rows.length} rows`);

  console.log("  -- over the socket --");
  const mine = seenByLeader.filter((p) => p.message?.text === TEXT);
  const theirs = seenByAdmin.filter((p) => p.message?.text === TEXT);

  check("the sender is pushed exactly one copy", mine.length === 1, `${mine.length} events`);
  check("the admin is pushed exactly one copy", theirs.length === 1, `${theirs.length} events`);

  /**
   * The one that makes de-duplicating possible at all: the copy that arrives
   * over the socket and the copy the POST answered with have to be the same
   * message, identified the same way. If these ever diverge, the sender's
   * screen goes back to showing two bubbles.
   */
  check(
    "the socket copy is the same message the POST returned",
    mine[0] && String(mine[0].message._id) === httpId,
    `${mine[0]?.message?._id} vs ${httpId}`
  );
  check(
    "and the admin was pushed that same message",
    theirs[0] && String(theirs[0].message._id) === httpId,
    `${theirs[0]?.message?._id} vs ${httpId}`
  );
  check(
    "the pushed copy is addressed to the right thread",
    mine[0]?.scope === "operations_manager" && String(mine[0]?.roomId) === String(leaderId),
    `${mine[0]?.scope}:${mine[0]?.roomId}`
  );

  /* --------------------------------------------------- and on a reload */

  console.log("\n=== and reloading the thread shows it once ===");

  const reloadedLeader = await json(L, "GET", `/leader/chat/admin/${leaderId}`);
  const inLeaderThread = (reloadedLeader.data?.messages || []).filter((m) => m.text === TEXT);
  check("the sender's thread holds one copy", inLeaderThread.length === 1, `${inLeaderThread.length}`);

  const reloadedAdmin = await json(A, "GET", `/admin/chat/operations_manager/${leaderId}`);
  const inAdminThread = (reloadedAdmin.data?.messages || []).filter((m) => m.text === TEXT);
  check("the admin's thread holds one copy", inAdminThread.length === 1, `${inAdminThread.length}`);

  check(
    "and both are looking at the same row",
    inLeaderThread[0] && inAdminThread[0] &&
      String(inLeaderThread[0]._id) === String(inAdminThread[0]._id),
    `${inLeaderThread[0]?._id} vs ${inAdminThread[0]?._id}`
  );

  /* ----------------------------------- sending twice really is two rows */

  console.log("\n=== a genuine second send is still a second message ===");

  const again = await json(L, "POST", `/leader/chat/admin/${leaderId}`, { text: TEXT });
  check("sending the same text again is accepted", again.status === 201);
  await collectFor(600);

  const bothRows = await Message.find({ text: TEXT });
  check("now there are two rows", bothRows.length === 2, `${bothRows.length}`);
  check(
    "with different ids, so the screen can tell them apart",
    String(bothRows[0]._id) !== String(bothRows[1]._id)
  );

  /* ============================ the rule the screen applies to those two */

  /**
   * The browser's half of the fix, checked directly rather than through a
   * rendered component: whichever delivery arrives first, the thread ends up
   * holding one copy — and two genuinely different messages still both land.
   */
  console.log("\n=== the screen keeps one copy, whichever arrives first ===");

  const { withMessage } = await import("../frontend/src/shared/chat.js");

  const saved = { _id: httpId, text: TEXT };
  const other = { _id: `${httpId}-second`, text: TEXT };

  check(
    "socket first, then the POST response",
    withMessage(withMessage([], saved), saved).length === 1
  );
  check(
    "POST response first, then the socket",
    withMessage(withMessage([], { ...saved }), { ...saved }).length === 1
  );
  check(
    "an id that arrives as a string still matches one stored as an object id",
    withMessage([{ _id: { toString: () => httpId } }], saved).length === 1
  );
  check("a different message is still added", withMessage([saved], other).length === 2);
  check("and a delivery with no id is ignored rather than duplicated", [
    withMessage([saved], { text: TEXT }).length === 1,
    withMessage([], undefined).length === 0,
  ].every(Boolean));

  /* --------------------------------------------------------------- cleanup */

  leaderSocket.disconnect();
  adminSocket.disconnect();

  await Message.deleteMany({ text: /^PHASE12/ });
  check("nothing left behind", (await Message.countDocuments({ text: /^PHASE12/ })) === 0);

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
