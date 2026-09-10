/**
 * Open the reporting-chain screens in a real browser and look at them.
 *
 * A clean build proves the code parses; the suites prove the server answers.
 * Neither opens a page, and the ordinary failure for a screen wired to a new
 * endpoint is reading `.map` off something the server did not send — which
 * throws at render and leaves a blank panel. That only shows up in a browser.
 *
 * Four panels render the same two components, so the thing worth checking is
 * that each one is reachable from its own sidebar, renders with the data that
 * panel is actually allowed, and does not throw.
 *
 * Chrome is driven over the DevTools protocol directly — it is already on this
 * machine, and Playwright is a few hundred megabytes for one WebSocket.
 *
 *   node _driveReporting.mjs <appUrl>
 *
 * Accounts come from the environment, each optional:
 *   ADMIN_EMAIL / ADMIN_PASSWORD          (from .env)
 *   HR_PANEL_EMAIL / HR_PANEL_PASSWORD
 *   LEADER_EMAIL / LEADER_PASSWORD
 *   EMPLOYEE_EMAIL / EMPLOYEE_PASSWORD
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-rep-"));
const PORT = 9334;

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
    "--window-size=1440,1000",
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
  await sleep(2600);
};

const shoot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
};

const results = [];
const record = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

/**
 * Every entry the sidebar offers, by its label. Reading the anchors alone
 * undercounts: a collapsible group is a <button> and its children are not in
 * the DOM until it is opened.
 */
const NAV_ENTRIES = `
  Array.from(document.querySelectorAll('aside nav a, aside nav button'))
    .map(el => el.textContent.trim())
    .filter(Boolean)
`;

const signIn = async (loginPath, email, password, tokenKey) => {
  /**
   * The page has to be on the app's own origin before its storage can be
   * touched at all — about:blank has none, and clearing it first throws a
   * SecurityError rather than doing nothing. So: land on the login page, drop
   * whoever was signed in before, then land on it again clean.
   */
  await goto(`${APP}${loginPath}`);
  await evaluate(`localStorage.clear()`);
  await goto(`${APP}${loginPath}`);
  await evaluate(`
    (() => {
      const set = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const email = document.querySelector('input[type=email]')
        || document.querySelector('input[name=email]');
      const password = document.querySelector('input[type=password]');
      if (!email || !password) return false;
      set(email, ${JSON.stringify(email)});
      set(password, ${JSON.stringify(password)});
      document.querySelector('form').requestSubmit();
      return true;
    })()
  `);
  await sleep(3500);
  return evaluate(`Boolean(localStorage.getItem(${JSON.stringify(tokenKey)}))`);
};

/** Open one route and say whether a person would see anything on it. */
const visit = async (name, route, expectedHeading) => {
  const before = pageErrors.length;
  await goto(`${APP}${route}`);

  const state = await evaluate(`
    (() => {
      const root = document.getElementById('root');
      const text = (root?.innerText || '').trim();
      /**
       * The sidebar is inside #root too, and it is the same on every page —
       * so reading the whole root and looking at the first 160 characters
       * reads the navigation, not the screen. The body field is the main region
       * alone, which is what somebody actually came to the page for.
       */
      const main = document.querySelector('main');
      return {
        heading: document.querySelector('h1')?.textContent?.trim() || '',
        blank: text.length < 40,
        head: text.slice(0, 160),
        body: ((main?.innerText || text).trim()).slice(0, 300),
      };
    })()
  `);

  const threw = pageErrors.length > before;
  const ok =
    !threw && !state.blank && (!expectedHeading || state.heading.includes(expectedHeading));

  record(
    `${route} renders`,
    ok,
    threw
      ? `threw: ${pageErrors[pageErrors.length - 1]?.slice(0, 160)}`
      : state.blank
        ? "rendered blank"
        : expectedHeading && !state.heading.includes(expectedHeading)
          ? `heading was "${state.heading}"`
          : `“${state.heading}”`
  );

  await shoot(name);
  return state;
};

