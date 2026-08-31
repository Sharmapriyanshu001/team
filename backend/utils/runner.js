import { spawn } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { workspaceDir } from "./workspaceFs.js";

/**
 * The workspace terminal: several sessions per project, each its own shell.
 *
 * Several, because one was not enough to do the obvious thing. A project with
 * a backend and a frontend needs both running at once, and a single slot meant
 * starting the second stopped the first. Sessions are the answer a terminal
 * already has for this — tabs.
 *
 * Each session keeps its own working directory, its own process and its own
 * output, so `cd backend` in one has no bearing on the other.
 *
 * This runs commands on this machine as the account the server runs under.
 * That is what a terminal is, and pretending otherwise would be the dishonest
 * option — so here is the reasoning rather than a reassurance.
 *
 * An earlier version allowed only `npm install` and the scripts package.json
 * declared. That looked stricter than it was: `npm run dev` executes whatever
 * package.json says, and anyone who can edit files can edit package.json. The
 * whitelist stopped nobody who could already reach the editor, while getting
 * in the way of everybody doing ordinary work. So the permission that matters
 * is canRun — hold it and you can run things; do not and you cannot.
 *
 * What is still enforced, because each of these is worth something on its own:
 *
 *   scrubbed env   the child is built a fresh environment from an allow list.
 *                  MONGO_URI and JWT_SECRET are never in it, so a command run
 *                  here cannot read the credentials to this app's database.
 *   jailed cwd     a session's directory can only ever be inside its project
 *   one per tab    a session runs one process; open another tab for another
 *   timeouts       nothing is left running indefinitely
 *   caps           output is bounded so a chatty build cannot exhaust memory
 *
 * What it does not do is isolate. A command run here reaches whatever this
 * process reaches. That is what the container in the plan was for, and until
 * there is one, canRun should be given to people you would hand a terminal to.
 */

/* ------------------------------------------------------------------ limits */

// A dev server left running all night is somebody who forgot, not somebody
// working. It is stopped rather than left holding a port.
const IDLE_MS = 3 * 60 * 60 * 1000;

const MAX_LOG_LINES = 600;
const MAX_LINE_LENGTH = 2000;
const MAX_COMMAND_LENGTH = 2000;

// Enough tabs to run a stack, few enough that nothing runs away
const MAX_SESSIONS = 6;

// One port per session, handed out from a small fixed range.
const PORT_FIRST = 5200;
const PORT_LAST = 5260;

/* -------------------------------------------------------------- npm itself */

/**
 * Only used to tell the panel whether npm is here at all. Commands run through
 * a shell, so npm is found on PATH like anything else.
 */
const npmCli = (() => {
  const candidates = [
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  return candidates.find((file) => fs.existsSync(file)) || null;
})();

export const npmAvailable = () => Boolean(npmCli);

/* ---------------------------------------------------------------- the state */

/** projectId -> Map of sessionId -> session */
const projects = new Map();

const sessionsOf = (projectId) => {
  const key = String(projectId);
  if (!projects.has(key)) projects.set(key, new Map());
  return projects.get(key);
};

const everySession = function* () {
  for (const sessions of projects.values()) {
    for (const session of sessions.values()) yield session;
  }
};

const takenPorts = () => {
  const taken = new Set();
  for (const session of everySession()) if (session.port) taken.add(session.port);
  return taken;
};

const nextPort = () => {
  const taken = takenPorts();
  for (let port = PORT_FIRST; port <= PORT_LAST; port += 1) {
    if (!taken.has(port)) return port;
  }
  return null;
};

/* ------------------------------------------------------------------- output */

const ANSI = /\[[0-9;]*[A-Za-z]/g;

const stripAnsi = (text) => String(text).replace(ANSI, "");

const pushLine = (session, stream, text) => {
  const clean = stripAnsi(text).slice(0, MAX_LINE_LENGTH);
  session.logs.push({ n: session.nextLine, stream, text: clean, at: new Date().toISOString() });
  session.nextLine += 1;
  if (session.logs.length > MAX_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_LOG_LINES);
  }
};

const pushChunk = (session, stream, chunk) => {
  chunk
    .toString("utf8")
    .split(/\r?\n/)
    .forEach((line, index, all) => {
      // A trailing empty piece is just the final newline, not a blank line
      if (line === "" && index === all.length - 1) return;
      pushLine(session, stream, line);
    });
};

/**
 * Dev servers announce where they landed, and Vite prints the port in bold —
 * so the raw bytes read "127.0.0.1:" then an escape, not a digit. This is
 * given text that has already been stripped, which is why the port is found
 * at all.
 */
const sniffPort = (session, text) => {
  const match = String(text).match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):(\d{2,5})/i);
  if (!match) return;

  const found = Number(match[1]);
  if (found && found !== session.port) {
    pushLine(session, "system", `Server is on port ${found}`);
    session.port = found;
  }
  session.serverUp = true;
};

