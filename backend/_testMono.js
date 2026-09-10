// The case that was reported: a workspace whose tree shows backend/ and
// frontend/ side by side, and a terminal that could not cd into either.
import dotenv from "dotenv";
dotenv.config();

const BASE = `http://localhost:${process.env.PORT_UNDER_TEST || 5099}/api`;
let pass = 0, fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

let table = null;
const crc32 = (buf) => {
  if (!table) {
    table = [];
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const buildZip = (entries) => {
  const parts = [], central = []; let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.content ?? "", "utf8");
    const nameBuf = Buffer.from(entry.name, "utf8");
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4);
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    parts.push(head, nameBuf, data);
    const localOffset = offset; offset += head.length + nameBuf.length + data.length;
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE(localOffset, 42);
    central.push(c, nameBuf);
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, end]);
};

const json = async (token, method, route, body) => {
  const res = await fetch(BASE + route, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null; try { data = await res.json(); } catch {}
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

const main = async () => {
  const admin = await json(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD,
  });
  if (admin.status !== 200) { console.error("could not sign in"); process.exitCode = 1; return; }
  const A = admin.data.token;

  const zip = buildZip([
    { name: "backend/package.json", content: JSON.stringify({ name: "api", scripts: { dev: "node -e \"setInterval(()=>{},1000)\"" } }) },
    { name: "backend/server.js", content: "// api" },
    // A real Vite app, so the preview has to decide what to do with one
    { name: "frontend/package.json", content: JSON.stringify({ name: "ui", scripts: { dev: "node -e \"setInterval(()=>{},1000)\"" }, devDependencies: { vite: "^7.0.0" }, dependencies: { react: "^19.0.0" } }) },
    { name: "frontend/index.html", content: '<!doctype html><html><body><script type="module" src="/src/main.jsx"></script></body></html>' },
    { name: "frontend/src/main.jsx", content: "// ui" },
  ]);

  const form = new FormData();
  form.append("file", new Blob([zip], { type: "application/zip" }), "mono.zip");
  form.append("name", "MONO probe");
  form.append("canRun", "true");
  const res = await fetch(BASE + "/admin/code-projects", {
    method: "POST", headers: { Authorization: `Bearer ${A}` }, body: form,
  });
  const created = await res.json();
  check("monorepo project created", res.status === 201, created?.message);
  const id = created?.item?._id;
  if (!id) { console.log(`\n${pass} passed, ${fail + 1} failed`); process.exitCode = 1; return; }

  console.log("\n=== the terminal opens where the tree is looking ===");
  const status = await json(A, "GET", `/admin/workspace/${id}/run`);
  const tab = status.data?.sessions?.[0];
  check("rootDir was detected one level down", status.data?.rootDir === "frontend", status.data?.rootDir);
  check("and it was recognised as vite", status.data?.stack === "vite", status.data?.stack);
  check("but the tab still opens at the root", tab?.cwd === ".", tab?.cwd);

  const logs = await json(A, "GET", `/admin/workspace/${id}/run/logs?session=${tab.id}`);
  const opening = (logs.data?.lines || []).map((l) => l.text).join(" | ");
  check("and it names the folders worth cd-ing into", /cd into one to run it:[^|]*backend/.test(opening) && /frontend/.test(opening), (opening.match(/cd into one[^|]*/) || [""])[0]);

  console.log("\n=== the cd that was failing ===");
  for (const folder of ["backend", "frontend"]) {
    await json(A, "POST", `/admin/workspace/${id}/run`, { command: `cd ${folder}`, session: tab.id });
    const after = await json(A, "GET", `/admin/workspace/${id}/run?session=${tab.id}`);
    const now = after.data?.sessions?.find((s) => s.id === tab.id);
    check(`cd ${folder} works from a fresh tab`, now?.cwd === folder, now?.cwd);
    check(`and the buttons show ${folder}'s scripts`, Object.keys(after.data?.scripts || {}).join(",") === "dev", Object.keys(after.data?.scripts || {}).join(","));
    await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd ..", session: tab.id });
  }

  console.log("\n=== npm cannot walk out of the workspace ===");
  /**
   * npm searches parent folders for a package.json when the current one has
   * none. Above a workspace sits this server's own backend, so an unguarded
   * "npm run dev" at a monorepo root started a second copy of the real app
   * against the real database. The cwd jail never saw it — npm left on its own.
   */
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd ..", session: tab.id });
  const npmAtRoot = await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run dev", session: tab.id });
  const rootLogs = await json(A, "GET", `/admin/workspace/${id}/run/logs?session=${tab.id}`);
  const rootText = (rootLogs.data?.lines || []).map((l) => l.text).join(" | ");
  check("npm at a root with no package.json is refused", /no package.json in ./.test(rootText), (rootText.match(/There is no[^|]*/) || [""])[0]);
  check("and it says which folder to cd into", /Try "cd (backend|frontend)"/.test(rootText), (rootText.match(/Try "cd[^|]*/) || [""])[0]);
  check("nothing was started", npmAtRoot.data?.status?.status !== "running", npmAtRoot.data?.status?.status);

  for (const command of ["npm install", "yarn dev", "pnpm i", "npx vite"]) {
    const tried = await json(A, "POST", `/admin/workspace/${id}/run`, { command, session: tab.id });
    check(`"${command}" is refused at the root too`, tried.data?.status?.status !== "running", tried.data?.status?.status);
  }

  // But inside a package folder it is allowed through as normal
  await json(A, "DELETE", `/admin/workspace/${id}/run?session=${tab.id}`);
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd backend", session: tab.id });
  const allowed = await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run dev", session: tab.id });
  check("npm runs where a package.json actually is", allowed.data?.status?.status === "running", allowed.data?.status?.status);
  await json(A, "DELETE", `/admin/workspace/${id}/run?session=${tab.id}`);
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd ..", session: tab.id });

  console.log("\n=== the preview says what to do instead of 404-ing ===");
  const mint = await json(A, "GET", `/admin/workspace/${id}/preview-token`);
  const page = await fetch(mint.data.url, { redirect: "manual" });
  const html = await page.text();
  check("a build-step project with no server does not serve raw source", page.status === 503, String(page.status));
  check("and the page says how to start it", /npm run dev/.test(html) && /cd /.test(html), html.includes("npm run dev") ? "names the commands" : html.slice(0, 80));

  // "cd ../backend" from inside frontend, which is what the user typed next
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd frontend", session: tab.id });
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd ../backend", session: tab.id });
  const sideways = await json(A, "GET", `/admin/workspace/${id}/run?session=${tab.id}`);
  check("cd ../backend crosses between them", sideways.data?.sessions?.find((s) => s.id === tab.id)?.cwd === "backend", sideways.data?.sessions?.find((s) => s.id === tab.id)?.cwd);

  await purge(A, id);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
};

main().catch((e) => { console.error(e); process.exitCode = 1; });
