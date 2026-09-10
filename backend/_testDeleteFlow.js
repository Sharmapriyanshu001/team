// Phase 9: the two deletes, and the fact that they are not the same delete.
//
// One removes a wrong file and leaves the project running. The other removes
// the project and leaves every byte on disk, in a bin that only an admin can
// open. The point of this file is that neither can be talked into being the
// other — including by an employee sending the request by hand.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import mongoose from "mongoose";

import CodeProject from "./models/CodeProject.js";
import ProjectVersion from "./models/ProjectVersion.js";

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

  if (!found.data?.item?.deletedAt) {
    await json(token, "DELETE", `/admin/code-projects/${projectId}`);
  }
  return json(token, "DELETE", `/admin/code-projects/${projectId}/permanent`, {
    confirm: found.data?.item?.name,
  });
};

const ws = (id) => path.resolve("uploads", "workspaces", id);
const stored = (name) => path.resolve("uploads", name);

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

  await mongoose.connect(process.env.MONGO_URI);

  const zip = buildZip([
    { name: "index.html", content: "<h1>Delete flow</h1>" },
    { name: "src/app.js", content: "console.log('good code')\n" },
  ]);

  /**
   * One project made for each scenario, because a soft delete is a state the
   * project stays in — reusing one would mean each test starting from wherever
   * the last one left it.
   */
  const makeProject = async (name) => {
    const created = await upload(A, zip, {
      filename: "flow.zip",
      name,
      operationsManagers: JSON.stringify([leaderId]),
      employees: JSON.stringify([employeeId]),
      // Deleting a wrong file needs this; deleting the project does not
      canCreateDelete: "true",
    });
    return created.data?.item?._id;
  };

  /* ================================================= 1. the wrong file goes */

  console.log("=== Test 1 — a wrong file is deleted, the project carries on ===");

  const id1 = await makeProject("PHASE9 Wrong Code");
  if (!id1) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  // { parent, name } is what this route takes; the contents follow on a save
  const pushed = await json(E, "POST", `/employee/workspace/${id1}/file`, {
    parent: "src",
    name: "wrong.js",
  });
  check("employee pushes a wrong file", pushed.status === 201, pushed.data?.message);

  const filled = await json(E, "PUT", `/employee/workspace/${id1}/file`, {
    path: "src/wrong.js",
    content: "// this should never have been pushed\n",
  });
  check("and saves the wrong contents into it", filled.status === 200, filled.data?.message);

  const removedFile = await json(
    E,
    "DELETE",
    `/employee/workspace/${id1}/entry?path=${encodeURIComponent("src/wrong.js")}`
  );
  check("employee deletes just that file", removedFile.status === 200, removedFile.data?.message);

  const afterFile = await json(E, "GET", `/employee/code-projects/${id1}`);
  check("the project is still theirs and still active", afterFile.status === 200);

  const rowAfter = await CodeProject.findById(id1);
  check("it did not go to the bin", !rowAfter.deletedAt);
  check(
    "the assignment is untouched",
    rowAfter.operationsManagers.length === 1 && rowAfter.employees.length === 1
  );
  check("the workspace is intact", fs.existsSync(ws(id1)));

  const goodStillThere = await json(
    E,
    "GET",
    `/employee/workspace/${id1}/file?path=${encodeURIComponent("src/app.js")}`
  );
  check("the good code beside it is untouched", goodStillThere.status === 200);

  const goneFromDisk = !fs.existsSync(path.join(ws(id1), "src", "wrong.js"));
  check("and the wrong file really is gone", goneFromDisk);

  const reUpload = await json(E, "POST", `/employee/workspace/${id1}/file`, {
    parent: "src",
    name: "wrong.js",
  });
  check("the correct code can be pushed again", reUpload.status === 201, reUpload.data?.message);

  const corrected = await json(E, "PUT", `/employee/workspace/${id1}/file`, {
    path: "src/wrong.js",
    content: "// the correct code this time\n",
  });
  check("with the corrected contents", corrected.status === 200, corrected.data?.message);

  // The file route is not a way to empty a project either: a path that
  // resolves to the workspace root is refused rather than obeyed.
  for (const attempt of [".", "./", "src/.."]) {
    const rootAttempt = await json(
      E,
      "DELETE",
      `/employee/workspace/${id1}/entry?path=${encodeURIComponent(attempt)}`
    );
    check(
      `the project folder cannot be deleted as a file ("${attempt}")`,
      rootAttempt.status === 400,
      `${rootAttempt.status} ${rootAttempt.data?.message}`
    );
  }
  check("and the workspace is still there afterwards", fs.existsSync(ws(id1)));

  await purge(A, id1);

  /* ============================================ 2. the employee's own delete */

  console.log("\n=== Test 2 — an employee deletes the project ===");

  const id2 = await makeProject("PHASE9 Employee Delete");
  const version = await json(L, "POST", `/leader/code-projects/${id2}/versions`, {
    label: "before the delete",
  });
  check("a snapshot exists to be preserved", version.status === 201, version.data?.message);

  const empDelete = await json(E, "DELETE", `/employee/code-projects/${id2}`);
  check("employee can delete it", empDelete.status === 200, empDelete.data?.message);

  const empList = await json(E, "GET", "/employee/code-projects");
  check(
    "it is out of their active projects",
    !(empList.data?.items || []).some((p) => p._id === id2)
  );
  const empDirect = await json(E, "GET", `/employee/code-projects/${id2}`);
  check("and out of reach by id", empDirect.status === 404, `${empDirect.status}`);

  const bin = await json(A, "GET", "/admin/code-projects?view=trash&limit=100");
  const binRow = (bin.data?.items || []).find((p) => p._id === id2);
  check("it is in the admin's bin", Boolean(binRow));

  check("the bin names who deleted it", binRow?.deletedBy?.name === "Rahul" || Boolean(binRow?.deletedBy?.name), binRow?.deletedBy?.name);
  check("and their role at the time", binRow?.deletedByRole === "employee", binRow?.deletedByRole);
  check("and when", Boolean(binRow?.deletedAt), binRow?.deletedAt);
  check(
    "and who was on the team",
    (binRow?.operationsManagers || []).length === 1 && (binRow?.employees || []).length === 1
  );

  console.log("  -- nothing was destroyed --");
  const doc2 = await CodeProject.findById(id2);
  check("the record is still there", Boolean(doc2));
  check("the workspace is still on disk", fs.existsSync(ws(id2)));
  check("the original upload is still on disk", fs.existsSync(stored(doc2.zipStoredName)));
  check("the assignment survived the delete", doc2.operationsManagers.length === 1 && doc2.employees.length === 1);

  const snapshots = await ProjectVersion.find({ codeProject: id2 });
  check("the version history survived too", snapshots.length >= 2, `${snapshots.length} versions`);
  check(
    "and so did every snapshot zip",
    snapshots.every((v) => fs.existsSync(stored(v.storedName)))
  );

  /* ============================================ 3. the operations manager's delete */

  console.log("\n=== Test 3 — an operations manager deletes the project ===");

  const id3 = await makeProject("PHASE9 Leader Delete");
  const leadDelete = await json(L, "DELETE", `/leader/code-projects/${id3}`);
  check("operations manager can delete it", leadDelete.status === 200, leadDelete.data?.message);

  const doc3 = await CodeProject.findById(id3);
  check("it is in the bin, not gone", Boolean(doc3?.deletedAt));
  check("recorded against their role", doc3?.deletedByRole === "operations_manager", doc3?.deletedByRole);
  check("with every file still on disk", fs.existsSync(ws(id3)));

  const leadList = await json(L, "GET", "/leader/code-projects");
  check("out of their list", !(leadList.data?.items || []).some((p) => p._id === id3));

  // The other assignee loses it too — it is one project, not one per person
  const empSees = await json(E, "GET", `/employee/code-projects/${id3}`);
  check("and out of the employee's reach as well", empSees.status === 404, `${empSees.status}`);

  await purge(A, id3);

  /* ==================================================== 4. the admin restores */

  console.log("\n=== Test 4 — the admin restores it ===");

  const restored = await json(A, "POST", `/admin/code-projects/${id2}/restore`);
  check("restore accepted", restored.status === 200, restored.data?.message);

  const doc2back = await CodeProject.findById(id2);
  check("it is active again", !doc2back.deletedAt);
  check("the delete record was cleared", !doc2back.deletedByRole && !doc2back.deletedBy);
  check(
    "the assignment is exactly as it was",
    doc2back.operationsManagers.length === 1 && doc2back.employees.length === 1
  );

  const empBack = await json(E, "GET", "/employee/code-projects");
  check("the employee sees it again", (empBack.data?.items || []).some((p) => p._id === id2));

  const leadBack = await json(L, "GET", `/leader/code-projects/${id2}`);
  check("the operations manager does too", leadBack.status === 200);

  const readsAgain = await json(
    E,
    "GET",
    `/employee/workspace/${id2}/file?path=${encodeURIComponent("src/app.js")}`
  );
  check("the code is all still there", readsAgain.status === 200);
  check(
    "with its contents unchanged",
    (readsAgain.data?.content || "").includes("good code"),
    JSON.stringify(readsAgain.data?.content)
  );

  const worksAgain = await json(E, "PUT", `/employee/workspace/${id2}/file`, {
    path: "src/app.js",
    content: "console.log('back at work')\n",
  });
  check("and the workspace works again", worksAgain.status === 200, worksAgain.data?.message);

  const histBack = await json(L, "GET", `/leader/code-projects/${id2}/versions`);
  check("the version history came back with it", (histBack.data?.versions || []).length >= 2);

  /* ================================================ 5. the admin destroys it */

  console.log("\n=== Test 5 — the admin deletes it permanently ===");

  const zipPath = stored(doc2back.zipStoredName);
  const snapshotPaths = (await ProjectVersion.find({ codeProject: id2 })).map((v) =>
    stored(v.storedName)
  );

  const notBinned = await json(A, "DELETE", `/admin/code-projects/${id2}/permanent`, {
    confirm: "PHASE9 Employee Delete",
  });
  check("a live project cannot be destroyed", notBinned.status === 409, notBinned.data?.message);

  await json(A, "DELETE", `/admin/code-projects/${id2}`);

  const noConfirm = await json(A, "DELETE", `/admin/code-projects/${id2}/permanent`, {});
  check("nor one in the bin without confirming", noConfirm.status === 400, noConfirm.data?.message);

  const destroyed = await json(A, "DELETE", `/admin/code-projects/${id2}/permanent`, {
    confirm: "PHASE9 Employee Delete",
  });
  check("with the name typed back, it goes", destroyed.status === 200, destroyed.data?.message);

  console.log("  -- and nothing is left behind --");
  check("the record is gone", !(await CodeProject.findById(id2)));
  check("the workspace folder is gone", !fs.existsSync(ws(id2)));
  check("the original archive is gone", !fs.existsSync(zipPath));
  check("every snapshot zip is gone", snapshotPaths.every((f) => !fs.existsSync(f)));
  check(
    "no orphaned version rows are left",
    (await ProjectVersion.countDocuments({ codeProject: id2 })) === 0
  );

  /* =========================================================== 6. security */

  console.log("\n=== Test 6 — none of it can be reached by hand ===");

  const id6 = await makeProject("PHASE9 Security");

  /**
   * The one that matters most: an assignee's delete route being sent every
   * flag somebody might hope turns it into a real one. It has to stay soft.
   */
  const forced = await json(E, "DELETE", `/employee/code-projects/${id6}`, {
    permanent: true,
    force: true,
    hard: true,
    purge: true,
    confirm: "PHASE9 Security",
  });
  check("an employee's delete ignores every 'make it permanent' flag", forced.status === 200, forced.data?.message);

  const survived = await CodeProject.findById(id6);
  check("the record survived it", Boolean(survived));
  check("the files survived it", fs.existsSync(ws(id6)));
  check("and it is only in the bin", Boolean(survived?.deletedAt));

  const attempts = [
    ["destroy it permanently", "DELETE", `/admin/code-projects/${id6}/permanent`, { confirm: "PHASE9 Security" }],
    ["open the bin", "GET", "/admin/code-projects?view=trash", null],
    ["restore it", "POST", `/admin/code-projects/${id6}/restore`, null],
    ["change the assignment", "PUT", `/admin/code-projects/${id6}`, { operationsManagers: [], employees: [] }],
    ["edit the project", "PUT", `/admin/code-projects/${id6}`, { name: "Mine" }],
    ["list every project", "GET", "/admin/code-projects", null],
  ];

  for (const [label, method, route, body] of attempts) {
    const asEmployee = await json(E, method, route, body);
    check(`employee gets 403 trying to ${label}`, asEmployee.status === 403, `${asEmployee.status} ${asEmployee.data?.message}`);

    const asLeader = await json(L, method, route, body);
    check(`leader gets 403 trying to ${label}`, asLeader.status === 403, `${asLeader.status} ${asLeader.data?.message}`);
  }

  const noToken = await json(null, "DELETE", `/admin/code-projects/${id6}/permanent`, {
    confirm: "PHASE9 Security",
  });
  check("and with no token at all", noToken.status === 401, `${noToken.status}`);

  const stillThere = await CodeProject.findById(id6);
  check("after all of that the project is still in the bin, intact", Boolean(stillThere?.deletedAt));
  check("with its files still on disk", fs.existsSync(ws(id6)));
  check(
    "and its assignment unchanged",
    stillThere.operationsManagers.length === 1 && stillThere.employees.length === 1
  );

  // A binned project is out of reach for its assignees, so they cannot use
  // their own routes as a back door into the bin either
  const binByHand = await json(E, "GET", `/employee/code-projects/${id6}`);
  check("nor can they read it through their own panel", binByHand.status === 404, `${binByHand.status}`);

  const deleteTwice = await json(E, "DELETE", `/employee/code-projects/${id6}`);
  check("nor delete it a second time", deleteTwice.status === 404, `${deleteTwice.status}`);

  await purge(A, id6);

  /* --------------------------------------------------------------- cleanup */

  const leftovers = await CodeProject.find({ name: /^PHASE9/ }).select("name");
  check("no test projects left behind", leftovers.length === 0, leftovers.map((r) => r.name).join(", "));

  await mongoose.disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