/* --------------------------------------------------------------- environment */

/**
 * What the child is allowed to see. Built up from nothing rather than copied
 * from this process and edited down — a deny list is one forgotten variable
 * away from handing out the database URI.
 */
const ALLOWED_ENV = [
  "SystemRoot",
  "windir",
  "COMSPEC",
  "TEMP",
  "TMP",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMFILES",
  "ProgramFiles",
  "ProgramW6432",
  "HOME",
  "USERPROFILE",
  "LANG",
  "TZ",
  "NUMBER_OF_PROCESSORS",
  "OS",
  "PATHEXT",
];

const childEnv = (port) => {
  const env = {};
  ALLOWED_ENV.forEach((key) => {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  });

  /**
   * PATH is set once, under one name. Windows treats the name as
   * case-insensitive but a plain object does not, and passing both PATH and
   * Path leaves it undefined which one the child ends up with.
   */
  env.PATH = process.env.PATH || process.env.Path || "";

  // What the project itself is told
  env.PORT = String(port);
  env.NODE_ENV = "development";
  env.BROWSER = "none";
  env.npm_config_update_notifier = "false";
  env.npm_config_fund = "false";
  env.npm_config_audit = "false";

  return env;
};

/* ------------------------------------------------------------- what may run */

const readScripts = (dir) => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    return pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  } catch {
    return {};
  }
};

/**
 * The scripts of whichever folder this tab is sitting in.
 *
 * Per tab rather than per project, because a repository has more than one
 * package.json and the buttons should offer what would actually run from
 * here. Standing in the root of a monorepo, the honest answer is none.
 */
export const scriptsOf = (project, sessionId) => {
  const root = workspaceDir(project._id);
  if (!root) return {};

  const session = getSession(project, sessionId);
  return readScripts(session ? session.cwd : root);
};

/* ---------------------------------------------------------------- sessions */

const relativeCwd = (root, absolute) => {
  const rel = path.relative(root, absolute).split(path.sep).join("/");
  return rel === "" ? "." : rel;
};

const describeSession = (session, root) => ({
  id: session.id,
  name: session.name,
  cwd: relativeCwd(root, session.cwd),
  status: session.status,
  label: session.label,
  port: session.port,
  serverUp: Boolean(session.serverUp && session.status === "running"),
  lines: session.nextLine - 1,
});

export const openSession = (project, name) => {
  const root = workspaceDir(project._id);
  if (!root) return { error: "This project has no workspace" };

  const sessions = sessionsOf(project._id);
  if (sessions.size >= MAX_SESSIONS) {
    return { error: `A project can have ${MAX_SESSIONS} terminals at once — close one first` };
  }

  /**
   * A tab opens at the workspace root, which is what the file explorer beside
   * it is showing. Starting inside rootDir instead meant "cd backend" failed
   * from a tab labelled frontend, for a folder plainly visible in the tree —
   * the terminal and the explorer disagreeing about where "here" is.
   */
  const session = {
    id: crypto.randomBytes(6).toString("hex"),
    name: (name || "").trim() || `Terminal ${sessions.size + 1}`,
    cwd: root,
    status: "idle",
    label: "",
    logs: [],
    nextLine: 1,
    port: null,
    serverUp: false,
    slug: crypto.randomBytes(16).toString("hex"),
    child: null,
    idle: null,
  };

  sessions.set(session.id, session);
  pushLine(session, "system", `${session.name} — ${relativeCwd(root, session.cwd)}`);

  /**
   * A monorepo has no package.json at the root, so "npm run dev" here fails
   * and the reason is one folder away. Naming the folders that hold one turns
   * that into an obvious "cd backend" instead of a hunt.
   */
  try {
    const withPackage = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(root, name, "package.json")));

    if (withPackage.length && !fs.existsSync(path.join(root, "package.json"))) {
      pushLine(session, "system", `cd into one to run it: ${withPackage.join("  ")}`);
    }
  } catch {
    /* the prompt works without the hint */
  }

  return { session: describeSession(session, root) };
};

