/**
 * Drive the admin panel in a real browser and look at what renders.
 *
 * A clean `vite build` proves the code parses and a lint pass proves it is
 * tidy. Neither of them opens a page — and the failure this is here to catch
 * is the ordinary one for a screen wired to a new endpoint: reading `.map` off
 * something the server did not send, which throws at render and shows a blank
 * panel. That only happens in a browser.
 *
 * Chrome is driven over the DevTools protocol directly rather than through
 * Playwright, because Chrome is already on this machine and Playwright is a
 * few hundred megabytes to install for one WebSocket.
 *
 *   node _driveAdminPanel.mjs <appUrl> <email> <password>
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const APP = process.argv[2] || "http://localhost:5199";
const EMAIL = process.argv[3];
const PASSWORD = process.argv[4];

const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SHOTS = path.join(process.cwd(), "_shots");
fs.mkdirSync(SHOTS, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-"));
const PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------ the browser */

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

/** Chrome takes a moment to open the debugging port. */
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

/* ---------------------------------------------------------------- the wire */

let seq = 0;
const pending = new Map();
const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];

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

      // Anything the page complains about, kept for the report
      if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
        consoleErrors.push(
          msg.params.args.map((a) => a.value ?? a.description ?? a.type).join(" ")
        );
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params.exceptionDetails;
        pageErrors.push(d.exception?.description || d.text);
      }
      if (msg.method === "Network.responseReceived" && msg.params.response.status >= 400) {
        failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
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

/** Run an expression in the page and return its value. */
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
  await sleep(2500);
};

const shoot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const file = path.join(SHOTS, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  return file;
};

/* ------------------------------------------------------------------- run */

/**
 * Every entry the sidebar offers, by its label.
 *
 * Reading the anchors alone undercounts badly: a collapsible group renders as
 * a <button> and its children are not in the DOM at all until it is opened.
 * What matters is what a person is offered, and that is the labels.
 */
const NAV_ENTRIES = `
  Array.from(document.querySelectorAll('aside nav a, aside nav button'))
    .map(el => el.textContent.trim())
    .filter(Boolean)
`;

const results = [];
const record = (label, ok, detail = "") => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
};

