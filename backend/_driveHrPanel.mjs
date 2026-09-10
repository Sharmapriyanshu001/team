/**
 * Drive the HR panel in a real browser and look at what renders.
 *
 * A clean build proves the code parses. It does not open a page, and the
 * failure worth catching here is the ordinary one for a screen wired to a new
 * endpoint: reading `.map` off something the server did not send, which throws
 * at render and shows a blank panel.
 *
 * Chrome over the DevTools protocol rather than Playwright, because Chrome is
 * already on this machine — see _driveAdminPanel.mjs, which this mirrors.
 *
 *   node _driveHrPanel.mjs <appUrl> <headEmail> <headPassword>
 *
 * With HR_MGR_EMAIL / HR_MGR_PASSWORD in the environment it also signs in as
 * an HR Manager and checks the sidebar narrows.
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-hr-"));
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
      const page = (await res.json()).find((t) => t.type === "page");
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
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
};

const signIn = async (email, password) => {
  /**
   * The page has to be on the app's own origin before localStorage can be
   * touched at all — Chrome starts on about:blank, which has an opaque origin
   * and throws on the very first read. So: navigate, then clear, then
   * navigate again so the app boots with no session already in hand.
   */
  await goto(`${APP}/hr/login`);
  await evaluate("localStorage.clear()");
  await goto(`${APP}/hr/login`);

  await evaluate(`
    (() => {
      const set = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[type=email]'), ${JSON.stringify(email)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(password)});
      document.querySelector('form').requestSubmit();
    })()
  `);
  await sleep(3500);
  return evaluate("Boolean(localStorage.getItem('hrToken'))");
};

/** Every entry the sidebar offers — a collapsed group is a button, not a link. */
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

  /* --------------------------------------------------------- the HR head */

  console.log("\n  — as the HR head —");

  record("the HR head signs in", await signIn(EMAIL, PASSWORD));

  await goto(`${APP}/hr/dashboard`);

  const brand = await evaluate(`document.querySelector('aside p + p')?.textContent?.trim() || ''`);
  record("the panel names them the HR head", /hr head/i.test(brand), brand);

  const headNav = await evaluate(NAV_ENTRIES);
  record(
    "every HR section is offered",
    ["Dashboard", "Employees", "HR Managers", "Documents", "Attendance", "Leave", "Hiring", "Reports", "Settings"].every(
      (entry) => headNav.includes(entry)
    ),
    headNav.join(" · ")
  );

  const PAGES = [
    ["hr-dashboard", "/hr/dashboard", "HR Dashboard"],
    ["hr-employees", "/hr/employees", "Employees"],
    ["hr-managers", "/hr/managers", "HR Managers"],
    ["hr-documents", "/hr/documents", "Documents"],
    ["hr-attendance", "/hr/attendance", "Attendance"],
    ["hr-leave", "/hr/leave", "Leave Requests"],
    ["hr-leave-balances", "/hr/leave/balances", "Leave Balances"],
    ["hr-leave-policies", "/hr/leave/policies", "Leave Policies"],
    ["hiring-dashboard", "/hr/hiring/dashboard", "Hiring Dashboard"],
    ["hiring-openings", "/hr/hiring/openings", "Job Openings"],
    ["hiring-candidates", "/hr/hiring/candidates", "Candidates"],
    ["hiring-interviews", "/hr/hiring/interviews", "Interviews"],
    ["hiring-shortlisted", "/hr/hiring/shortlisted", "Shortlisted"],
    ["hiring-selected", "/hr/hiring/selected", "Selected"],
    ["hiring-rejected", "/hr/hiring/rejected", "Rejected"],
    ["hiring-onboarding", "/hr/hiring/onboarding", "Onboarding"],
    ["hr-reports", "/hr/reports", "HR Reports"],
    ["hr-settings", "/hr/settings", "Settings"],
    ["hr-profile", "/hr/profile", "Profile"],
  ];

  for (const [name, route, expected] of PAGES) {
    const before = pageErrors.length;
    await goto(`${APP}${route}`);

    const state = await evaluate(`
      (() => {
        const root = document.getElementById('root');
        const text = (root?.innerText || '').trim();
        return {
          heading: document.querySelector('h1')?.textContent?.trim() || '',
          blank: text.length < 40,
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

  /* ------------------------------------------------------ an HR Manager */

  if (process.env.HR_MGR_EMAIL && process.env.HR_MGR_PASSWORD) {
    console.log("\n  — as an HR Manager —");

    record(
      "an HR Manager signs in",
      await signIn(process.env.HR_MGR_EMAIL, process.env.HR_MGR_PASSWORD)
    );

    await goto(`${APP}/hr/dashboard`);

    const mgrBrand = await evaluate(
      `document.querySelector('aside p + p')?.textContent?.trim() || ''`
    );
    record("the panel names them an HR Manager", /hr manager/i.test(mgrBrand), mgrBrand);

    const mgrNav = await evaluate(NAV_ENTRIES);
    record(
      "the sidebar drops HR Managers and keeps the rest",
      !mgrNav.includes("HR Managers") &&
        ["Dashboard", "Employees", "Leave", "Hiring", "Reports"].every((e) => mgrNav.includes(e)),
      mgrNav.join(" · ")
    );
    record(
      "and is smaller than the head's",
      mgrNav.length < headNav.length,
      `${mgrNav.length} against ${headNav.length}`
    );

    // Typing it by hand must be refused too, not merely un-offered
    await goto(`${APP}/hr/managers`);
    const refused = await evaluate(
      `(document.querySelector('main')?.innerText || '').toLowerCase()`
    );
    const rows = await evaluate(`document.querySelectorAll('main table tbody tr').length`);
    record(
      "a hand-typed /hr/managers is refused",
      /only the hr head|does not allow|not allowed/.test(refused) && rows === 0,
      `${rows} rows · ${refused.replace(/\s+/g, " ").slice(0, 90)}`
    );
    await shoot("hr-manager-refused");
  }

  /* ------------------------------------------------------------ the noise */

  const realErrors = consoleErrors.filter(
    (e) => !/favicon|manifest|sw\.js|workbox|React DevTools/i.test(e) && !/403/.test(e)
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
