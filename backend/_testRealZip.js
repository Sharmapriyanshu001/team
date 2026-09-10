// Upload the user's own 712 KB archive through the real API and confirm the
// project comes out whole — the case that was silently half-failing.
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

const main = async () => {
  const admin = await json(null, "POST", "/admin/login", {
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (admin.status !== 200) {
    console.error("could not sign in");
    process.exitCode = 1;
    return;
  }
  const A = admin.data.token;

  /**
   * The real archive, whichever copy of it is still in uploads/. Originally
   * this looked for a project whose extraction had half-failed — but that is
   * the bug being fixed, so once it is fixed there is nothing to find. Testing
   * against the archive itself keeps working either way.
   */
  const uploads = path.resolve("uploads");
  const candidate = fs
    .readdirSync(uploads)
    .filter((f) => f.endsWith(".zip"))
    .map((f) => ({ name: f, size: fs.statSync(path.join(uploads, f)).size }))
    // The office_abhay archive is the large one; anything tiny is a demo zip
    .filter((f) => f.size > 200 * 1024)
    .sort((a, b) => a.size - b.size)[0];

  if (!candidate) {
    console.log("no sizeable archive in uploads/ to test against — skipping");
    return;
  }

  const zipPath = path.join(uploads, candidate.name);
  const bytes = fs.readFileSync(zipPath);
  console.log(`uploading a ${(bytes.length / 1024).toFixed(0)} KB archive\n`);

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "application/zip" }), "office_abhay.zip");
  form.append("name", "REALZIP verification");
  form.append("operationsManagers", "[]");
  form.append("employees", "[]");

  const res = await fetch(BASE + "/admin/code-projects", {
    method: "POST",
    headers: { Authorization: `Bearer ${A}` },
    body: form,
  });
  const data = await res.json().catch(() => null);

  check("upload accepted", res.status === 201, data?.message);
  if (res.status !== 201) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exitCode = 1;
    return;
  }

  const item = data.item;
  const id = item._id;

  check("workspace marked ready", item.workspaceReady === true);
  check("files were counted", item.fileCount > 200, `fileCount=${item.fileCount}`);
  check("size was measured", item.totalSize > 0, `${item.totalSize} bytes`);
  // A monorepo has no root package.json, so detection looks one level down and
  // prefers the front end — which is what a preview would want to show.
  check("stack detected from the subfolder", item.stack === "vite", item.stack);
  check("and it says which folder", item.rootDir === "frontend", item.rootDir || "(root)");
  check("entry file is relative to the workspace", item.entryFile === "frontend/index.html", item.entryFile);
  check("nothing rejected", (data.report?.rejected || []).length === 0);

  const wsRoot = path.resolve("uploads", "workspaces", id);
  const top = fs.readdirSync(wsRoot).sort();
  check("wrapper folder was stripped", !top.includes("office_abhay"), top.join(", "));
  check("backend/ and frontend/ are at the root", top.includes("backend") && top.includes("frontend"));

  const tree = await json(A, "GET", `/admin/code-projects/${id}/tree`);
  check("tree reads", tree.status === 200 && (tree.data?.tree || []).length > 0);

  const file = await json(
    A,
    "GET",
    `/admin/workspace/${id}/file?path=${encodeURIComponent("backend/server.js")}`
  );
  check("a real file opens", file.status === 200 && file.data.content.includes("express"));
  check("language detected", file.data?.language === "javascript", file.data?.language);

  const versions = await json(A, "GET", `/admin/code-projects/${id}/versions`);
  check("version 1 recorded", versions.data?.versions?.[0]?.isOriginal === true);

  console.log("\n=== cleanup ===");
  const del = await purge(A, id);
  check("verification project removed", del.status === 200, del.data?.message);
  check("workspace gone", !fs.existsSync(wsRoot));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
};

/**
 * Node is left to wind down on its own rather than being told to exit. Calling
 * process.exit() while a socket is still closing trips a libuv assertion on
 * Windows, which reads like a crash in the thing being tested when it is
 * nothing of the sort.
 */
main().catch((err) => {
  console.error("harness error:", err);
  process.exitCode = 1;
});