/**
 * Every session for a project, opening the first if there is none — a terminal
 * that appears empty and asks you to make a tab wastes a click.
 */
export const listSessions = (project) => {
  const root = workspaceDir(project._id);
  if (!root) return { sessions: [], root: "" };

  const sessions = sessionsOf(project._id);
  if (sessions.size === 0) openSession(project);

  return {
    sessions: [...sessions.values()].map((s) => describeSession(s, root)),
    root: project.rootDir || ".",
  };
};

const getSession = (project, sessionId) => {
  const sessions = sessionsOf(project._id);
  if (sessionId) return sessions.get(String(sessionId)) || null;

  // No id given: the first — the common case is a single tab
  return sessions.values().next().value || null;
};

/* ------------------------------------------------------------------ control */

const clearTimers = (session) => {
  if (session.idle) clearTimeout(session.idle);
  session.idle = null;
};

/** Kill the whole tree — npm spawns the real server as a child of itself. */
const killTree = (session) => {
  if (!session.child || session.child.exitCode !== null) return;

  if (process.platform === "win32") {
    // taskkill is the only reliable way to take a Windows process tree down
    const killer = spawn("taskkill", ["/pid", String(session.child.pid), "/T", "/F"], {
      shell: false,
      windowsHide: true,
      stdio: "ignore",
    });
    killer.on("error", () => session.child.kill("SIGKILL"));
  } else {
    try {
      process.kill(-session.child.pid, "SIGKILL");
    } catch {
      session.child.kill("SIGKILL");
    }
  }
};

export const stop = async (projectId, sessionId) => {
  const sessions = sessionsOf(projectId);
  const targets = sessionId
    ? [sessions.get(String(sessionId))].filter(Boolean)
    : [...sessions.values()];

  let stopped = false;
  for (const session of targets) {
    if (session.status !== "running") continue;
    pushLine(session, "system", "Stopped");
    clearTimers(session);
    session.status = "stopped";
    session.serverUp = false;
    killTree(session);
    stopped = true;
  }

  return { stopped };
};

export const closeSession = async (project, sessionId) => {
  const sessions = sessionsOf(project._id);
  if (!sessions.has(String(sessionId))) return { closed: false };

  await stop(project._id, sessionId);
  sessions.delete(String(sessionId));

  return { closed: true };
};

/* ---------------------------------------------------------- built-in: cd */

/**
 * `cd` is handled here rather than passed to the shell.
 *
 * Each command runs in a fresh shell, so a `cd` inside one would be forgotten
 * the moment it exited — which is not what anybody typing it expects. Holding
 * the directory on the session makes it behave, and fencing it against the
 * workspace root keeps a session inside its own project.
 */
const handleCd = (session, root, argument) => {
  const wanted = argument.trim().replace(/^["']|["']$/g, "");

  if (!wanted || wanted === "~") {
    session.cwd = root;
    pushLine(session, "system", relativeCwd(root, session.cwd));
    return;
  }

  const from = wanted.startsWith("/") ? root : session.cwd;
  const target = path.resolve(from, wanted);

  const fence = root.endsWith(path.sep) ? root : root + path.sep;
  if (target !== root && !target.startsWith(fence)) {
    pushLine(session, "err", "You cannot leave the project folder");
    return;
  }

  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    pushLine(session, "err", `No such folder: ${wanted}`);

    // A bare "not found" leaves you guessing. The folders that are here cost
    // nothing to list and are almost always what was meant.
    try {
      const here = fs.readdirSync(session.cwd, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
        .map((entry) => entry.name);
      if (here.length) pushLine(session, "system", `folders here: ${here.join("  ")}`);
    } catch {
      /* if the folder cannot be read, the error above is enough */
    }
    return;
  }

  session.cwd = target;
  pushLine(session, "system", relativeCwd(root, session.cwd));
};

/* -------------------------------------------------------------------- start */

/**
 * npm does not stop at the folder you are standing in. Given no package.json
 * there, it walks *up* the tree until it finds one — and above a workspace sits
 * this server's own backend folder. A tab opened at the root of a monorepo,
 * where there is no package.json, therefore ran `npm run dev` against this
 * application's package.json: it started a second copy of the real server,
 * which read the real .env and connected to the real database.
 *
 * The cwd jail did not catch it because the process never changed directory —
 * npm reached out of the workspace by itself. So the boundary has to be checked
 * here: a package manager may only run where a package.json exists at or below
 * the workspace root. Anything else is npm about to leave.
 */
// npx belongs here too: it resolves a binary out of node_modules/.bin by the
// same upward walk, so it leaves the workspace for the same reason npm does.
const PACKAGE_MANAGERS = /^\s*(npm|npx|yarn|pnpm|bun|bunx)\b/i;

const packageRootFor = (cwd, root) => {
  let here = cwd;
  for (;;) {
    if (fs.existsSync(path.join(here, "package.json"))) return here;
    if (here === root) return null;
    const up = path.dirname(here);
    // Stop at the root even if the path walk cannot climb any further
    if (up === here) return null;
    here = up;
  }
};

const foldersWithPackages = (root) => {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "node_modules")
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(root, name, "package.json")));
  } catch {
    return [];
  }
};

