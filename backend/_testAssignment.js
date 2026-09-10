// Phase 2: does the server actually stop an unassigned user, or only the UI?
// Creates a project, assigns nobody, then tries to reach it as leader and
// employee. Then assigns one of them and repeats. Cleans up after itself.
import dotenv from "dotenv";

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

/**
 * Deleting a code project moves it to the bin. Actually destroying it is a
 * second call that has to send the project's own name back, so a test that
 * wants a clean slate has to ask for it in as many words — the same as a
 * person would.
 */
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

const upload = async (token, route, zipBuffer, fields) => {
  const form = new FormData();
  form.append("file", new Blob([zipBuffer], { type: "application/zip" }), fields.filename);
  Object.entries(fields).forEach(([k, v]) => k !== "filename" && form.append(k, v));

  const res = await fetch(BASE + route, {
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
  console.log("Signed in as admin, operations manager and employee\n");

  const lookups = await json(A, "GET", "/admin/lookups");
  // The signed-in leader's own id, straight from /me. Reading it out of
  // /admin/lookups was wrong twice over: that list has no email to match on,
  // and its order changes the moment another operations manager exists.
  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;
  const employeeId = (await json(E, "GET", "/employee/me")).data?.employee?.id;

  const zip = buildZip([
    { name: "index.html", content: "<h1>Hello</h1>" },
    { name: "style.css", content: "h1{color:red}" },
  ]);

  /* ------------------------------------------------ unassigned = invisible */

  console.log("=== created with nobody assigned ===");
  const created = await upload(A, "/admin/code-projects", zip, {
    filename: "secret.zip",
    name: "PHASE2 Unassigned Project",
    operationsManagers: "[]",
    employees: "[]",
  });
  check("admin created it", created.status === 201, created.data?.message);
  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }
  check("stack detected as static", created.data.item.stack === "static", created.data.item.stack);

  console.log("\n=== an unassigned leader/employee must not reach it ===");
  const lList = await json(L, "GET", "/leader/code-projects");
  check("leader list is empty of it", !(lList.data?.items || []).some((p) => p._id === id));

  const eList = await json(E, "GET", "/employee/code-projects");
  check("employee list is empty of it", !(eList.data?.items || []).some((p) => p._id === id));

  const lDirect = await json(L, "GET", `/leader/code-projects/${id}`);
  check("leader direct id refused", lDirect.status === 404, `${lDirect.status} ${lDirect.data?.message}`);

  const eDirect = await json(E, "GET", `/employee/code-projects/${id}`);
  check("employee direct id refused", eDirect.status === 404, `${eDirect.status} ${eDirect.data?.message}`);

  const lTree = await json(L, "GET", `/leader/code-projects/${id}/tree`);
  check("leader tree refused", lTree.status === 404, `${lTree.status}`);

  const eTree = await json(E, "GET", `/employee/code-projects/${id}/tree`);
  check("employee tree refused", eTree.status === 404, `${eTree.status}`);

  /**
   * The original ZIP. Its handler used to be admin-only by nothing more than
   * which router it sat on, so putting it on the staff routers is exactly the
   * kind of change that hands out a whole project by id.
   */
  const lZip = await json(L, "GET", `/leader/code-projects/${id}/archive`);
  check("leader archive refused", lZip.status === 404, `${lZip.status} ${lZip.data?.message}`);

  const eZip = await json(E, "GET", `/employee/code-projects/${id}/archive`);
  check("employee archive refused", eZip.status === 404, `${eZip.status} ${eZip.data?.message}`);

  check(
    "refusal does not reveal the project exists",
    lDirect.data?.message === "Code project not found",
    lDirect.data?.message
  );

  console.log("\n=== a leader cannot reach the admin's routes ===");
  const lAdmin = await json(L, "GET", "/admin/code-projects");
  check("leader token on admin list", lAdmin.status === 403, lAdmin.data?.message);
  const lDelete = await json(L, "DELETE", `/admin/code-projects/${id}`);
  check("leader token cannot delete", lDelete.status === 403, lDelete.data?.message);

  /* ---------------------------------------------------------- now assign */

  console.log("\n=== assign the leader only ===");
  const assigned = await json(A, "PUT", `/admin/code-projects/${id}`, {
    operationsManagers: [leaderId],
    employees: [],
    permissions: { canEdit: true, canCreateDelete: false, canRun: true },
  });
  check("assignment saved", assigned.status === 200, assigned.data?.message);
  check(
    "leader is on the record",
    (assigned.data?.item?.operationsManagers || []).some((p) => p._id === leaderId)
  );

  const lList2 = await json(L, "GET", "/leader/code-projects");
  const row = (lList2.data?.items || []).find((p) => p._id === id);
  check("leader now sees it in their list", Boolean(row));
  check("row carries myAccess", Boolean(row?.myAccess), JSON.stringify(row?.myAccess));
  check("canEdit true as set", row?.myAccess?.canEdit === true);
  check("canCreateDelete false as set", row?.myAccess?.canCreateDelete === false);

  const lDirect2 = await json(L, "GET", `/leader/code-projects/${id}`);
  check("leader direct id now allowed", lDirect2.status === 200);

  const lTree2 = await json(L, "GET", `/leader/code-projects/${id}/tree`);
  check("leader tree now allowed", lTree2.status === 200);
  check("tree has the two files", (lTree2.data?.tree || []).length === 2, String((lTree2.data?.tree || []).length));

  // The ZIP is how work leaves this app for a local editor, so an assigned
  // person gets the same download the admin has — and the real bytes, not a
  // 200 with an error page in it.
  const lZip2 = await fetch(BASE + `/leader/code-projects/${id}/archive`, {
    headers: { Authorization: `Bearer ${L}` },
  });
  const zipBody = Buffer.from(await lZip2.arrayBuffer());
  check("leader archive now allowed", lZip2.status === 200, String(lZip2.status));
  check("served as a zip attachment", /attachment/.test(lZip2.headers.get("content-disposition") || ""), lZip2.headers.get("content-disposition"));
  check("and the body really is a zip", zipBody.slice(0, 2).toString() === "PK", zipBody.slice(0, 2).toString());

  console.log("\n=== the employee is still shut out ===");
  const eDirect2 = await json(E, "GET", `/employee/code-projects/${id}`);
  check("employee still refused", eDirect2.status === 404, `${eDirect2.status}`);
  const eZip2 = await json(E, "GET", `/employee/code-projects/${id}/archive`);
  check("employee archive still refused", eZip2.status === 404, `${eZip2.status}`);
  const eList2 = await json(E, "GET", "/employee/code-projects");
  check("employee list still empty of it", !(eList2.data?.items || []).some((p) => p._id === id));

  console.log("\n=== an employee cannot use the leader route and vice versa ===");
  const crossed = await json(E, "GET", `/leader/code-projects/${id}`);
  check("employee token on leader route", crossed.status === 403, crossed.data?.message);

  /* ------------------------------------------------- permissions are honoured */

  console.log("\n=== permissions flow through to the assignee ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: false, canCreateDelete: false, canRun: false },
  });
  const lList3 = await json(L, "GET", "/leader/code-projects");
  const row3 = (lList3.data?.items || []).find((p) => p._id === id);
  check("canEdit now false for the leader", row3?.myAccess?.canEdit === false);
  check("canRun now false for the leader", row3?.myAccess?.canRun === false);

  console.log("\n=== unassigning takes access away again ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] });
  const lDirect4 = await json(L, "GET", `/leader/code-projects/${id}`);
  check("leader refused after being removed", lDirect4.status === 404, `${lDirect4.status}`);

  /* ------------------------------------------------------------- cleanup */

  console.log("\n=== cleanup ===");
  const del = await purge(A, id);
  check("test project deleted", del.status === 200, del.data?.message);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
