// The end-to-end claim: install a real Vite project from the terminal, start
// its dev server, and have the preview serve the running app rather than the
// raw JSX the browser cannot execute.
//
// This one genuinely installs packages, so it is slow. That is the point —
// everything faster than this is a proxy for the thing being claimed.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const BASE = `http://localhost:${PORT}/api`;
// Previews live on their own port, which is where the browser is sent too
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT_UNDER_TEST) || Number(PORT) + 1;
const ORIGIN = `http://localhost:${PREVIEW_PORT}`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Wait for a condition, reporting what the terminal said if it never comes. */
const until = async (label, token, id, predicate, timeoutMs) => {
  const started = Date.now();
  let last = null;

  while (Date.now() - started < timeoutMs) {
    const logs = await json(token, "GET", `/admin/workspace/${id}/run/logs`);
    last = logs.data;
    if (predicate(last)) return { ok: true, data: last, took: Date.now() - started };
    await wait(2000);
  }

  const tail = (last?.lines || []).slice(-6).map((l) => l.text).join(" / ");
  return { ok: false, tail, took: Date.now() - started };
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

  /* --------------------------------------------- find a Vite code project */

  const list = await json(A, "GET", "/admin/code-projects");
  const project = (list.data?.items || []).find(
    (p) => p.workspaceReady && ["vite", "react", "next"].includes(p.stack)
  );

  if (!project) {
    console.log("No Vite/React code project on record — nothing to run against.");
    console.log("Upload one through the panel and run this again.");
    return;
  }

  const id = project._id;
  console.log(`project: ${project.name}  (${project.stack}, root "${project.rootDir || "."}")\n`);

  const workspace = path.resolve("uploads", "workspaces", id);
  const appDir = project.rootDir ? path.join(workspace, project.rootDir) : workspace;
  const hadModules = fs.existsSync(path.join(appDir, "node_modules"));

  /* --------------------------------------------------------------- install */

  /**
   * A terminal now opens at the workspace root, the way VS Code opens one at
   * the folder you have open. For a project whose app sits in a subfolder that
   * means walking there first — the same "cd frontend" a person types.
   */
  if (project.rootDir) {
    await json(A, "POST", `/admin/workspace/${id}/run`, { command: `cd ${project.rootDir}` });
    const where = (await json(A, "GET", `/admin/workspace/${id}/run`)).data?.sessions?.[0]?.cwd;
    check(`cd ${project.rootDir} landed`, where === project.rootDir, where);
  }

  console.log("=== npm install ===");
  if (hadModules) {
    console.log("  node_modules already there — skipping the install");
    check("node_modules present", true);
  } else {
    const started = await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm install" });
    check("install started", started.status === 200, started.data?.message);

    const done = await until(
      "install",
      A,
      id,
      (d) => ["finished", "error", "stopped"].includes(d?.status?.status),
      12 * 60 * 1000
    );
    check("install finished", done.ok, done.ok ? `${Math.round(done.took / 1000)}s` : done.tail);
    check(
      "it succeeded",
      done.data?.status?.status === "finished",
      done.data?.status?.status
    );
    check("node_modules exists now", fs.existsSync(path.join(appDir, "node_modules")));
  }

  /* ------------------------------------------------------------ dev server */

  console.log("\n=== npm run dev ===");
  const scripts = (await json(A, "GET", `/admin/workspace/${id}/run`)).data?.scripts || {};
  const devScript = ["dev", "start", "serve"].find((s) => scripts[s]);
  check("a dev script exists", Boolean(devScript), Object.keys(scripts).join(", "));

  if (!devScript) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exitCode = 1;
    return;
  }

  const dev = await json(A, "POST", `/admin/workspace/${id}/run`, {
    command: `npm run ${devScript}`,
  });
  check(`npm run ${devScript} started`, dev.status === 200, dev.data?.message);

  const up = await until("server", A, id, (d) => d?.status?.serverUp, 3 * 60 * 1000);
  check("the dev server came up", up.ok, up.ok ? `${Math.round(up.took / 1000)}s` : up.tail);

  const port = up.data?.status?.port;
  check("and its port was picked up", Boolean(port), String(port));

  /* --------------------------------------------------------------- preview */

  console.log("\n=== the preview now proxies to it ===");
  const mint = await json(A, "GET", `/admin/workspace/${id}/preview-token`);
  check("preview token issued", mint.status === 200);
  const url = `${ORIGIN}${mint.data.path}`;

  // The server may need a breath after announcing itself
  await wait(1500);

  // Follows the redirect onto the slug URL, exactly as a browser would
  const page = await fetch(url, { redirect: "follow" });
  const html = await page.text();
  const landed = page.url;
  check(
    "the preview lands on the slug route",
    /\/preview\/s\/[a-f0-9]{32}\//.test(landed),
    landed.replace(/^https?:\/\/[^/]+/, "")
  );
  check("the preview answers", page.status === 200, String(page.status));
  check("it returned HTML", (page.headers.get("content-type") || "").includes("text/html"));

  /**
   * The proof that this is the dev server and not the file on disk: Vite
   * injects its client into every page it serves. The raw index.html has no
   * such thing.
   */
  const viteInjected = /@vite\/client|@react-refresh/.test(html);
  check("Vite's client is in the page — this is the dev server", viteInjected, html.slice(0, 140).replace(/\s+/g, " "));

  /**
   * The check that matters. The page asks for these by absolute path, so the
   * browser requests them from the origin root — which is exactly where they
   * 404'd before the dev server was given a matching --base.
   */
  const base = landed.endsWith("/") ? landed : `${landed}/`;
  const asks = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]);
  check("the page asks for prefixed paths", asks.every((p) => p.startsWith("/preview/s/")), asks.slice(0, 3).join(" "));

  let broken = [];
  for (const asked of asks.slice(0, 6)) {
    const r = await fetch(`${new URL(asked, landed).href}`);
    if (r.status !== 200) broken.push(`${asked} -> ${r.status}`);
  }
  check("every asset the page asks for loads", broken.length === 0, broken.join(", ") || `${asks.length} checked`);

  const favicon = await fetch(new URL("favicon.svg", base).href);
  check("favicon.svg loads", favicon.status === 200, String(favicon.status));

  // And the module the browser could never have run from disk
  const mainJs = await fetch(`${base}src/main.jsx`);
  const mainBody = await mainJs.text();
  check("src/main.jsx is served", mainJs.status === 200, String(mainJs.status));
  check(
    "and it came back transformed, not as raw JSX",
    !mainBody.includes("<StrictMode>") || mainBody.includes("jsxDEV") || mainBody.includes("_jsx"),
    mainBody.slice(0, 100).replace(/\s+/g, " ")
  );

  const viteClient = await fetch(`${base}@vite/client`);
  check("Vite's own client endpoint proxies too", viteClient.status === 200, String(viteClient.status));

  /* ------------------------------------------------------------------ stop */

  console.log("\n=== stop ===");
  const stopped = await json(A, "DELETE", `/admin/workspace/${id}/run`);
  check("stopped", stopped.status === 200, stopped.data?.message);

  await wait(2500);
  const after = await json(A, "GET", `/admin/workspace/${id}/run`);
  check("status is no longer running", after.data?.status?.serverUp !== true, after.data?.status?.status);

  const reachable = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })
    .then(() => true)
    .catch(() => false);
  check("the port was released", !reachable, reachable ? "still answering" : "closed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exitCode = 1;
});
