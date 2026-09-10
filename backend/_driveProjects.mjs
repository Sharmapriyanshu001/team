/**
 * Open the admin's project screens in a real browser and actually assign
 * somebody.
 *
 * The suite proves the server does the right thing when asked. This proves
 * the admin can ask — that the button is there, the editor opens on the right
 * project, a person can be added without leaving the page, and the two
 * progress figures are put in front of somebody rather than merely returned
 * in JSON.
 *
 *   node _driveProjects.mjs <appUrl>
 *
 * Reads ADMIN_EMAIL / ADMIN_PASSWORD from .env.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const APP = process.argv[2] || "http://localhost:5199";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SHOTS = path.join(process.cwd(), "_shots");
fs.mkdirSync(SHOTS, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-proj-"));
const PORT = 9335;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "--window-size=1440,1100",
    "about:blank",
  ],
  { stdio: "ignore" }
);

const findTarget = async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error("Chrome never opened its debugging port");
};

let seq = 0;
const pending = new Map();
const pageErrors = [];

const connect = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error(`socket: ${e.message || "failed"}`));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: done, reject: fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(msg.error.message));
        else done(msg.result);
        return;
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        pageErrors.push(d.exception?.description || d.text);
      }
    };
  });

let socket;
const send = (method, params = {}) => {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }
    }, 30000);
  });
};

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || "eval failed");
  return result.value;
};

const goto = async (url) => {
  await send("Page.navigate", { url });
  await sleep(2800);
};

const shoot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
};

const results = [];
const record = (label, ok, detail = "") => {
  results.push({ ok });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

/** Click the first element whose text matches, and say whether one was found. */
const clickText = async (selector, pattern) =>
  evaluate(`
    (() => {
      const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
        .find(e => new RegExp(${JSON.stringify(pattern)}, 'i').test(e.textContent || e.title || ''));
      if (!el) return false;
      el.click();
      return true;
    })()
  `);

const bodyText = () => evaluate(`(document.querySelector('main')?.innerText || '').trim()`);

const run = async () => {
  socket = await connect(await findTarget());
  await send("Page.enable");
  await send("Runtime.enable");

  /* ------------------------------------------------------------- sign in */

  console.log("\n▸ The All Projects list");

  await goto(`${APP}/admin/login`);
  await evaluate(`localStorage.clear()`);
  await goto(`${APP}/admin/login`);
  await evaluate(`
    (() => {
      const set = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[type=email]'), ${JSON.stringify(process.env.ADMIN_EMAIL)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(process.env.ADMIN_PASSWORD)});
      document.querySelector('form').requestSubmit();
    })()
  `);
  await sleep(3500);
  record("the admin signs in", await evaluate(`Boolean(localStorage.getItem('adminToken'))`));

  await goto(`${APP}/admin/projects`);
  const list = await bodyText();
  record("the project list renders", list.length > 60 && /Projects/i.test(list));
  record(
    "and every row says who is on the project, not just who leads it",
    /member|nobody on it/i.test(list),
    (list.match(/\d+ members?|nobody on it/i) || ["not found"])[0]
  );

  const assignButtons = await evaluate(`
    document.querySelectorAll('button[title*="ssign" i], button[title*="dd or remove" i]').length
  `);
  record("each row offers an assign button", assignButtons > 0, `${assignButtons} found`);
  await shoot("projects-list");

  /* -------------------------------------------------- the drawer, on team */

  console.log("\n▸ Assigning from the list");

  const opened = await evaluate(`
    (() => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      // Prefer a project that has a progress bar reading something other than
      // zero, which is where the recorded and actual figures are most likely
      // to have drifted apart
      const target =
        rows.find(r => {
          const bar = r.querySelector('[style*="width"]');
          const pct = parseInt((bar?.style?.width || '0'), 10);
          return pct > 0 && pct < 100;
        }) || rows[0];
      const btn = target?.querySelector('button[title*="ssign" i], button[title*="dd or remove" i]');
      if (!btn) return false;
      btn.click();
      return true;
    })()
  `);
  record("the assign button opens something", opened);
  await sleep(2600);

  const drawer = await evaluate(`(document.body.innerText || '')`);
  record(
    "and it opens straight on the team editor rather than making the admin find it",
    /Add somebody/i.test(drawer),
    /Add somebody/i.test(drawer) ? "editor is open" : drawer.slice(0, 120)
  );
  const pickerRows = await evaluate(
    `document.querySelectorAll('div[class*="max-h-52"] button').length`
  );
  record("which lists people who can be added", pickerRows > 0, `${pickerRows} offered`);
  await shoot("project-assign-open");

  // Add the first person offered
  const before = await evaluate(`
    (document.body.innerText.match(/On this project\\s*\\n?\\s*(\\d+)/) || [])[1] || '0'
  `);
  const added = await evaluate(`
    (() => {
      const box = Array.from(document.querySelectorAll('div'))
        .find(d => /Search employees/i.test(d.textContent) && d.querySelector('button svg'));
      const rows = document.querySelectorAll('div[class*="max-h-52"] button');
      if (!rows.length) return false;
      rows[0].click();
      return true;
    })()
  `);
  record("somebody can be added with one click", added);
  await sleep(600);

  const after = await evaluate(`
    (document.body.innerText.match(/On this project\\s*\\n?\\s*(\\d+)/) || [])[1] || '0'
  `);
  record(
    "and the count on the project goes up",
    Number(after) === Number(before) + 1,
    `${before} → ${after}`
  );
  await shoot("project-assign-picked");

  // Cancel rather than save — this is the live database
  const cancelled = await clickText("button", "^cancel$");
  record("the edit can be abandoned without saving", cancelled);
  await sleep(800);

  /* ------------------------------------------------------- the two figures */

  console.log("\n▸ What the drawer says about progress");

  const detail = await evaluate(`(document.body.innerText || '')`);
  record(
    "the drawer shows the recorded figure and what the task board says",
    /Recorded progress/i.test(detail) && /From the task board/i.test(detail),
    /Recorded progress/i.test(detail) ? "both shown" : detail.slice(0, 140)
  );
  record(
    "it names who has done what on the project",
    /Who has done what/i.test(detail)
  );
  record(
    "and says when the project was last touched",
    /Last activity/i.test(detail)
  );

  const disagrees = /These disagree/i.test(detail);
  record(
    disagrees
      ? "a project whose figures disagree is flagged, with a one-click fix offered"
      : "this project's two figures agree, so nothing is flagged",
    disagrees ? /Set recorded progress to/i.test(detail) : true
  );
  await shoot("project-detail-progress");

  /* ------------------------------------------------------------------ done */

  const failed = results.filter((r) => !r.ok).length;
  console.log("\n" + "─".repeat(60));
  console.log(`  ${results.length - failed} passed, ${failed} failed`);
  console.log(`  screenshots in ${SHOTS}`);
  console.log("─".repeat(60) + "\n");

  if (pageErrors.length) {
    console.log("Page errors seen:");
    [...new Set(pageErrors)].slice(0, 8).forEach((e) => console.log("  · " + e.slice(0, 180)));
    console.log();
  }

  chrome.kill();
  process.exit(failed ? 1 : 0);
};

run().catch((err) => {
  console.error("\nDriver crashed:", err);
  chrome.kill();
  process.exit(1);
});