const run = async () => {
  socket = await connect(await findTarget());
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  /* ------------------------------------------------------------- the admin */

  console.log("\n▸ Admin");

  const adminIn = await signIn(
    "/admin/login",
    process.env.ADMIN_EMAIL,
    process.env.ADMIN_PASSWORD,
    "adminToken"
  );
  record("the admin signs in", adminIn);

  if (adminIn) {
    await goto(`${APP}/admin/dashboard`);
    const nav = await evaluate(NAV_ENTRIES);
    record(
      "the sidebar offers Report Chain and Departments",
      nav.includes("Report Chain") && nav.includes("Departments"),
      nav.filter((n) => /Report|Department/i.test(n)).join(" · ") || "neither found"
    );

    const chain = await visit("admin-report-chain", "/admin/reports/chain", "Report Chain");
    record(
      "the admin's chain page shows the inbox rather than an empty shell",
      /Inbox|Sent|Nothing|Report/i.test(chain.body),
      chain.body.slice(0, 110).replace(/s+/g, " ")
    );

    const depts = await visit("admin-departments", "/admin/departments", "Departments");
    record(
      "and the departments page names the chain it is drawing",
      /Team Member|Departments|Teams/i.test(depts.body),
      depts.body.slice(0, 110).replace(/s+/g, " ")
    );

    // Nothing regressed on the analytics page the chain sits beside
    await visit("admin-reports", "/admin/reports", "");
  }

  /* ---------------------------------------------------------------- the HR */

  if (process.env.HR_PANEL_EMAIL && process.env.HR_PANEL_PASSWORD) {
    console.log("\n▸ HR");

    const hrIn = await signIn(
      "/hr/login",
      process.env.HR_PANEL_EMAIL,
      process.env.HR_PANEL_PASSWORD,
      "hrToken"
    );
    record("HR signs in", hrIn);

    if (hrIn) {
      await goto(`${APP}/hr/dashboard`);
      const nav = await evaluate(NAV_ENTRIES);
      record(
        "HR's sidebar offers Report Chain and Departments",
        nav.includes("Report Chain") && nav.includes("Departments"),
        nav.filter((n) => /Report|Department/i.test(n)).join(" · ") || "neither found"
      );

      await visit("hr-report-chain", "/hr/report-chain", "Report Chain");
      await visit("hr-departments", "/hr/departments", "Departments");
      // The analytics page that was rewritten after being clobbered
      await visit("hr-reports", "/hr/reports", "HR Reports");
    }
  } else {
    console.log("\n▸ HR — skipped, no HR_PANEL_EMAIL set");
  }

  /* ------------------------------------------------------------ the leader */

  if (process.env.LEADER_EMAIL && process.env.LEADER_PASSWORD) {
    console.log("\n▸ Operations Manager");

    const leaderIn = await signIn(
      "/operation-manager/login",
      process.env.LEADER_EMAIL,
      process.env.LEADER_PASSWORD,
      "leaderToken"
    );
    record("the operations manager signs in", leaderIn);

    if (leaderIn) {
      await goto(`${APP}/operation-manager/dashboard`);
      const nav = await evaluate(NAV_ENTRIES);
      record(
        "their sidebar offers Report Chain",
        nav.includes("Report Chain"),
        nav.filter((n) => /Report/i.test(n)).join(" · ") || "not found"
      );

      await visit("leader-report-chain", "/operation-manager/report-chain", "Report Chain");
      // The page that already existed under the same name, restored from git
      await visit("leader-reports", "/operation-manager/reports", "");
      // Department task assignment lives here
      await visit("leader-create-task", "/operation-manager/tasks/create", "");
    }
  } else {
    console.log("\n▸ Operations Manager — skipped, no LEADER_EMAIL set");
  }

  /* ---------------------------------------------------------- the employee */

  if (process.env.EMPLOYEE_EMAIL && process.env.EMPLOYEE_PASSWORD) {
    console.log("\n▸ Employee");

    const empIn = await signIn(
      "/employee/login",
      process.env.EMPLOYEE_EMAIL,
      process.env.EMPLOYEE_PASSWORD,
      "employeeToken"
    );
    record("the employee signs in", empIn);

    if (empIn) {
      await goto(`${APP}/employee/dashboard`);
      const nav = await evaluate(NAV_ENTRIES);
      record(
        "their sidebar offers My Reports",
        nav.includes("My Reports"),
        nav.filter((n) => /Report/i.test(n)).join(" · ") || "not found"
      );

      await visit("employee-reports", "/employee/reports", "");
    }
  } else {
    console.log("\n▸ Employee — skipped, no EMPLOYEE_EMAIL set");
  }

  /* ------------------------------------------------------------------ done */

  const failed = results.filter((r) => !r.ok);
  console.log("\n" + "─".repeat(60));
  console.log(`  ${results.length - failed.length} passed, ${failed.length} failed`);
  console.log(`  screenshots in ${SHOTS}`);
  console.log("─".repeat(60) + "\n");

  if (pageErrors.length) {
    console.log("Page errors seen:");
    [...new Set(pageErrors)].slice(0, 12).forEach((e) => console.log("  · " + e.slice(0, 200)));
    console.log();
  }

  chrome.kill();
  process.exit(failed.length ? 1 : 0);
};

run().catch((err) => {
  console.error("\nDriver crashed:", err);
  chrome.kill();
  process.exit(1);
});
