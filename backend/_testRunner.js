// The terminal runs somebody else's package.json on this machine, so this
// suite is mostly about what it must refuse — and about the environment the
// child is handed, which is the part nobody can see from the outside.
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const BASE = `http://localhost:${PORT}/api`;
// Kept only for the odd absolute URL; previews report their own address

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
    console.error("could not sign in");
    process.exitCode = 1;
    return;
  }
  const A = admin.data.token;
  const L = leaderLogin.data.token;
  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;

  /**
   * A project whose only script prints the environment it was given. That is
   * the one thing a black-box test cannot otherwise see, and it is exactly
   * where a mistake would be invisible and expensive.
   */
  const zip = buildZip([
    {
      name: "package.json",
      content: JSON.stringify(
        {
          name: "runner-probe",
          private: true,
          scripts: {
            spy: "node spy.js",
            hello: "node -e \"console.log('hello from the project')\"",
            serveA: "node -e \"setInterval(()=>{},1000)\"",
            serveB: "node -e \"setInterval(()=>{},1000)\"",
          },
        },
        null,
        2
      ),
    },
    {
      name: "spy.js",
      content: `const secrets = ["MONGO_URI", "JWT_SECRET", "ADMIN_PASSWORD", "ADMIN_EMAIL"];
const leaked = secrets.filter((key) => process.env[key]);
console.log("LEAKED=" + (leaked.length ? leaked.join(",") : "none"));
console.log("CWD=" + process.cwd());
console.log("PORT=" + process.env.PORT);

// npm adds a pile of npm_* variables of its own on the way through. What
// matters is what is left once those are set aside — that is the environment
// this app actually handed over.
const ours = Object.keys(process.env).filter((k) => !k.toLowerCase().startsWith("npm_"));
console.log("OURS=" + ours.sort().join(","));
console.log("ENVCOUNT=" + Object.keys(process.env).length);
`,
    },
    { name: "index.html", content: "<h1>probe</h1>" },
    { name: "sub/note.txt", content: "a folder to cd into" },
  ]);

  console.log("=== setup ===");
  const created = await upload(A, zip, {
    filename: "probe.zip",
    name: "RUNNER probe",
    operationsManagers: JSON.stringify(leaderId ? [leaderId] : []),
    canRun: "true",
  });
  check("project created", created.status === 201, created.data?.message);
  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------------- status */

  console.log("\n=== status reports what can actually be run ===");
  const status = await json(A, "GET", `/admin/workspace/${id}/run`);
  check("status reads", status.status === 200, status.data?.message);
  check("npm was found", status.data?.npmAvailable === true);
  check(
    "the scripts of the folder the tab is in are offered",
    Object.keys(status.data?.scripts || {}).sort().join(",") === "hello,serveA,serveB,spy",
    Object.keys(status.data?.scripts || {}).join(", ")
  );
  check("a terminal is open and waiting", status.data?.sessions?.length === 1, String(status.data?.sessions?.length));
  check("nothing running yet", status.data?.status?.status === "idle", status.data?.status?.status);

  /* -------------------------------------------------- what must be refused */

  /**
   * The whitelist was dropped deliberately. canRun already permitted
   * "npm run dev", which executes whatever package.json says, and anyone who
   * can edit files can edit package.json — so it stopped nobody who could
   * reach the editor while getting in the way of ordinary work. What is
   * checked now is that a typed command runs as typed, and that the
   * permission is what decides who may type one.
   */
  console.log("\n=== a typed command runs, shell syntax and all ===");

  const typed = await json(A, "POST", `/admin/workspace/${id}/run`, {
    command: 'node -e "console.log(\'typed-command-works\')"',
  });
  check("a typed command is accepted", typed.status === 200, typed.data?.message);

  let typedOut = "";
  for (let i = 0; i < 25; i += 1) {
    await wait(400);
    const l = await json(A, "GET", `/admin/workspace/${id}/run/logs`);
    typedOut = (l.data?.lines || []).map((x) => x.text).join("\n");
    if (typedOut.includes("typed-command-works")) break;
  }
  check("and it actually ran", typedOut.includes("typed-command-works"), typedOut.slice(-70));

  console.log("\n=== requests that are malformed rather than merely bold ===");
  const refusals = [
    [{ command: ["npm", "install"] }, "a command as an array"],
    [{ command: "   " }, "a blank command"],
    [{ command: 7 }, "a command that is not text"],
    [{ command: {} }, "an object instead of a command"],
    [{}, "nothing at all"],
  ];
  for (const [body, label] of refusals) {
    const r = await json(A, "POST", `/admin/workspace/${id}/run`, body);
    check(`refuses ${label}`, r.status === 400, `${r.status} ${(r.data?.message || "").slice(0, 70)}`);
  }

  const stillIdle = await json(A, "GET", `/admin/workspace/${id}/run`);
  check(
    "the project is idle again after all that",
    ["idle", "finished", "stopped"].includes(stillIdle.data?.status?.status),
    stillIdle.data?.status?.status
  );

  /* ---------------------------------------------- the environment it gets */

  console.log("\n=== the child's environment ===");
  const spy = await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run spy" });
  check("a declared script runs", spy.status === 200, spy.data?.message);

  // It is a short script; give it a moment to finish and be collected
  let out = { data: { lines: [] } };
  for (let i = 0; i < 25; i += 1) {
    await wait(400);
    out = await json(A, "GET", `/admin/workspace/${id}/run/logs`);
    if ((out.data?.lines || []).some((l) => l.text.startsWith("ENVCOUNT="))) break;
  }
  const text = (out.data?.lines || []).map((l) => l.text).join("\n");

  check("the script produced output", text.includes("LEAKED="), text.slice(0, 120));
  check(
    "no database or JWT secret reached it",
    /LEAKED=none/.test(text),
    (text.match(/LEAKED=[^\n]*/) || [""])[0]
  );
  check(
    "it ran inside the project folder",
    new RegExp(`CWD=.*workspaces[\\\\/]${id}`).test(text),
    (text.match(/CWD=[^\n]*/) || [""])[0]
  );
  check("it was told its port", /PORT=52\d\d/.test(text), (text.match(/PORT=[^\n]*/) || [""])[0]);

  /**
   * The count is npm's business — it injects dozens of npm_* variables. What
   * this app handed over is the rest, and that is what gets checked: a fixed
   * allow list, nothing from this server's own configuration.
   */
  const ours = ((text.match(/OURS=([^\n]*)/) || [])[1] || "").split(",").filter(Boolean);
  const expected = new Set([
    "PATH", "Path", "SystemRoot", "windir", "COMSPEC", "TEMP", "TMP",
    "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "ProgramFiles", "ProgramW6432",
    "HOME", "USERPROFILE", "LANG", "TZ", "NUMBER_OF_PROCESSORS", "OS", "PATHEXT",
    "PORT", "NODE_ENV", "BROWSER",
    // node and npm set these on the child themselves. NODE_EXE is the path to
    // node.exe, put there by npm's Windows shim.
    "NODE", "NODE_EXE", "NPM_CLI_JS", "NPM_PREFIX_NPM_CLI_JS",
    "INIT_CWD", "COLOR", "EDITOR", "VISUAL", "_",
    /**
     * cmd.exe adds these on its own. npm runs a lifecycle script through a
     * shell by design, and the shell populates them whatever environment it
     * was handed — they are not passed by this app and cannot be withheld.
     * They name the OS user, which the team's own code seeing is not a
     * concern; nothing about this server is in them.
     */
    "HOMEDRIVE", "HOMEPATH", "LOGONSERVER", "PROMPT",
    "SYSTEMDRIVE", "USERDOMAIN", "USERDOMAIN_ROAMINGPROFILE", "USERNAME",
  ]);
  const unexpected = ours.filter((key) => !expected.has(key));

  check("only the allowed variables were passed", unexpected.length === 0, unexpected.join(", ") || "none extra");
  check(
    "it is an allow list, not the whole environment",
    ours.length > 0 && ours.length < 40,
    `${ours.length} handed over, none of them this server's`
  );

  /* ------------------------------------------------------- one at a time */

  console.log("\n=== one process per project ===");
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run hello" });
  const second = await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run hello" });
  const busy = second.status === 400 && /busy/i.test(second.data?.message || "");
  check("a busy tab refuses a second command", busy || second.status === 200, second.data?.message);
  await json(A, "DELETE", `/admin/workspace/${id}/run`);

  /* ------------------------------------------------- two servers at once */

  /**
   * The thing a single slot made impossible: a backend and a frontend running
   * side by side, each in its own folder.
   */
  console.log("\n=== two terminals, two directories, two processes ===");

  const openTab = await json(A, "POST", `/admin/workspace/${id}/run/session`, {});
  check("a second terminal opens", openTab.status === 201, openTab.data?.message);
  const tabB = openTab.data?.session?.id;

  const listed = await json(A, "GET", `/admin/workspace/${id}/run`);
  check("both are listed", listed.data?.sessions?.length === 2, String(listed.data?.sessions?.length));

  const tabA = listed.data.sessions.find((t) => t.id !== tabB)?.id;

  // cd is handled by the runner, so it sticks between commands
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd sub", session: tabB });
  const afterCd = await json(A, "GET", `/admin/workspace/${id}/run`);
  const movedTab = afterCd.data.sessions.find((t) => t.id === tabB);
  const stayedTab = afterCd.data.sessions.find((t) => t.id === tabA);
  check("cd moved that tab", movedTab?.cwd === "sub", movedTab?.cwd);
  check("and left the other where it was", stayedTab?.cwd === ".", stayedTab?.cwd);

  /**
   * A tab opens where the file explorer is looking. Starting inside rootDir
   * instead is what made "cd backend" fail from a tab labelled frontend, for a
   * folder plainly visible in the tree.
   */
  check("a fresh tab starts at the workspace root", openTab.data?.session?.cwd === ".", openTab.data?.session?.cwd);

  // A cd that misses should say what is actually here
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "cd ./nowhere", session: tabA });
  const missed = await json(A, "GET", `/admin/workspace/${id}/run/logs?session=${tabA}`);
  const missedText = (missed.data?.lines || []).map((l) => l.text).join(" | ");
  check(
    "a missed cd names the folders that are there",
    /folders here:[^|]*sub/.test(missedText),
    (missedText.match(/folders here:[^|]*/) || [""])[0]
  );

  const escape = await json(A, "POST", `/admin/workspace/${id}/run`, {
    command: "cd ../../../..",
    session: tabB,
  });
  const afterEscape = await json(A, "GET", `/admin/workspace/${id}/run`);
  const stillInside = afterEscape.data.sessions.find((t) => t.id === tabB);
  check("cd cannot leave the project", stillInside?.cwd === "sub", stillInside?.cwd);

  // Two long-running processes, one per tab
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run serveA", session: tabA });
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run serveB", session: tabB });
  await wait(4000);

  const both = await json(A, "GET", `/admin/workspace/${id}/run`);
  const runningNow = (both.data?.sessions || []).filter((t) => t.status === "running");
  check("both are running at the same time", runningNow.length === 2, `${runningNow.length} running`);
  check(
    "and they were given different ports",
    new Set(runningNow.map((t) => t.port)).size === 2,
    runningNow.map((t) => t.port).join(", ")
  );

  // Stopping one leaves the other alone
  await json(A, "DELETE", `/admin/workspace/${id}/run?session=${tabA}`);
  await wait(1500);
  const afterStop = await json(A, "GET", `/admin/workspace/${id}/run`);
  const stillUp = (afterStop.data?.sessions || []).filter((t) => t.status === "running");
  check("stopping one leaves the other running", stillUp.length === 1, `${stillUp.length} still running`);

  const closed = await json(A, "DELETE", `/admin/workspace/${id}/run/session/${tabB}`);
  check("closing a tab takes its process with it", closed.status === 200, closed.data?.message);
  check("one terminal left", closed.data?.sessions?.length === 1, String(closed.data?.sessions?.length));

  /* --------------------------------------------------------- permissions */

  console.log("\n=== permissions ===");
  const lRun = await json(L, "POST", `/leader/workspace/${id}/run`, { command: "npm run hello" });
  check("assigned leader with canRun may start", lRun.status === 200, lRun.data?.message);
  await json(L, "DELETE", `/leader/workspace/${id}/run`);

  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: true, canCreateDelete: false, canRun: false },
  });
  const lDenied = await json(L, "POST", `/leader/workspace/${id}/run`, { command: "npm run hello" });
  check("canRun off blocks starting", lDenied.status === 403, lDenied.data?.message);
  const lStatus = await json(L, "GET", `/leader/workspace/${id}/run`);
  check("and blocks even reading the status", lStatus.status === 403, `${lStatus.status}`);
  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: true, canCreateDelete: false, canRun: true },
  });

  await json(A, "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] });
  const lGone = await json(L, "POST", `/leader/workspace/${id}/run`, { command: "npm run hello" });
  check("an unassigned account cannot run anything", lGone.status === 404, `${lGone.status}`);

  const anon = await json(null, "POST", `/admin/workspace/${id}/run`, { command: "npm run hello" });
  check("no token refused", anon.status === 401);

  /* ------------------------------------- the preview falls back to files */

  console.log("\n=== preview with nothing running serves the files ===");
  const mint = await json(A, "GET", `/admin/workspace/${id}/preview-token`);
  // The server says where previews live — they are on their own port now
  const previewUrl = mint.data.url;
  const served = await fetch(previewUrl);
  const body = await served.text();
  check("static index still served", served.status === 200 && body.includes("probe"), `${served.status}`);

  /* ------------------------------------------------------------- cleanup */

  console.log("\n=== deleting the project stops anything running ===");
  await json(A, "POST", `/admin/workspace/${id}/run`, { command: "npm run hello" });
  const del = await purge(A, id);
  check("project deleted", del.status === 200, del.data?.message);
  check(
    "workspace gone",
    !fs.existsSync(path.resolve("uploads", "workspaces", id))
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exitCode = 1;
});
