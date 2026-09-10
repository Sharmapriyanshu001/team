// Phase 4: version history and rollback. The question underneath every check
// is the same one — after all this, is the original upload still exactly what
// was uploaded? Creates its own projects and deletes them at the end.
import fs from "fs";
import path from "path";
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
  return json(token, "DELETE", `/admin/code-projects/${projectId}/permanent`, {
    confirm: found.data?.item?.name,
  });
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

const readFile = (t, panel, id, p) =>
  json(t, "GET", `/${panel}/workspace/${id}/file?path=${encodeURIComponent(p)}`);
const saveFile = (t, panel, id, p, content) =>
  json(t, "PUT", `/${panel}/workspace/${id}/file`, { path: p, content });

const ws = (id) => path.resolve("uploads", "workspaces", id);

/* --------------------------------------------------------------------- run */

const main = async () => {
  const admin = await json(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  const leaderLogin = await json(null, "POST", "/leader/login", {
    email: "kamal@gmail.com",
    password: "7896897896",
  });
  if (admin.status !== 200 || leaderLogin.status !== 200) {
    console.error("Could not sign in");
    process.exit(1);
  }
  const A = admin.data.token;
  const L = leaderLogin.data.token;
  const lookups = await json(A, "GET", "/admin/lookups");
  // The signed-in leader's own id, straight from /me. Reading it out of
  // /admin/lookups was wrong twice over: that list has no email to match on,
  // and its order changes the moment another operations manager exists.
  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;

  const ORIGINAL_HTML = "<h1>Hello</h1>\n";
  const zip = buildZip([
    { name: "index.html", content: ORIGINAL_HTML },
    { name: "style.css", content: "h1 { color: red; }\n" },
    { name: "src/app.js", content: "console.log('v1')\n" },
  ]);

  console.log("=== setup ===");
  const created = await upload(A, zip, {
    filename: "versions.zip",
    name: "PHASE4 Version Test",
    operationsManagers: JSON.stringify(leaderId ? [leaderId] : []),
    canEdit: "true",
  });
  check("project created", created.status === 201, created.data?.message);
  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  /* ------------------------------------------------ version 1 is the upload */

  console.log("\n=== version 1 is the original upload ===");
  const v0 = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  check("history reads", v0.status === 200);
  check("exactly one version to start", v0.data?.versions?.length === 1, String(v0.data?.versions?.length));

  const original = v0.data.versions[0];
  check("it is version 1", original.version === 1);
  check("flagged as the original", original.isOriginal === true);
  check("labelled clearly", original.label === "Original upload", original.label);
  check("points at the uploaded archive", original.storedName === created.data.item.zipStoredName);

  /* -------------------------------------------------------- edit + snapshot */

  console.log("\n=== edit, then snapshot ===");
  await saveFile(A, "admin", id, "index.html", "<h1>Welcome To Our Office</h1>\n");
  await saveFile(A, "admin", id, "src/app.js", "console.log('v2')\n");

  const beforeSnap = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  check("changed files were tracked", beforeSnap.data?.pendingChanges?.length === 2, JSON.stringify(beforeSnap.data?.pendingChanges));

  const snap = await json(A, "POST", `/admin/code-projects/${id}/versions`, {
    label: "Welcome copy",
    note: "Changed the heading",
  });
  check("snapshot created", snap.status === 201, snap.data?.message);
  check("it is version 2", snap.data?.version?.version === 2);
  check("snapshot records what changed", snap.data?.version?.changedFiles?.length === 2);
  check("snapshot has all 3 files", snap.data?.version?.fileCount === 3, String(snap.data?.version?.fileCount));

  const afterSnap = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  check("pending list reset", (afterSnap.data?.pendingChanges || []).length === 0);
  check("current version is 2", afterSnap.data?.currentVersion === 2);

  /* -------------------------------------------------------------- rollback */

  console.log("\n=== change again, then roll back to v1 ===");
  await saveFile(A, "admin", id, "index.html", "<h1>THIRD EDIT</h1>\n");
  const beforeRestore = await readFile(A, "admin", id, "index.html");
  check("third edit is live", beforeRestore.data?.content === "<h1>THIRD EDIT</h1>\n");

  const restored = await json(A, "POST", `/admin/code-projects/${id}/versions/1/restore`);
  check("restore accepted", restored.status === 200, restored.data?.message);

  const afterRestore = await readFile(A, "admin", id, "index.html");
  check(
    "index.html is back to the original",
    afterRestore.data?.content === ORIGINAL_HTML,
    JSON.stringify(afterRestore.data?.content)
  );
  const jsBack = await readFile(A, "admin", id, "src/app.js");
  check("nested file also rolled back", jsBack.data?.content === "console.log('v1')\n", JSON.stringify(jsBack.data?.content));

  const hist = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  const safety = hist.data.versions.find((v) => v.label.startsWith("Before rollback"));
  check("current state was saved first", Boolean(safety), safety?.label);
  check("rollback is itself undoable", safety?.version === 3);

  console.log("\n=== undo the rollback ===");
  const undo = await json(A, "POST", `/admin/code-projects/${id}/versions/${safety.version}/restore`);
  check("restore to the safety version works", undo.status === 200, undo.data?.message);
  const undone = await readFile(A, "admin", id, "index.html");
  check("third edit is back", undone.data?.content === "<h1>THIRD EDIT</h1>\n", JSON.stringify(undone.data?.content));

  /* ------------------------------------------------- the original is sacred */

  console.log("\n=== the original cannot be destroyed ===");
  const delOriginal = await json(A, "DELETE", `/admin/code-projects/${id}/versions/1`);
  check("deleting version 1 is refused", delOriginal.status === 400, delOriginal.data?.message);

  const originalZip = path.resolve("uploads", created.data.item.zipStoredName);
  check("the uploaded archive is still on disk", fs.existsSync(originalZip));

  const dl = await fetch(`${BASE}/admin/code-projects/${id}/versions/1/archive`, {
    headers: { Authorization: `Bearer ${A}` },
  });
  const bytes = Buffer.from(await dl.arrayBuffer());
  check("version 1 downloads", dl.status === 200);
  check("and is byte-identical to what was uploaded", bytes.equals(zip), `${bytes.length} vs ${zip.length}`);

  console.log("\n=== a snapshot can be deleted, and takes its zip with it ===");
  const v2 = hist.data.versions.find((v) => v.version === 2);
  const v2Zip = path.resolve("uploads", v2.storedName);
  check("v2 snapshot exists on disk", fs.existsSync(v2Zip));
  const delV2 = await json(A, "DELETE", `/admin/code-projects/${id}/versions/2`);
  check("v2 deleted", delV2.status === 200, delV2.data?.message);
  check("its zip is gone from disk", !fs.existsSync(v2Zip));
  check("the original zip is untouched", fs.existsSync(originalZip));

  /* ------------------------------------------------------------ permissions */

  console.log("\n=== permissions ===");
  const lHist = await json(L, "GET", `/leader/code-projects/${id}/versions`);
  check("assigned leader can read history", lHist.status === 200, lHist.data?.message);
  check("but is told they cannot restore", lHist.data?.canRestore === false);
  check("and is told they can snapshot", lHist.data?.canSnapshot === true);

  const lSnap = await json(L, "POST", `/leader/code-projects/${id}/versions`, { label: "Leader snapshot" });
  check("leader can snapshot", lSnap.status === 201, lSnap.data?.message);

  const lRestore = await json(L, "POST", `/leader/code-projects/${id}/versions/1/restore`);
  check("leader cannot restore — no such route", lRestore.status === 404, `${lRestore.status}`);

  const lRestoreAdmin = await json(L, "POST", `/admin/code-projects/${id}/versions/1/restore`);
  check("leader cannot use the admin route", lRestoreAdmin.status === 403, lRestoreAdmin.data?.message);

  const lDel = await json(L, "DELETE", `/leader/code-projects/${id}/versions/3`);
  check("leader cannot delete a version", lDel.status === 404, `${lDel.status}`);

  console.log("\n=== canEdit off blocks snapshotting too ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: false, canCreateDelete: false, canRun: false },
  });
  const lSnap2 = await json(L, "POST", `/leader/code-projects/${id}/versions`, { label: "Should fail" });
  check("read-only leader cannot snapshot", lSnap2.status === 403, lSnap2.data?.message);
  const lHist2 = await json(L, "GET", `/leader/code-projects/${id}/versions`);
  check("and is told so", lHist2.data?.canSnapshot === false);

  console.log("\n=== an unassigned account sees nothing ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] });
  const lHist3 = await json(L, "GET", `/leader/code-projects/${id}/versions`);
  check("removed leader cannot read history", lHist3.status === 404, `${lHist3.status}`);
  const anon = await json(null, "GET", `/admin/code-projects/${id}/versions`);
  check("no token refused", anon.status === 401);

  /* ------------------------------ a restore must not re-wrap the project */

  console.log("\n=== restore does not mangle a single-folder project ===");
  // wrapper/ is stripped on upload, leaving myapp/ as the only root folder.
  // If a restore stripped again, the project would lose a level every time.
  const nested = buildZip([
    { name: "wrapper/myapp/index.html", content: "<p>nested</p>\n" },
    { name: "wrapper/myapp/lib/util.js", content: "export const a = 1\n" },
  ]);
  const p2 = await upload(A, nested, { filename: "nested.zip", name: "PHASE4 Nested Test" });
  check("nested project created", p2.status === 201, p2.data?.message);
  const id2 = p2.data?.item?._id;

  const before = fs.readdirSync(ws(id2)).sort();
  check("upload left myapp/ as the root", before.join(",") === "myapp", before.join(","));
  check("file sits at myapp/index.html", fs.existsSync(path.join(ws(id2), "myapp", "index.html")));

  await json(A, "POST", `/admin/code-projects/${id2}/versions`, { label: "snap" });
  const r2 = await json(A, "POST", `/admin/code-projects/${id2}/versions/2/restore`);
  check("restore accepted", r2.status === 200, r2.data?.message);

  const after = fs.readdirSync(ws(id2)).sort();
  check("structure is identical after restore", after.join(",") === before.join(","), after.join(","));
  check(
    "myapp/index.html still there, not flattened",
    fs.existsSync(path.join(ws(id2), "myapp", "index.html")) &&
      !fs.existsSync(path.join(ws(id2), "index.html"))
  );

  /* ------------------------------------------------------------- cleanup */

  console.log("\n=== destroying a project purges its snapshots ===");
  const finalHist = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  const snapshotPaths = finalHist.data.versions
    .filter((v) => !v.isOriginal)
    .map((v) => path.resolve("uploads", v.storedName));
  check("snapshots exist before delete", snapshotPaths.every((p) => fs.existsSync(p)), String(snapshotPaths.length));

  // Into the bin first — which must leave every byte where it is
  await json(A, "DELETE", `/admin/code-projects/${id}`);
  await json(A, "DELETE", `/admin/code-projects/${id2}`);
  check("the bin keeps the snapshots", snapshotPaths.every((p) => fs.existsSync(p)));
  check("the bin keeps the original zip", fs.existsSync(originalZip));

  const purged = await purge(A, id);
  check("permanent delete accepted", purged.status === 200, purged.data?.message);
  await purge(A, id2);

  check("every snapshot zip removed", snapshotPaths.every((p) => !fs.existsSync(p)));
  check("original zip removed with the project", !fs.existsSync(originalZip));
  check("workspaces removed", !fs.existsSync(ws(id)) && !fs.existsSync(ws(id2)));

  const orphanCheck = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  check("history gone with the project", orphanCheck.status === 404);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
