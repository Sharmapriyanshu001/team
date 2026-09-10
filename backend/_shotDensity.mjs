/**
 * Look at the density change, rather than trusting that it happened.
 *
 * A build proves the classes parse. It does not say whether a page still reads
 * well once a step of padding has come out of every card, table row and page
 * header — and the whole point of the change was how it looks. So this signs
 * in, opens the screens with the most chrome on them, and writes a screenshot
 * plus the measured height of the content each one renders.
 *
 * Chrome over the DevTools protocol, mirroring _driveAdminPanel.mjs — see the
 * note at the top of that file for why not Playwright.
 *
 *   node _shotDensity.mjs <appUrl> <email> <password>
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const APP = process.argv[2] || "http://localhost:5173";
const EMAIL = process.argv[3];
const PASSWORD = process.argv[4];

const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const SHOTS = path.join(process.cwd(), "_shots");
fs.mkdirSync(SHOTS, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-density-"));
const PORT = 9337;

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
  await sleep(5000);
};

const shoot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, "base64"));
};

/**
 * What the page actually costs in height, and how much of that is chrome.
 *
 * `main` height is the number the change is trying to move. The rest says
 * where it went: the padding on a card header, the height of a table row, and
 * the width the widest column leaves unused — which is the complaint that
 * started this, on the attendance sheet with two columns in a wide card.
 */
const MEASURE = `
  (() => {
    const main = document.querySelector('main');
    const row = document.querySelector('table tbody tr');
    const head = document.querySelector('table thead th');
    const table = document.querySelector('table');
    const lastCell = document.querySelector('table tbody tr td:last-child');
    return {
      mainHeight: main ? Math.round(main.scrollHeight) : null,
      rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
      headHeight: head ? Math.round(head.getBoundingClientRect().height) : null,
      columns: document.querySelectorAll('table thead th').length || null,
      /** Empty pixels to the right of the last column's content. */
      deadWidth:
        table && lastCell
          ? Math.round(
              table.getBoundingClientRect().right - lastCell.getBoundingClientRect().right
            )
          : null,
    };
  })()
`;

const PAGES = (process.env.SHOT_PAGES
  ? process.env.SHOT_PAGES.split(",").map((p) => [p.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, ""), p])
  : [
      ["attendance", "/admin/employees/attendance"],
      ["hr-overview", "/admin/hr"],
      ["all-employees", "/admin/employees"],
      ["departments", "/admin/departments"],
    ]);

const run = async () => {
  socket = await connect(await findTarget());
  await send("Page.enable");
  await send("Runtime.enable");

  await goto(`${APP}/admin/login`);
  await sleep(4000);
  await evaluate(`
    (() => {
      const set = (el, value) => {
        const proto = Object.getPrototypeOf(el);
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set(document.querySelector('input[type=email]') || document.querySelector('input[name=email]'), ${JSON.stringify(EMAIL)});
      set(document.querySelector('input[type=password]'), ${JSON.stringify(PASSWORD)});
      document.querySelector('form').requestSubmit();
      return true;
    })()
  `);
  await sleep(3500);

  if (!(await evaluate(`Boolean(localStorage.getItem('adminToken'))`))) {
    throw new Error("could not sign in — check the email and password");
  }
  console.log("signed in\n");

  for (const [name, route] of PAGES) {
    await goto(`${APP}${route}`);
    await shoot(name);
    const m = await evaluate(MEASURE);
    console.log(
      `${name.padEnd(14)} main ${String(m.mainHeight).padStart(5)}px` +
        (m.rowHeight ? `  row ${m.rowHeight}px  header ${m.headHeight}px` : "  (no table)") +
        (m.columns ? `  cols ${m.columns}` : "") +
        (m.deadWidth !== null ? `  unused right ${m.deadWidth}px` : "")
    );
  }

  if (pageErrors.length) {
    console.log("\nPage errors:");
    pageErrors.slice(0, 5).forEach((e) => console.log("  " + e.split("\n")[0]));
  } else {
    console.log("\nNo page errors.");
  }

  console.log(`\nScreenshots in ${SHOTS}`);
};

run()
  .catch((err) => {
    console.error("drive failed:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      socket?.close();
    } catch {}
    chrome.kill();
    await sleep(400);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  });
