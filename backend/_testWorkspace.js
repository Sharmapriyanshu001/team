// Phase 3: the workspace file API. Reads, saves, and — mostly — the ways it
// must refuse. Creates its own project and deletes it at the end.
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
    const data = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? "", "utf8");
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

const readFile = (token, panel, id, p) =>
  json(token, "GET", `/${panel}/workspace/${id}/file?path=${encodeURIComponent(p)}`);

const saveFile = (token, panel, id, p, content) =>
  json(token, "PUT", `/${panel}/workspace/${id}/file`, { path: p, content });

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

  // A tiny binary blob (has a NUL byte) so binary detection has something real
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

  const zip = buildZip([
    { name: "index.html", content: "<h1>Hello</h1>\n" },
    { name: "style.css", content: "h1 { color: red; }\n" },
    { name: "src/app.js", content: "console.log('hi')\n" },
    { name: "logo.png", content: png },
  ]);

  console.log("=== setup ===");
  const created = await upload(A, "/admin/code-projects", zip, {
    filename: "ws.zip",
    name: "PHASE3 Workspace Test",
    operationsManagers: JSON.stringify(leaderId ? [leaderId] : []),
    employees: "[]",
    canEdit: "true",
  });
  check("project created", created.status === 201, created.data?.message);
  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }

  /* -------------------------------------------------------------- reading */

  console.log("\n=== read files ===");
  const html = await readFile(A, "admin", id, "index.html");
  check("html reads", html.status === 200);
  check("content is exact", html.data?.content === "<h1>Hello</h1>\n", JSON.stringify(html.data?.content));
  check("language detected", html.data?.language === "html", html.data?.language);
  check("canEdit true for admin", html.data?.canEdit === true);

  const js = await readFile(A, "admin", id, "src/app.js");
  check("nested file reads", js.status === 200 && js.data.content.includes("console.log"));
  check("js language detected", js.data?.language === "javascript", js.data?.language);

  const bin = await readFile(A, "admin", id, "logo.png");
  check("binary flagged, not dumped", bin.data?.binary === true && bin.data?.content === "");

  const missing = await readFile(A, "admin", id, "nope.txt");
  check("missing file 404s", missing.status === 404, missing.data?.message);

  const dir = await readFile(A, "admin", id, "src");
  check("folder is refused", dir.status === 400, dir.data?.message);

  /* --------------------------------------------------------- the path jail */

  console.log("\n=== path jail ===");
  const escapes = [
    "../../../backend/.env",
    "../../../../etc/passwd",
    "..\\..\\..\\.env",
    "/etc/passwd",
    "C:/Windows/win.ini",
    "src/../../../.env",
    "./../../.env",
  ];
  for (const p of escapes) {
    const r = await readFile(A, "admin", id, p);
    const blocked = r.status === 400 || r.status === 404;
    check(`refuses ${JSON.stringify(p)}`, blocked, `${r.status} ${r.data?.message || ""}`);
    if (r.status === 200 && r.data?.content) {
      check("  !! LEAKED CONTENT", false, r.data.content.slice(0, 60));
    }
  }

  const escapeSave = await saveFile(A, "admin", id, "../../../PWNED.txt", "escaped");
  check("save cannot escape either", escapeSave.status === 400 || escapeSave.status === 404, `${escapeSave.status}`);
  check("no PWNED.txt on disk", !fs.existsSync(path.resolve("..", "PWNED.txt")) && !fs.existsSync("PWNED.txt"));

  /* --------------------------------------------------------------- saving */

  console.log("\n=== save ===");
  const saved = await saveFile(A, "admin", id, "index.html", "<h1>Welcome To Our Office</h1>\n");
  check("save accepted", saved.status === 200, saved.data?.message);

  const reread = await readFile(A, "admin", id, "index.html");
  check("content really changed", reread.data?.content === "<h1>Welcome To Our Office</h1>\n", JSON.stringify(reread.data?.content));

  const onDisk = fs.readFileSync(path.resolve("uploads", "workspaces", id, "index.html"), "utf8");
  check("disk matches what was saved", onDisk === "<h1>Welcome To Our Office</h1>\n");

  const leftovers = fs
    .readdirSync(path.resolve("uploads", "workspaces", id))
    .filter((f) => f.includes(".saving-"));
  check("no temp file left behind", leftovers.length === 0, leftovers.join(", "));

  const saveMissing = await saveFile(A, "admin", id, "brand-new.txt", "x");
  check("save cannot create a new file", saveMissing.status === 404, saveMissing.data?.message);

  const saveNonString = await json(A, "PUT", `/admin/workspace/${id}/file`, {
    path: "index.html",
    content: { not: "a string" },
  });
  check("non-text content refused", saveNonString.status === 400, saveNonString.data?.message);

  // A realistic source file — this is the size that used to die on Express's
  // 100 kB default with an HTML error page instead of anything usable.
  const big = "// a big but ordinary source file\n".repeat(9000); // ~300 KB
  const bigSave = await saveFile(A, "admin", id, "src/app.js", big);
  check("300 KB file saves", bigSave.status === 200, `${bigSave.status} ${bigSave.data?.message || ""}`);
  const bigRead = await readFile(A, "admin", id, "src/app.js");
  check("300 KB file reads back intact", bigRead.data?.content === big, `${bigRead.data?.content?.length} chars`);

  // Two tiers above that, and both must answer in JSON a client can render
  const overEditLimit = await saveFile(A, "admin", id, "index.html", "A".repeat(2.5 * 1024 * 1024));
  check(
    "over the 2 MB edit cap gets the clear message",
    overEditLimit.status === 400 && /editing limit/i.test(overEditLimit.data?.message || ""),
    `${overEditLimit.status} ${overEditLimit.data?.message}`
  );

  const overBodyLimit = await saveFile(A, "admin", id, "index.html", "A".repeat(4 * 1024 * 1024));
  check(
    "over the body cap answers JSON, not an HTML page",
    overBodyLimit.status === 413 && Boolean(overBodyLimit.data?.message),
    `${overBodyLimit.status} ${overBodyLimit.data?.message}`
  );

  const stillFine = await readFile(A, "admin", id, "index.html");
  check("refused saves did not corrupt the file", stillFine.data?.content === "<h1>Welcome To Our Office</h1>\n");

  /* ------------------------------------------------- the leader, and canEdit */

  console.log("\n=== assigned leader can read and write ===");
  const lRead = await readFile(L, "leader", id, "style.css");
  check("leader reads", lRead.status === 200, lRead.data?.message);
  check("leader sees canEdit true", lRead.data?.canEdit === true);

  const lSave = await saveFile(L, "leader", id, "style.css", "h1 { color: green; }\n");
  check("leader saves", lSave.status === 200, lSave.data?.message);

  console.log("\n=== admin turns canEdit off ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: false, canCreateDelete: false, canRun: false },
  });

  const lRead2 = await readFile(L, "leader", id, "style.css");
  check("leader can still read", lRead2.status === 200);
  check("but canEdit is now false", lRead2.data?.canEdit === false);

  const lSave2 = await saveFile(L, "leader", id, "style.css", "h1 { color: BLOCKED; }\n");
  check("leader save is refused", lSave2.status === 403, lSave2.data?.message);

  const unchanged = await readFile(A, "admin", id, "style.css");
  check("file untouched by the refused save", unchanged.data?.content === "h1 { color: green; }\n", JSON.stringify(unchanged.data?.content));

  console.log("\n=== admin is not limited by the project permissions ===");
  const aSave = await saveFile(A, "admin", id, "style.css", "h1 { color: blue; }\n");
  check("admin still saves", aSave.status === 200, aSave.data?.message);

  /* ------------------------------------------------------- unassigned user */

  console.log("\n=== unassigned user gets nothing ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] });

  const lRead3 = await readFile(L, "leader", id, "index.html");
  check("removed leader cannot read", lRead3.status === 404, `${lRead3.status} ${lRead3.data?.message}`);
  const lSave3 = await saveFile(L, "leader", id, "index.html", "nope");
  check("removed leader cannot save", lSave3.status === 404, `${lSave3.status}`);

  const anon = await json(null, "GET", `/admin/workspace/${id}/file?path=index.html`);
  check("no token refused", anon.status === 401);

  /* ------------------------------------------------------------- cleanup */

  console.log("\n=== cleanup ===");
  const del = await json(A, "DELETE", `/admin/code-projects/${id}`);
  check("project deleted", del.status === 200, del.data?.message);
  check(
    "workspace still there while it is in the bin",
    fs.existsSync(path.resolve("uploads", "workspaces", id))
  );

  const purged = await purge(A, id);
  check("permanently deleted", purged.status === 200, purged.data?.message);
  check("workspace gone from disk", !fs.existsSync(path.resolve("uploads", "workspaces", id)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
