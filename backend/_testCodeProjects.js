// Phase 1 end-to-end: upload a real ZIP through the admin API, confirm it is
// extracted, detected, listed and torn down cleanly. Requires the server on
// PORT_UNDER_TEST. Creates and then deletes its own project.
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
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

/* ---------------------------------------------------- tiny stored-zip writer */

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
  const login = await json(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (login.status !== 200) {
    console.error("Could not sign in as admin:", login.data?.message);
    process.exit(1);
  }
  const token = login.data.token;
  console.log("Signed in as admin\n");

  /* --------------------------------------------------- a realistic vite app */

  const viteZip = buildZip([
    { name: "ecommerce/package.json", content: JSON.stringify({ name: "shop", scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "^19.0.0", vite: "^8.0.0" } }) },
    { name: "ecommerce/index.html", content: "<!doctype html><div id=root></div>" },
    { name: "ecommerce/vite.config.js", content: "export default {}" },
    { name: "ecommerce/README.md", content: "# Shop" },
    { name: "ecommerce/src/App.jsx", content: "export default function App(){return <h1>Hello</h1>}" },
    { name: "ecommerce/src/main.jsx", content: "import App from './App'" },
    { name: "ecommerce/src/components/Header.jsx", content: "export default () => <header/>" },
    { name: "ecommerce/public/logo.svg", content: "<svg/>" },
    { name: "ecommerce/node_modules/react/index.js", content: "// should be skipped" },
    { name: "ecommerce/.DS_Store", content: "junk" },
  ]);

  console.log("=== create from a Vite project archive ===");
  const created = await upload(token, "/admin/code-projects", viteZip, {
    filename: "ecommerce.zip",
    name: "E-Commerce Website",
    description: "Company E-Commerce Project",
    operationsManagers: "[]",
    employees: "[]",
    canEdit: "true",
    canCreateDelete: "false",
    canRun: "true",
  });

  check("upload accepted", created.status === 201, created.data?.message);
  if (created.status !== 201) {
    console.log("\n" + pass + " passed, " + (fail + 1) + " failed");
    process.exit(1);
  }

  const item = created.data.item;
  const id = item._id;

  check("stack detected as vite", item.stack === "vite", item.stack);
  check("wrapper folder stripped", item.entryFile === "index.html", `entryFile=${item.entryFile}`);
  check("node_modules skipped", item.fileCount === 8, `fileCount=${item.fileCount}`);
  check("dev script captured", Boolean(item.packageScripts?.dev), JSON.stringify(item.packageScripts));
  check("original zip name kept", item.zipOriginalName === "ecommerce.zip");
  check("nothing rejected", (created.data.report?.rejected || []).length === 0);
  check("junk reported as skipped", (created.data.report?.skipped || []).length === 2);

  console.log("\n=== file tree ===");
  const tree = await json(token, "GET", `/admin/code-projects/${id}/tree`);
  check("tree returned", tree.status === 200);
  const names = (tree.data?.tree || []).map((n) => n.name).sort();
  check("root holds the project files", names.includes("package.json") && names.includes("src"), names.join(", "));
  const src = (tree.data?.tree || []).find((n) => n.name === "src");
  check("src/ is a folder with children", src?.type === "folder" && src.children.length === 3, String(src?.children?.length));
  check("folders sort above files", (tree.data?.tree || [])[0]?.type === "folder");

  console.log("\n=== path traversal through the tree API ===");
  const evil = await json(token, "GET", `/admin/code-projects/${id}/../../../etc/tree`);
  check("traversal in the URL does not reach a handler", evil.status === 404, `status=${evil.status}`);

  console.log("\n=== listing ===");
  const list = await json(token, "GET", "/admin/code-projects");
  check("project appears in the list", (list.data?.items || []).some((p) => p._id === id));

  console.log("\n=== original archive download ===");
  const dl = await fetch(`${BASE}/admin/code-projects/${id}/archive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const bytes = Buffer.from(await dl.arrayBuffer());
  check("archive downloads", dl.status === 200);
  check("archive is byte-identical to the upload", bytes.equals(viteZip), `${bytes.length} vs ${viteZip.length}`);

  console.log("\n=== auth: non-admin cannot reach any of it ===");
  const emp = await json(null, "POST", "/employee/login", {
    email: "rahul123@gmail.com",
    password: "8003609515",
  });
  if (emp.status === 200) {
    const denied = await json(emp.data.token, "GET", "/admin/code-projects");
    check("employee token refused", denied.status === 403, denied.data?.message);
  } else {
    console.log("  (skipped — employee login unavailable)");
  }
  const anon = await json(null, "GET", "/admin/code-projects");
  check("no token refused", anon.status === 401);

  console.log("\n=== a hostile archive is refused whole ===");
  const evilZip = buildZip([
    { name: "../../PWNED.txt", content: "escaped" },
    { name: "index.html", content: "<h1>ok</h1>" },
  ]);
  const rejected = await upload(token, "/admin/code-projects", evilZip, {
    filename: "evil.zip",
    name: "Should Not Exist",
  });
  check("hostile upload rejected", rejected.status === 400, rejected.data?.message);
  check("message names the problem", /unsafe file path/i.test(rejected.data?.message || ""), rejected.data?.message);

  const afterEvil = await json(token, "GET", "/admin/code-projects");
  check(
    "no half-made project left behind",
    !(afterEvil.data?.items || []).some((p) => p.name === "Should Not Exist")
  );

  console.log("\n=== delete puts it in the bin, it does not destroy it ===");
  const del = await json(token, "DELETE", `/admin/code-projects/${id}`);
  check("delete accepted", del.status === 200, del.data?.message);

  const wsDir = path.resolve("uploads", "workspaces", id);
  check("nothing destroyed yet", fs.existsSync(wsDir));

  const live = await json(token, "GET", "/admin/code-projects?limit=100");
  check("gone from the live list", !(live.data?.items || []).some((p) => p._id === id));

  const bin = await json(token, "GET", "/admin/code-projects?view=trash&limit=100");
  check("waiting in the bin", (bin.data?.items || []).some((p) => p._id === id));

  const edit = await json(token, "PUT", `/admin/code-projects/${id}`, { name: "Renamed in the bin" });
  check("cannot be edited while binned", edit.status === 409, edit.data?.message);

  console.log("\n=== destroying it takes the name typed back ===");
  const bare = await json(token, "DELETE", `/admin/code-projects/${id}/permanent`, {});
  check("refused with no confirmation", bare.status === 400, bare.data?.message);
  check("and nothing was removed", fs.existsSync(wsDir));

  const wrong = await json(token, "DELETE", `/admin/code-projects/${id}/permanent`, {
    confirm: "some other project",
  });
  check("refused on the wrong name", wrong.status === 400);
  check("still on disk after that too", fs.existsSync(wsDir));

  const purged = await purge(token, id);
  check("permanent delete accepted", purged.status === 200, purged.data?.message);

  const gone = await json(token, "GET", `/admin/code-projects/${id}`);
  check("record gone", gone.status === 404);
  check("workspace folder removed from disk", !fs.existsSync(wsDir));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