const run = async () => {
  socket = await connect(await findTarget());

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  /* ------------------------------------------------------------ sign in */

  await goto(`${APP}/admin/login`);

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
      set(email, ${JSON.stringify(EMAIL)});
      set(password, ${JSON.stringify(PASSWORD)});
      document.querySelector('form').requestSubmit();
      return true;
    })()
  `);
  await sleep(3500);

  const signedIn = await evaluate(`Boolean(localStorage.getItem('adminToken'))`);
  record("admin signs in through the panel", signedIn);
  if (!signedIn) {
    const body = await evaluate(`document.body.innerText.slice(0, 300)`);
    record("login page said", false, body);
    return;
  }

  /* --------------------------------------------------- the sidebar itself */

  await goto(`${APP}/admin/dashboard`);

  const sections = await evaluate(`
    Array.from(document.querySelectorAll('aside p'))
      .map(el => el.textContent.trim())
      .filter(t => /^(HUMAN RESOURCES|SALES|OPERATIONS|MARKETING & DELIVERY|COMPANY|ADMINISTRATION)$/i.test(t))
  `);
  record(
    "the sidebar is organised into sections",
    sections.length >= 5,
    sections.join(" · ") || "none found"
  );

  // What an admin is offered, to compare a department account against below
  const adminNav = await evaluate(NAV_ENTRIES);
  record("the admin is offered the whole panel", adminNav.length >= 25, `${adminNav.length} entries`);
  record(
    "including the two screens only an administrator may open",
    adminNav.includes("Department Accounts") && adminNav.includes("Roles & Permissions")
  );


  /* ------------------------------------------------------------ the pages */

  // A client to open the 360 on
  const clientId = await evaluate(`
    fetch('http://localhost:5099/api/admin/clients?limit=1', {
      headers: { Authorization: 'Bearer ' + localStorage.getItem('adminToken') }
    }).then(r => r.json()).then(d => d.items?.[0]?._id || '')
  `);

  const PAGES = [
    ["hr-overview", "/admin/hr", "HR Overview"],
    ["hr-leaves", "/admin/hr/leave", "Leave Requests"],
    ["hr-balances", "/admin/hr/leave/balances", "Leave Balances"],
    ["hr-policies", "/admin/hr/leave/policies", "Leave Policies"],
    ["hr-recruitment", "/admin/hr/recruitment", "Recruitment"],
    ["hr-accounts", "/admin/hr/accounts", "HR Accounts"],
    ["department-accounts", "/admin/department-accounts", "Department Accounts"],
    ["follow-ups", "/admin/crm/follow-ups", "Follow-ups"],
    ["handover-queue", "/admin/clients/handover", "Handover Queue"],
    ...(clientId ? [["client-360", `/admin/clients/${clientId}`, ""]] : []),
    // A few that already existed, to prove nothing regressed
    ["existing-clients", "/admin/clients", "All Clients"],
    ["existing-projects", "/admin/projects", "All Projects"],
    ["existing-employees", "/admin/employees", "All Employees"],
    ["existing-leads", "/admin/crm/leads", ""],
  ];

  for (const [name, route, expected] of PAGES) {
    const before = pageErrors.length;
    await goto(`${APP}${route}`);

    const state = await evaluate(`
      (() => {
        const root = document.getElementById('root');
        const text = (root?.innerText || '').trim();
        return {
          chars: text.length,
          heading: document.querySelector('h1')?.textContent?.trim() || '',
          // React's error boundary / a blown render leaves an empty root
          blank: text.length < 40,
          head: text.slice(0, 120),
        };
      })()
    `);

    const threw = pageErrors.length > before;
    const ok = !threw && !state.blank && (!expected || state.heading.includes(expected));

    record(
      `${route} renders`,
      ok,
      threw
        ? `threw: ${pageErrors[pageErrors.length - 1]?.slice(0, 140)}`
        : state.blank
          ? "rendered blank"
          : expected && !state.heading.includes(expected)
            ? `heading was "${state.heading}"`
            : `“${state.heading}”`
    );

    await shoot(name);
  }

  /* ---------------------------------------- the panel as a department head */

  /**
   * The same panel, signed in as HR. This is the check that matters: the
   * sidebar has to narrow to HR's own work, and the screens HR may not reach
   * have to refuse rather than render.
   */
  if (process.env.HR_EMAIL && process.env.HR_PASSWORD) {
    console.log("\n  — as an HR department account —");

    await evaluate(`localStorage.clear()`);
    await goto(`${APP}/admin/login`);
    await evaluate(`
      (() => {
        const set = (el, value) => {
          const proto = Object.getPrototypeOf(el);
          Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        set(document.querySelector('input[type=email]'), ${JSON.stringify(process.env.HR_EMAIL)});
        set(document.querySelector('input[type=password]'), ${JSON.stringify(process.env.HR_PASSWORD)});
        document.querySelector('form').requestSubmit();
      })()
    `);
    await sleep(3500);

    record("an HR account signs in to the same panel", await evaluate(`Boolean(localStorage.getItem('adminToken'))`));

    await goto(`${APP}/admin/hr`);

    const hrNav = await evaluate(NAV_ENTRIES);

    record(
      "the sidebar narrows to their department",
      hrNav.length > 0 && hrNav.length < adminNav.length,
      `${hrNav.length} entries, against the admin's ${adminNav.length}`
    );
    record(
      "HR is offered its own work",
      ["HR Overview", "Leave", "Recruitment", "Attendance"].every((entry) =>
        hrNav.includes(entry)
      ),
      hrNav.join(" · ")
    );
    record(
      "but not the screen that creates HR logins",
      !hrNav.includes("HR Accounts")
    );

    // And typing that one by hand is refused too, not merely un-offered
    await goto(`${APP}/admin/hr/accounts`);
    const accountsRefused = await evaluate(`
      (document.querySelector('main')?.innerText || '').toLowerCase()
    `);
    const accountRows = await evaluate(`document.querySelectorAll('main table tbody tr').length`);
    record(
      "a hand-typed /admin/hr/accounts is refused",
      /only an administrator|does not allow|not allowed|permission/.test(accountsRefused) &&
        accountRows === 0,
      `${accountRows} rows · ${accountsRefused.replace(/\s+/g, " ").slice(0, 80)}`
    );
    record(
      "and is not offered Sales, the vault, the ads or the settings",
      !["Pipeline", "Clients", "Vault", "Ads", "Settings", "Our Portfolio"].some((entry) =>
        hrNav.includes(entry)
      )
    );
    record(
      "nor the two screens only an administrator may open",
      !hrNav.includes("Department Accounts") && !hrNav.includes("Roles & Permissions")
    );

    const brand = await evaluate(`document.querySelector('aside p + p')?.textContent?.trim() || ''`);
    record("the panel names their department", /human resources/i.test(brand), brand);

    await shoot("hr-account-panel");

    // Typing the URL by hand must be refused too, not merely un-offered
    await goto(`${APP}/admin/crm/leads`);

    /**
     * Read the page's own region, not `#root` — the sidebar is inside root and
     * its labels would satisfy almost any keyword, so matching against the
     * whole tree would pass whether or not anything was actually refused.
     */
    const refused = await evaluate(`
      (document.querySelector('main')?.innerText || document.getElementById('root')?.innerText || '')
        .toLowerCase()
    `);
    const leadRows = await evaluate(`document.querySelectorAll('main table tbody tr').length`);

    record(
      "a hand-typed URL into another department is refused",
      /does not allow|not allowed|forbidden|permission/.test(refused),
      refused.replace(/\s+/g, " ").slice(0, 110)
    );
    record("and no data from it reaches the page", leadRows === 0, `${leadRows} rows rendered`);
    await shoot("hr-account-refused");
  }

  /* ------------------------------------------------------------ the noise */

  const realErrors = consoleErrors.filter(
    (e) =>
      !/favicon|manifest|sw\.js|workbox|Download the React DevTools/i.test(e) &&
      // 403s are the point of the permission system, not a fault
      !/403/.test(e)
  );

  record("no unhandled exceptions in any page", pageErrors.length === 0, pageErrors[0]?.slice(0, 160));
  record(
    "no console errors beyond the expected",
    realErrors.length === 0,
    realErrors.slice(0, 2).join(" | ").slice(0, 200)
  );

  const badApi = failedRequests.filter((r) => r.includes("/api/") && !r.startsWith("403"));
  record("no API request failed", badApi.length === 0, badApi.slice(0, 3).join(" | "));
};

run()
  .catch((err) => {
    console.error("\n💥 " + (err?.stack || err));
    results.push({ label: "driver", ok: false, detail: err.message });
  })
  .finally(async () => {
    try {
      socket?.close();
    } catch {
      /* already gone */
    }
    chrome.kill();

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${results.length - failed.length} passed, ${failed.length} failed`);
    console.log(`  screenshots in ${SHOTS}`);
    console.log(`${"─".repeat(60)}\n`);
    process.exit(failed.length ? 1 : 0);
  });
