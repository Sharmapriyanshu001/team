// Phase 5: create, rename, delete and search inside a workspace.
// The interesting half is everything that must be refused.
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

  const zip = buildZip([
    { name: "index.html", content: "<h1>Hello useState</h1>\n" },
    { name: "src/app.js", content: "import { useState } from 'react'\nconsole.log('x')\n" },
    { name: "src/util.js", content: "export const noop = () => {}\n" },
    { name: "docs/readme.md", content: "# Docs\nnothing about hooks here\n" },
  ]);

  console.log("=== setup ===");
  const created = await upload(A, zip, {
    filename: "ops.zip",
    name: "PHASE5 File Ops Test",
    operationsManagers: JSON.stringify(leaderId ? [leaderId] : []),
    canEdit: "true",
    canCreateDelete: "true",
  });
  check("project created", created.status === 201, created.data?.message);
  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }
  const root = ws(id);

  const newFile = (t, p, parent, name) => json(t, "POST", `/${p}/workspace/${id}/file`, { parent, name });
  const newFolder = (t, p, parent, name) => json(t, "POST", `/${p}/workspace/${id}/folder`, { parent, name });
  const rename = (t, p, from, name) => json(t, "PATCH", `/${p}/workspace/${id}/entry`, { path: from, name });
  const del = (t, p, target) =>
    json(t, "DELETE", `/${p}/workspace/${id}/entry?path=${encodeURIComponent(target)}`);
  const search = (t, p, q) => json(t, "GET", `/${p}/workspace/${id}/search?q=${encodeURIComponent(q)}`);

  /* --------------------------------------------------------------- create */

  console.log("\n=== create ===");
  const f1 = await newFile(A, "admin", "", "notes.txt");
  check("file created at root", f1.status === 201, f1.data?.message);
  check("path is right", f1.data?.path === "notes.txt", f1.data?.path);
  check("it exists on disk", fs.existsSync(path.join(root, "notes.txt")));
  check("it starts empty", fs.readFileSync(path.join(root, "notes.txt"), "utf8") === "");

  const f2 = await newFile(A, "admin", "src", "helper.js");
  check("file created in a subfolder", f2.status === 201 && f2.data?.path === "src/helper.js", f2.data?.path);

  const d1 = await newFolder(A, "admin", "src", "components");
  check("folder created", d1.status === 201 && d1.data?.path === "src/components", d1.data?.path);
  check("folder exists on disk", fs.statSync(path.join(root, "src", "components")).isDirectory());

  const dupe = await newFile(A, "admin", "", "notes.txt");
  check("duplicate refused", dupe.status === 409, dupe.data?.message);

  const badParent = await newFile(A, "admin", "nope", "x.txt");
  check("missing parent refused", badParent.status === 404, badParent.data?.message);

  const fileAsParent = await newFile(A, "admin", "index.html", "x.txt");
  check("file used as a parent refused", fileAsParent.status === 400, fileAsParent.data?.message);

  console.log("\n=== names that must be refused ===");
  const badNames = [
    ["", "empty"],
    ["..", "dot dot"],
    [".", "single dot"],
    ["a/b.txt", "contains a slash"],
    ["a\\b.txt", "contains a backslash"],
    ["../escape.txt", "traversal in the name"],
    ["con.txt", "Windows reserved"],
    ["nul", "Windows reserved"],
    ['bad"name.txt', "illegal character"],
    ["trailing.", "ends with a dot"],
    ["x".repeat(200), "too long"],
  ];
  for (const [name, why] of badNames) {
    const r = await newFile(A, "admin", "", name);
    check(`refuses ${JSON.stringify(name.slice(0, 24))} (${why})`, r.status === 400, `${r.status} ${r.data?.message || ""}`);
  }
  check("nothing escaped the workspace", !fs.existsSync(path.resolve(root, "..", "escape.txt")));

  console.log("\n=== parent path cannot escape either ===");
  for (const parent of ["../../..", "/etc", "C:/Windows", "src/../.."]) {
    const r = await newFile(A, "admin", parent, "pwned.txt");
    check(`refuses parent ${JSON.stringify(parent)}`, r.status === 400 || r.status === 404, `${r.status}`);
  }
  check("no pwned.txt anywhere above", !fs.existsSync(path.resolve(root, "..", "pwned.txt")));

  /* --------------------------------------------------------------- rename */

  console.log("\n=== rename ===");
  const rn = await rename(A, "admin", "notes.txt", "notes.md");
  check("file renamed", rn.status === 200 && rn.data?.path === "notes.md", rn.data?.path);
  check("old name gone", !fs.existsSync(path.join(root, "notes.txt")));
  check("new name there", fs.existsSync(path.join(root, "notes.md")));

  const rnDir = await rename(A, "admin", "docs", "documentation");
  check("folder renamed", rnDir.status === 200 && rnDir.data?.type === "folder", rnDir.data?.path);
  check("contents came along", fs.existsSync(path.join(root, "documentation", "readme.md")));

  const rnClash = await rename(A, "admin", "notes.md", "index.html");
  check("rename onto an existing name refused", rnClash.status === 409, rnClash.data?.message);

  const rnEscape = await rename(A, "admin", "notes.md", "../escaped.md");
  check("rename cannot contain a path", rnEscape.status === 400, rnEscape.data?.message);
  check("nothing escaped", !fs.existsSync(path.resolve(root, "..", "escaped.md")));

  const rnRoot = await rename(A, "admin", "", "hijacked");
  check("the project root cannot be renamed", rnRoot.status === 400, rnRoot.data?.message);
  check("workspace folder still there", fs.existsSync(root));

  /* --------------------------------------------------------------- delete */

  console.log("\n=== delete ===");
  const delRoot = await del(A, "admin", "");
  check("the project root cannot be deleted", delRoot.status === 400, delRoot.data?.message);
  check("workspace survived", fs.existsSync(root) && fs.existsSync(path.join(root, "index.html")));

  const delEscape = await del(A, "admin", "../../..");
  check("delete cannot escape", delEscape.status === 400, delEscape.data?.message);

  const delFile = await del(A, "admin", "notes.md");
  check("file deleted", delFile.status === 200, delFile.data?.message);
  check("gone from disk", !fs.existsSync(path.join(root, "notes.md")));

  const delFolder = await del(A, "admin", "documentation");
  check("folder deleted recursively", delFolder.status === 200 && delFolder.data?.type === "folder");
  check("its contents went too", !fs.existsSync(path.join(root, "documentation")));

  const delMissing = await del(A, "admin", "never-existed.js");
  check("deleting something absent 404s", delMissing.status === 404, delMissing.data?.message);

  /* --------------------------------------------------------------- search */

  console.log("\n=== search in files ===");
  const s1 = await search(A, "admin", "useState");
  check("search returns matches", s1.status === 200 && s1.data.results.length >= 2, String(s1.data?.results?.length));
  check("it reports the file count", s1.data?.files === 2, String(s1.data?.files));
  check("hits carry line numbers", s1.data.results.every((r) => r.line > 0));
  check("hits carry the matched text", s1.data.results.some((r) => r.text.includes("useState")));

  const s2 = await search(A, "admin", "definitely-not-in-there");
  check("no match returns an empty list", s2.status === 200 && s2.data.results.length === 0);

  const s3 = await search(A, "admin", "a");
  check("one character is refused", s3.status === 400, s3.data?.message);

  const s4 = await search(A, "admin", "USESTATE");
  check("search is case-insensitive", s4.data?.results?.length === s1.data?.results?.length);

  const s5 = await search(A, "admin", ".*");
  check("a regex is treated as literal text, not compiled", s5.status === 200 && s5.data.results.length === 0, String(s5.data?.results?.length));

  /* ---------------------------------------------------------- permissions */

  console.log("\n=== the leader has canCreateDelete ===");
  const lNew = await newFile(L, "leader", "", "leader-made.txt");
  check("leader can create", lNew.status === 201, lNew.data?.message);
  const lDel = await del(L, "leader", "leader-made.txt");
  check("leader can delete", lDel.status === 200, lDel.data?.message);

  console.log("\n=== admin turns canCreateDelete off ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: true, canCreateDelete: false, canRun: true },
  });

  const lNew2 = await newFile(L, "leader", "", "should-not-exist.txt");
  check("leader cannot create", lNew2.status === 403, lNew2.data?.message);
  check("and nothing was written", !fs.existsSync(path.join(root, "should-not-exist.txt")));

  const lDel2 = await del(L, "leader", "index.html");
  check("leader cannot delete", lDel2.status === 403, lDel2.data?.message);
  check("the file is untouched", fs.existsSync(path.join(root, "index.html")));

  const lRn2 = await rename(L, "leader", "index.html", "renamed.html");
  check("leader cannot rename", lRn2.status === 403, lRn2.data?.message);

  const lFolder2 = await newFolder(L, "leader", "", "nope");
  check("leader cannot create a folder", lFolder2.status === 403, lFolder2.data?.message);

  console.log("\n=== but editing still works, being a separate permission ===");
  const lSave = await json(L, "PUT", `/leader/workspace/${id}/file`, {
    path: "index.html",
    content: "<h1>Edited but not deleted</h1>\n",
  });
  check("leader can still save", lSave.status === 200, lSave.data?.message);
  const lSearch = await search(L, "leader", "Edited");
  check("leader can still search", lSearch.status === 200 && lSearch.data.results.length === 1);

  console.log("\n=== unassigned and anonymous ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] });
  const lAfter = await newFile(L, "leader", "", "x.txt");
  check("removed leader cannot create", lAfter.status === 404, `${lAfter.status}`);
  const lSearchAfter = await search(L, "leader", "Edited");
  check("removed leader cannot search", lSearchAfter.status === 404, `${lSearchAfter.status}`);
  const anon = await json(null, "GET", `/admin/workspace/${id}/search?q=useState`);
  check("no token refused", anon.status === 401);

  /* -------------------------------------------- changes feed the versions */

  console.log("\n=== created files show up as pending changes ===");
  const versions = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  check(
    "pending list mentions what was made",
    (versions.data?.pendingChanges || []).some((p) => p === "src/helper.js"),
    JSON.stringify(versions.data?.pendingChanges)
  );

  /* ------------------------------------------------------------- cleanup */

  console.log("\n=== cleanup ===");
  const removed = await json(A, "DELETE", `/admin/code-projects/${id}`);
  check("project deleted", removed.status === 200, removed.data?.message);
  check("workspace still there while it is in the bin", fs.existsSync(root));

  const purged = await purge(A, id);
  check("permanently deleted", purged.status === 200, purged.data?.message);
  check("workspace gone", !fs.existsSync(root));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