export const start = async (project, { command, sessionId }, actorName) => {
  const root = workspaceDir(project._id);
  if (!root || !project.workspaceReady || !fs.existsSync(root)) {
    return { error: "This project has no extracted workspace" };
  }

  const sessions = sessionsOf(project._id);
  if (sessions.size === 0) openSession(project);

  const session = getSession(project, sessionId);
  if (!session) return { error: "That terminal is not open any more" };

  if (session.status === "running") {
    return { error: `This terminal is busy with "${session.label}" — open another tab` };
  }

  const text = String(command || "").trim();
  if (!text) return { error: "Type a command first" };
  if (text.length > MAX_COMMAND_LENGTH) {
    return { error: `That command is longer than ${MAX_COMMAND_LENGTH} characters` };
  }

  pushLine(session, "cmd", `${relativeCwd(root, session.cwd)}> ${text}`);

  // cd never reaches the shell — see handleCd
  const cd = text.match(/^cd(?:\s+(.*))?$/i);
  if (cd) {
    handleCd(session, root, cd[1] || "");
    return { started: true, session: describeSession(session, root) };
  }

  // A package manager with nothing to work on here would go looking outside
  if (PACKAGE_MANAGERS.test(text) && !packageRootFor(session.cwd, root)) {
    const options = foldersWithPackages(root);
    const where = relativeCwd(root, session.cwd);
    const hint = options.length
      ? `Try "cd ${options[0]}" first — package.json is in: ${options.join("  ")}`
      : "This project has no package.json anywhere.";

    pushLine(session, "err", `There is no package.json in ${where}, so npm has nothing to run here.`);
    pushLine(session, "system", hint);
    return { started: true, session: describeSession(session, root) };
  }

  const port = session.port || nextPort();
  if (!port) return { error: "No free port — stop a running terminal first" };
  session.port = port;

  /**
   * Vite is told the port and the prefix the preview serves it under, unless
   * the command already says otherwise. Somebody who typed --port meant it.
   */
  const looksLikeVite = /\b(vite|npm\s+run\s+dev|yarn\s+dev|pnpm\s+dev)\b/i.test(text);
  const alreadyHasPort = /--port\b|-p\s+\d/.test(text);
  const extra =
    looksLikeVite && !alreadyHasPort
      ? ` -- --port ${port} --strictPort --host 127.0.0.1 --base /preview/s/${session.slug}/`
      : "";

  const final = `${text}${extra}`;

  const windows = process.platform === "win32";
  const shell = windows ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
  const args = windows ? ["/d", "/s", "/c", final] : ["-c", final];

  let child;
  try {
    child = spawn(shell, args, {
      cwd: session.cwd,
      env: childEnv(port),
      // The shell is the file being spawned, so this stays off: turning it on
      // would wrap the command in a second shell and mangle its quoting.
      shell: false,
      windowsHide: true,
      detached: !windows,
      // stdin is open so a command that asks a question can be answered
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    session.status = "error";
    pushLine(session, "err", `Could not start: ${err.message}`);
    return { error: `Could not start: ${err.message}` };
  }

  session.child = child;
  session.status = "running";
  session.label = text;
  session.serverUp = false;
  session.basePrefixed = Boolean(extra);
  session.startedBy = actorName;

  child.stdout.on("data", (chunk) => {
    pushChunk(session, "out", chunk);
    sniffPort(session, stripAnsi(chunk.toString("utf8")));
  });
  child.stderr.on("data", (chunk) => {
    pushChunk(session, "err", chunk);
    // Vite prints its banner on stderr in some versions
    sniffPort(session, stripAnsi(chunk.toString("utf8")));
  });

  child.on("error", (err) => {
    pushLine(session, "err", `Could not start: ${err.message}`);
    session.status = "error";
    clearTimers(session);
  });

  child.on("exit", (code, signal) => {
    clearTimers(session);
    session.serverUp = false;
    if (session.status === "stopped") return;

    session.status = code === 0 ? "finished" : "error";
    pushLine(
      session,
      code === 0 ? "system" : "err",
      signal ? `Ended (${signal})` : `Ended with exit code ${code}`
    );
  });

  /**
   * A ceiling rather than a guess at intent. A dev server is meant to keep
   * running, so it cannot be a short timeout; a command that hangs still has
   * to end eventually, so it cannot be none.
   */
  session.idle = setTimeout(() => {
    pushLine(session, "system", `Stopped after ${IDLE_MS / 3600000} hours`);
    stop(project._id, session.id);
  }, IDLE_MS);

  return { started: true, session: describeSession(session, root) };
};

/* -------------------------------------------------------------------- input */

/**
 * Answer a command that asked something — an npm prompt, a confirmation. A
 * terminal that can only talk and never listen stalls on the first question.
 */
export const sendInput = (project, sessionId, text) => {
  const session = getSession(project, sessionId);

  if (!session || session.status !== "running" || !session.child?.stdin?.writable) {
    return { sent: false, error: "Nothing is running in this terminal" };
  }

  const line = String(text ?? "").slice(0, MAX_LINE_LENGTH);
  pushLine(session, "cmd", line);
  session.child.stdin.write(`${line}\n`);

  return { sent: true };
};

/* ------------------------------------------------------------------ reading */

export const statusOf = (project, sessionId) => {
  const root = workspaceDir(project._id);
  const session = getSession(project, sessionId);

  return session && root
    ? describeSession(session, root)
    : { id: null, status: "idle", label: "", port: null, serverUp: false, cwd: ".", lines: 0 };
};

/** Output after `since`, so the terminal only ever fetches what is new. */
export const logsSince = (project, sessionId, since = 0) => {
  const root = workspaceDir(project._id);
  const session = getSession(project, sessionId);

  if (!session || !root) return { lines: [], next: 0, status: statusOf(project, sessionId) };

  const from = Number(since) || 0;
  return {
    lines: session.logs.filter((line) => line.n > from),
    next: session.nextLine - 1,
    status: describeSession(session, root),
  };
};

/* --------------------------------------------------------------- previews */

/**
 * A session of this project currently serving.
 *
 * One told to serve under our prefix wins: with a backend and a frontend both
 * up, the frontend is the one worth showing, and it is the one that was given
 * a --base to match.
 */
const servingSession = (projectId) => {
  const up = [...sessionsOf(projectId).values()].filter(
    (s) => s.status === "running" && s.serverUp
  );
  return up.find((s) => s.basePrefixed) || up[up.length - 1] || null;
};

export const serverPortOf = (projectId) => servingSession(projectId)?.port || null;

/** The slug a preview is served under, or null when nothing carries our base. */
export const slugOf = (projectId) => {
  const session = servingSession(projectId);
  return session?.basePrefixed ? session.slug : null;
};

/**
 * The running session reachable at this preview slug, if any.
 *
 * The slug is a capability: it appears in URLs the previewed page itself
 * emits, so it reaches only a browser that already loaded that page through
 * the token check. It lives as long as the session does and no longer.
 */
export const findBySlug = (slug) => {
  if (!slug || !/^[a-f0-9]{32}$/i.test(String(slug))) return null;

  for (const session of everySession()) {
    if (session.slug === slug && session.status === "running" && session.serverUp) {
      return { port: session.port };
    }
  }
  return null;
};

/* -------------------------------------------------------------- housekeeping */

export const stopAll = async () => {
  for (const projectId of projects.keys()) await stop(projectId);
};

/** Everything for one project, for when the project itself is being deleted. */
export const stopProject = async (projectId) => {
  await stop(projectId);
  projects.delete(String(projectId));
};

/**
 * A dev server left holding a port after this app goes down is a process
 * nobody will find without going looking for it.
 */
["SIGINT", "SIGTERM"].forEach((signal) =>
  process.once(signal, () => {
    stopAll().finally(() => process.exit(0));
  })
);

process.once("exit", () => {
  for (const session of everySession()) killTree(session);
});
