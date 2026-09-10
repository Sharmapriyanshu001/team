// Phase 8: the admin is the only authority over a code project.
//
// What this is actually testing is the sentence "hiding a button is not access
// control". Every check below goes straight at the API with a leader's or an
// employee's own token — no UI involved — and asks whether the server refuses
// on its own. The request system is checked the same way: that asking is all
// it does, and that approving is the only thing that changes anything.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

import User from "./models/User.js";
import Role from "./models/Role.js";
import ProjectRequest from "./models/ProjectRequest.js";
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

/* ------------------------------------------------------- stored-zip writer */

let table = null;
const crc32 = (buf) => {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const buildZip = (entries) => {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "", "utf8");
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 8);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);

    parts.push(head, nameBuf, data);
    const localOffset = offset;
    offset += head.length + nameBuf.length + data.length;

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(data.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(localOffset, 42);
    central.push(c, nameBuf);
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...parts, centralBuf, end]);
};

/* ------------------------------------------------------------------ helpers */

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

const upload = async (token, zipBuffer, fields) => {
  const form = new FormData();
  form.append("file", new Blob([zipBuffer], { type: "application/zip" }), fields.filename);
  Object.entries(fields).forEach(([k, v]) => k !== "filename" && form.append(k, v));

  const res = await fetch(BASE + "/admin/code-projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
};

const purge = async (token, projectId) => {
  const found = await json(token, "GET", `/admin/code-projects/${projectId}`);
  if (found.status !== 200) return found;

  // Into the bin first if it is not already there — permanent delete refuses
  // anything still live, deliberately
  if (!found.data?.item?.deletedAt) {
    await json(token, "DELETE", `/admin/code-projects/${projectId}`);
  }
  return json(token, "DELETE", `/admin/code-projects/${projectId}/permanent`, {
    confirm: found.data?.item?.name,
  });
};

const ws = (id) => path.resolve("uploads", "workspaces", id);

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
  const employee = await json(null, "POST", "/employee/login", {
    email: "rahul123@gmail.com",
    password: "8003609515",
  });

  if (admin.status !== 200 || leader.status !== 200 || employee.status !== 200) {
    console.error("Could not sign in all three roles");
    process.exit(1);
  }

  const A = admin.data.token;
  const L = leader.data.token;
  const E = employee.data.token;

  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;
  const employeeId = (await json(E, "GET", "/employee/me")).data?.employee?.id;
  console.log("Signed in as admin, operations manager and employee\n");

  const zip = buildZip([
    { name: "index.html", content: "<h1>Authority</h1>" },
    { name: "app.js", content: "console.log('hi')\n" },
  ]);

  const created = await upload(A, zip, {
    filename: "authority.zip",
    name: "PHASE8 Authority Test",
    description: "The original description",
    operationsManagers: JSON.stringify([leaderId]),
    employees: JSON.stringify([employeeId]),
  });
  check("admin created and assigned the project", created.status === 201, created.data?.message);

  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  /* ============================================================ direct API */

  console.log("\n=== assigned staff cannot change the project itself ===");

  // Their own routers have no write route for a project's details, so this is
  // a 404 from the router rather than a 403 from a handler. Either is a
  // refusal; what matters is that nothing succeeds.
  for (const [label, token, base] of [
    ["leader", L, "leader"],
    ["employee", E, "employee"],
  ]) {
    const rename = await json(token, "PUT", `/${base}/code-projects/${id}`, { name: "Mine now" });
    check(`${label} cannot rename it on their own panel`, rename.status >= 400, `${rename.status}`);
  }

  /**
   * Deleting is the exception, and deliberately so: an assignee may delete a
   * project they were given. What they cannot do is destroy one. The route on
   * their panel is soft and has no other mode — _testDeleteFlow.js takes that
   * apart properly; here it only has to be true before the rest of this file
   * can lean on it.
   */
  console.log("\n=== except deleting, which exists but is only ever soft ===");

  const softDelete = await json(E, "DELETE", `/employee/code-projects/${id}`);
  check("employee can delete the project", softDelete.status === 200, softDelete.data?.message);
  check("but every file is still on disk", fs.existsSync(ws(id)));

  const putBack = await json(A, "POST", `/admin/code-projects/${id}/restore`);
  check("and the admin can undo it", putBack.status === 200, putBack.data?.message);

  console.log("\n=== nor by pointing their token at the admin routes ===");

  const adminAttempts = [
    ["rename", "PUT", `/admin/code-projects/${id}`, { name: "Mine now" }],
    ["delete", "DELETE", `/admin/code-projects/${id}`, null],
    ["permanent delete", "DELETE", `/admin/code-projects/${id}/permanent`, { confirm: "PHASE8 Authority Test" }],
    ["restore", "POST", `/admin/code-projects/${id}/restore`, null],
    ["reassign", "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] }],
    ["read the request queue", "GET", "/admin/code-projects/requests", null],
  ];

  for (const [label, method, route, body] of adminAttempts) {
    const asLeader = await json(L, method, route, body);
    check(`leader refused: ${label}`, asLeader.status === 403, `${asLeader.status} ${asLeader.data?.message}`);

    const asEmployee = await json(E, method, route, body);
    check(
      `employee refused: ${label}`,
      asEmployee.status === 403,
      `${asEmployee.status} ${asEmployee.data?.message}`
    );
  }

  const untouched = await json(A, "GET", `/admin/code-projects/${id}`);
  check(
    "after all of that the project is exactly as it was",
    untouched.data?.item?.name === "PHASE8 Authority Test" &&
      (untouched.data?.item?.operationsManagers || []).length === 1,
    untouched.data?.item?.name
  );

  /* ========================================================== raising asks */

  console.log("\n=== what they can do instead is ask ===");

  const noReason = await json(L, "POST", `/leader/code-projects/${id}/requests`, {
    type: "delete",
  });
  check("a request with no reason is refused", noReason.status === 400, noReason.data?.message);

  const noType = await json(L, "POST", `/leader/code-projects/${id}/requests`, {
    reason: "because",
  });
  check("a request with no type is refused", noType.status === 400, noType.data?.message);

  const emptyEdit = await json(E, "POST", `/employee/code-projects/${id}/requests`, {
    type: "edit",
    reason: "no actual change",
    name: "PHASE8 Authority Test",
  });
  check("an edit request that changes nothing is refused", emptyEdit.status === 400, emptyEdit.data?.message);

  const deleteAsk = await json(L, "POST", `/leader/code-projects/${id}/requests`, {
    type: "delete",
    reason: "This was uploaded twice by mistake",
  });
  check("leader can raise a delete request", deleteAsk.status === 201, deleteAsk.data?.message);
  const deleteRequestId = deleteAsk.data?.item?._id;

  const twice = await json(L, "POST", `/leader/code-projects/${id}/requests`, {
    type: "delete",
    reason: "asking again",
  });
  check("the same ask twice is refused", twice.status === 409, twice.data?.message);

  const stillThere = await json(A, "GET", `/admin/code-projects/${id}`);
  check("asking to delete deleted nothing", stillThere.status === 200 && !stillThere.data.item.deletedAt);

  /**
   * The important one. An edit request carries only a name and a description;
   * anything else in the body has to be dropped on the floor, or "request an
   * edit" becomes "write yourself onto the project".
   */
  const smuggle = await json(E, "POST", `/employee/code-projects/${id}/requests`, {
    type: "edit",
    reason: "The client renamed the project",
    name: "PHASE8 Renamed By Request",
    operationsManagers: [employeeId],
    employees: [employeeId, leaderId],
    permissions: { canEdit: true, canCreateDelete: true, canRun: true },
    status: "archived",
  });
  check("employee can raise an edit request", smuggle.status === 201, smuggle.data?.message);
  const editRequestId = smuggle.data?.item?._id;

  const stored = smuggle.data?.item || {};
  check(
    "the stored request holds only the name and description",
    stored.changes?.name === "PHASE8 Renamed By Request" &&
      stored.operationsManagers === undefined &&
      stored.permissions === undefined,
    JSON.stringify(stored.changes)
  );

  console.log("\n=== a request is private to whoever raised it ===");

  const leaderSees = await json(L, "GET", "/leader/code-projects/requests");
  const leaderIds = (leaderSees.data?.items || []).map((r) => r._id);
  check("leader sees their own", leaderIds.includes(deleteRequestId));
  check("leader does not see the employee's", !leaderIds.includes(editRequestId));

  const strangerAsk = await json(E, "POST", `/employee/code-projects/${id}/requests`, {
    type: "delete",
    reason: "trying it on somebody else's project",
  });
  check("assigned employee may still raise their own", strangerAsk.status === 201);
  const employeeDeleteId = strangerAsk.data?.item?._id;

  console.log("\n=== withdrawing is limited to your own, unanswered ask ===");

  const notYours = await json(L, "DELETE", `/leader/code-projects/requests/${editRequestId}`);
  check("cannot withdraw somebody else's", notYours.status === 404, notYours.data?.message);

  const withdrawn = await json(E, "DELETE", `/employee/code-projects/requests/${employeeDeleteId}`);
  check("can withdraw your own", withdrawn.status === 200, withdrawn.data?.message);

  /* ============================================================= decisions */

  console.log("\n=== only the admin's decision changes anything ===");

  const queue = await json(A, "GET", "/admin/code-projects/requests?status=pending");
  const queueIds = (queue.data?.items || []).map((r) => r._id);
  check("admin sees both outstanding asks", queueIds.includes(deleteRequestId) && queueIds.includes(editRequestId));
  check("the withdrawn one is not in the queue", !queueIds.includes(employeeDeleteId));

  const approvedEdit = await json(A, "POST", `/admin/code-projects/requests/${editRequestId}/approve`, {
    note: "Fine by me",
  });
  check("admin approves the edit", approvedEdit.status === 200, approvedEdit.data?.message);

  const renamed = await json(A, "GET", `/admin/code-projects/${id}`);
  check("the name actually changed", renamed.data?.item?.name === "PHASE8 Renamed By Request", renamed.data?.item?.name);
  check(
    "and the assignment was not touched by it",
    (renamed.data?.item?.operationsManagers || []).length === 1 &&
      (renamed.data?.item?.employees || []).length === 1 &&
      renamed.data?.item?.permissions?.canCreateDelete === false,
    JSON.stringify(renamed.data?.item?.permissions)
  );

  const twiceDecided = await json(A, "POST", `/admin/code-projects/requests/${editRequestId}/approve`);
  check("a decided request cannot be decided again", twiceDecided.status === 409, twiceDecided.data?.message);

  console.log("\n=== approving a delete request bins it, it does not destroy it ===");

  const approvedDelete = await json(A, "POST", `/admin/code-projects/requests/${deleteRequestId}/approve`);
  check("admin approves the delete", approvedDelete.status === 200, approvedDelete.data?.message);

  check("every file is still on disk", fs.existsSync(ws(id)));

  const binned = await json(A, "GET", "/admin/code-projects?view=trash&limit=100");
  check("it is in the bin", (binned.data?.items || []).some((p) => p._id === id));

  console.log("\n=== and a binned project is gone for everyone but the admin ===");

  const leaderAfter = await json(L, "GET", `/leader/code-projects/${id}`);
  check("leader is refused", leaderAfter.status === 404, `${leaderAfter.status}`);

  const employeeAfter = await json(E, "GET", `/employee/code-projects/${id}`);
  check("employee is refused", employeeAfter.status === 404, `${employeeAfter.status}`);

  const leaderList = await json(L, "GET", "/leader/code-projects");
  check("and it is out of their list", !(leaderList.data?.items || []).some((p) => p._id === id));

  const leaderSave = await json(L, "PUT", `/leader/workspace/${id}/file`, {
    path: "index.html",
    content: "<h1>still here?</h1>",
  });
  check("leader cannot save into it", leaderSave.status === 404, `${leaderSave.status}`);

  const askAgain = await json(L, "POST", `/leader/code-projects/${id}/requests`, {
    type: "edit",
    reason: "can I still ask?",
    name: "Nope",
  });
  check("nor raise a request against it", askAgain.status === 404, `${askAgain.status}`);

  console.log("\n=== the admin can read it, but not work in it ===");

  const adminRead = await json(A, "GET", `/admin/code-projects/${id}/tree`);
  check("admin can still browse the files", adminRead.status === 200);

  const adminSave = await json(A, "PUT", `/admin/workspace/${id}/file`, {
    path: "index.html",
    content: "<h1>edited in the bin</h1>",
  });
  check("but cannot save into it", adminSave.status === 409, adminSave.data?.message);

  const adminRun = await json(A, "POST", `/admin/workspace/${id}/run`, {});
  check("nor start it", adminRun.status === 409, adminRun.data?.message);

  const adminSnapshot = await json(A, "POST", `/admin/code-projects/${id}/versions`, {
    label: "from the bin",
  });
  check("nor snapshot it", adminSnapshot.status === 409, adminSnapshot.data?.message);

  /* ============================================================== restore */

  console.log("\n=== restore puts it back exactly as it was ===");

  const restored = await json(A, "POST", `/admin/code-projects/${id}/restore`);
  check("admin restores it", restored.status === 200, restored.data?.message);

  const leaderBack = await json(L, "GET", `/leader/code-projects/${id}`);
  check("leader has it again", leaderBack.status === 200);
  check(
    "with the same permissions as before",
    leaderBack.data?.item?.myAccess?.canEdit === true &&
      leaderBack.data?.item?.myAccess?.canCreateDelete === false,
    JSON.stringify(leaderBack.data?.item?.myAccess)
  );

  const savesAgain = await json(L, "PUT", `/leader/workspace/${id}/file`, {
    path: "index.html",
    content: "<h1>back at work</h1>",
  });
  check("and can work in it again", savesAgain.status === 200, savesAgain.data?.message);

  /* ===================================================== permanent delete */

  console.log("\n=== destroying it is a separate, deliberate act ===");

  const straightToShredder = await json(A, "DELETE", `/admin/code-projects/${id}/permanent`, {
    confirm: "PHASE8 Renamed By Request",
  });
  check(
    "a live project cannot be destroyed in one step",
    straightToShredder.status === 409,
    straightToShredder.data?.message
  );
  check("nothing was removed", fs.existsSync(ws(id)));

  await json(A, "DELETE", `/admin/code-projects/${id}`);

  const noName = await json(A, "DELETE", `/admin/code-projects/${id}/permanent`, {});
  check("and not without typing the name", noName.status === 400, noName.data?.message);
  check("still nothing removed", fs.existsSync(ws(id)));

  const destroyed = await json(A, "DELETE", `/admin/code-projects/${id}/permanent`, {
    confirm: "PHASE8 Renamed By Request",
  });
  check("with the name, it goes", destroyed.status === 200, destroyed.data?.message);
  check("workspace removed from disk", !fs.existsSync(ws(id)));

  const gone = await json(A, "GET", `/admin/code-projects/${id}`);
  check("record gone", gone.status === 404);

  const history = await json(A, "GET", "/admin/code-projects/requests?status=all&limit=100");
  const ours = (history.data?.items || []).filter((r) => String(r.projectName || "").startsWith("PHASE8"));
  check("the requests survive as a record of who asked what", ours.length >= 2, `${ours.length}`);
  check(
    "and none of them is left waiting on a project that no longer exists",
    ours.every((r) => r.status !== "pending"),
    ours.map((r) => r.status).join(", ")
  );

  /* ============================================ an outsider gets nothing */

  console.log("\n=== somebody not on the project cannot even ask ===");

  const other = await upload(A, zip, {
    filename: "other.zip",
    name: "PHASE8 Not Yours",
    operationsManagers: "[]",
    employees: "[]",
  });
  const otherId = other.data?.item?._id;

  if (otherId) {
    const outsider = await json(L, "POST", `/leader/code-projects/${otherId}/requests`, {
      type: "delete",
      reason: "not mine, but worth a try",
    });
    check("unassigned leader refused", outsider.status === 404, outsider.data?.message);

    const outsider2 = await json(E, "POST", `/employee/code-projects/${otherId}/requests`, {
      type: "edit",
      reason: "also not mine",
      name: "Mine",
    });
    check("unassigned employee refused", outsider2.status === 404, outsider2.data?.message);

    await purge(A, otherId);
  } else {
    check("second project created for the outsider check", false, other.data?.message);
  }

  /* ================================ an admin's own role is checked too */

  /**
   * The route guard reads the action off the HTTP verb, and approving is a
   * POST — which means "create". So an admin holding view, create and edit on
   * code projects, but not delete, would be able to approve a delete request
   * and thereby delete, having never been given the delete permission.
   *
   * That is the hole this section exists for. The other side of it matters
   * just as much: the same account must still be able to approve an ordinary
   * edit, or "close the hole" has quietly become "break the screen".
   */
  console.log("\n=== approving a delete needs the delete permission ===");

  await mongoose.connect(process.env.MONGO_URI);

  const LIMITED_EMAIL = "phase8.limited@example.com";
  const LIMITED_PASSWORD = "phase8-test-pass";

  // Clear anything a previous run left behind
  await User.deleteMany({ email: LIMITED_EMAIL });
  await Role.deleteMany({ key: "phase8_no_delete" });

  const role = await Role.create({
    name: "Phase 8 No Delete",
    key: "phase8_no_delete",
    permissions: { code_projects: ["view", "create", "edit"] },
  });
  await User.create({
    name: "Phase 8 Limited Admin",
    email: LIMITED_EMAIL,
    password: hashPassword(LIMITED_PASSWORD),
    role: "admin",
    status: "active",
    permissionRole: role._id,
  });

  const limited = await json(null, "POST", "/admin/login", {
    email: LIMITED_EMAIL,
    password: LIMITED_PASSWORD,
  });
  check("the limited admin signs in", limited.status === 200, limited.data?.message);
  const P = limited.data?.token;

  const forRole = await upload(A, zip, {
    filename: "roles.zip",
    name: "PHASE8 Role Check",
    operationsManagers: JSON.stringify([leaderId]),
    employees: "[]",
  });
  const roleProjectId = forRole.data?.item?._id;

  if (P && roleProjectId) {
    const askDelete = await json(L, "POST", `/leader/code-projects/${roleProjectId}/requests`, {
      type: "delete",
      reason: "please remove this",
    });
    const askEdit = await json(L, "POST", `/leader/code-projects/${roleProjectId}/requests`, {
      type: "edit",
      reason: "and rename this",
      name: "PHASE8 Role Check Renamed",
    });

    const refusedDelete = await json(
      P,
      "POST",
      `/admin/code-projects/requests/${askDelete.data?.item?._id}/approve`
    );
    check(
      "approving the delete request is refused",
      refusedDelete.status === 403,
      `${refusedDelete.status} ${refusedDelete.data?.message}`
    );

    const stillLive = await json(A, "GET", `/admin/code-projects/${roleProjectId}`);
    check("and the project was not binned by the attempt", !stillLive.data?.item?.deletedAt);

    const allowedEdit = await json(
      P,
      "POST",
      `/admin/code-projects/requests/${askEdit.data?.item?._id}/approve`
    );
    check(
      "but approving the edit request still works",
      allowedEdit.status === 200,
      `${allowedEdit.status} ${allowedEdit.data?.message}`
    );

    const rejected = await json(
      P,
      "POST",
      `/admin/code-projects/requests/${askDelete.data?.item?._id}/reject`,
      { note: "not my call" }
    );
    check("and declining one works too", rejected.status === 200, rejected.data?.message);

    // Deleting is refused at the route guard, so the bin is out of reach —
    // put it there with the full admin and check the two bin routes directly
    const limitedDelete = await json(P, "DELETE", `/admin/code-projects/${roleProjectId}`);
    check(
      "the limited admin cannot delete a project at all",
      limitedDelete.status === 403,
      `${limitedDelete.status} ${limitedDelete.data?.message}`
    );

    await json(A, "DELETE", `/admin/code-projects/${roleProjectId}`);

    const limitedPurge = await json(P, "DELETE", `/admin/code-projects/${roleProjectId}/permanent`, {
      confirm: "PHASE8 Role Check Renamed",
    });
    check(
      "nor destroy one from the bin",
      limitedPurge.status === 403,
      `${limitedPurge.status} ${limitedPurge.data?.message}`
    );
    check("which left every file where it was", fs.existsSync(ws(roleProjectId)));

    const limitedRestore = await json(P, "POST", `/admin/code-projects/${roleProjectId}/restore`);
    check(
      "but restoring, which undoes rather than destroys, is allowed",
      limitedRestore.status === 200,
      `${limitedRestore.status} ${limitedRestore.data?.message}`
    );

    await purge(A, roleProjectId);
  } else {
    check("limited admin and role-check project set up", false, forRole.data?.message);
  }

  /**
   * Leave the database as it was found. The request rows are removed here
   * rather than through the API on purpose: outliving their project is the
   * behaviour being tested a few lines up, so there is no endpoint that would
   * clear them, and there should not be.
   */
  await User.deleteMany({ email: LIMITED_EMAIL });
  await Role.deleteMany({ key: "phase8_no_delete" });
  await ProjectRequest.deleteMany({ projectName: /^PHASE8/ });
  await mongoose.disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
