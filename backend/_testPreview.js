// Phase 6: the preview server. The credential travels in the URL here, so
// this suite is mostly about what a stolen or crafted link must not reach.
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const PORT = process.env.PORT_UNDER_TEST || 5099;
const API = `http://localhost:${PORT}/api`;
// Previews live on their own port, which is where the browser is sent too
const PREVIEW_PORT = Number(process.env.PREVIEW_PORT_UNDER_TEST) || Number(PORT) + 1;
const ORIGIN = `http://localhost:${PREVIEW_PORT}`;

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  ok ? pass++ : fail++;
};

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
  const res = await fetch(API + route, {
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
  const res = await fetch(API + "/admin/code-projects", {
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

/** Raw fetch against the preview server — no headers, exactly like an iframe. */
const preview = async (url) => {
  const res = await fetch(url, { redirect: "manual" });
  const body = await res.text();
  return { status: res.status, body, headers: res.headers };
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
    console.error("Could not sign in");
    process.exit(1);
  }
  const A = admin.data.token;
  const L = leaderLogin.data.token;
  const lookups = await json(A, "GET", "/admin/lookups");
  // The signed-in leader's own id, straight from /me. Reading it out of
  // /admin/lookups was wrong twice over: that list has no email to match on,
  // and its order changes the moment another operations manager exists.
  const leaderId = (await json(L, "GET", "/leader/me")).data?.leader?.id;

  const HELLO = "<!doctype html><html><body><h1>Hello</h1><link rel=stylesheet href=style.css></body></html>";
  const zip = buildZip([
    { name: "index.html", content: HELLO },
    { name: "style.css", content: "h1 { color: rebeccapurple; }" },
    { name: "app.js", content: "console.log('preview')" },
    { name: "sub/page.html", content: "<h1>Sub page</h1>" },
    { name: "secret.env", content: "API_KEY=should-not-be-guessable" },
  ]);

  console.log("=== setup ===");
  const created = await upload(A, zip, {
    filename: "site.zip",
    name: "PHASE6 Preview Test",
    operationsManagers: JSON.stringify(leaderId ? [leaderId] : []),
    canRun: "true",
    canEdit: "true",
  });
  check("project created", created.status === 201, created.data?.message);
  const id = created.data?.item?._id;
  if (!id) {
    console.log(`\n${pass} passed, ${fail + 1} failed`);
    process.exit(1);
  }
  check("detected as static", created.data.item.stack === "static", created.data.item.stack);

  /* ------------------------------------------------------------- the token */

  console.log("\n=== minting a token ===");
  const mint = await json(A, "GET", `/admin/workspace/${id}/preview-token`);
  check("token issued", mint.status === 200, mint.data?.message);
  check("path points at /preview", (mint.data?.path || "").startsWith("/preview/"), mint.data?.path);
  check("marked servable", mint.data?.servable === true);
  const token = mint.data.token;
  const url = `${ORIGIN}${mint.data.path}`;

  const anonMint = await json(null, "GET", `/admin/workspace/${id}/preview-token`);
  check("minting needs a login", anonMint.status === 401);

  /**
   * The preview must not share an origin with the panel or the API. That
   * separation is what lets the iframe keep allow-same-origin — which a real
   * app needs, because an opaque origin has no localStorage and a previewed
   * app cannot even log in without it.
   */
  console.log("\n=== the preview has an origin of its own ===");
  check("the server hands out a full URL", Boolean(mint.data?.url), mint.data?.url?.slice(0, 44));

  const previewOrigin = new URL(mint.data.url).origin;
  check(
    "and it is not the API's origin",
    previewOrigin !== `http://localhost:${PORT}`,
    `${previewOrigin} vs the API on :${PORT}`
  );

  const onApiPort = await fetch(`http://localhost:${PORT}${mint.data.path}`, {
    redirect: "manual",
  });
  check(
    "previews are not served from the API port at all",
    onApiPort.status === 404,
    String(onApiPort.status)
  );

  /* ------------------------------------------------------------- serving */

  console.log("\n=== serving, with no headers at all ===");
  const root = await preview(url);
  check("index.html served", root.status === 200, String(root.status));
  check("it is the real file", root.body === HELLO);
  check("content type is html", root.headers.get("content-type")?.includes("text/html"));
  check("nosniff set", root.headers.get("x-content-type-options") === "nosniff");
  check("never cached", root.headers.get("cache-control") === "no-store");
  check("not indexable", (root.headers.get("x-robots-tag") || "").includes("noindex"));

  const css = await preview(`${url}style.css`);
  check("stylesheet served", css.status === 200 && css.body.includes("rebeccapurple"));
  check("css content type", css.headers.get("content-type")?.includes("text/css"));

  const js = await preview(`${url}app.js`);
  check("script served", js.status === 200 && js.body.includes("preview"));
  check("js content type", js.headers.get("content-type")?.includes("javascript"));

  const sub = await preview(`${url}sub/page.html`);
  check("nested file served", sub.status === 200 && sub.body.includes("Sub page"));

  const subIndex = await preview(`${url}sub/`);
  check("folder with no index 404s", subIndex.status === 404, String(subIndex.status));

  const missing = await preview(`${url}nope.html`);
  check("missing file 404s", missing.status === 404);

  // Both forms must serve rather than redirect — Express treats them as one
  // route, so a redirect between them would loop
  const bare = await preview(`${ORIGIN}/preview/${token}`);
  check("bare token serves the index too", bare.status === 200, String(bare.status));
  check("no redirect loop", bare.status !== 302);

  /* ---------------------------------------------------------------- the jail */

  console.log("\n=== a crafted link must not escape ===");
  const escapes = [
    "../../../.env",
    "../../../../backend/.env",
    "..%2f..%2f..%2f.env",
    "%2e%2e%2f%2e%2e%2f.env",
    "%252e%252e%252f.env",
    "....//....//.env",
    "sub/../../../.env",
    "/etc/passwd",
  ];
  for (const attempt of escapes) {
    const r = await preview(`${url}${attempt}`);
    const blocked = r.status >= 400;
    check(`refuses ${JSON.stringify(attempt)}`, blocked, String(r.status));
    if (r.status === 200 && /MONGO_URI|JWT_SECRET|ADMIN_PASSWORD/.test(r.body)) {
      check("  !! LEAKED .env", false, r.body.slice(0, 60));
    }
  }

  /* ------------------------------------------------------- forged tokens */

  console.log("\n=== forged and mismatched tokens ===");
  const garbage = await preview(`${ORIGIN}/preview/not-a-token/index.html`);
  check("garbage token refused", garbage.status === 401, String(garbage.status));

  const wrongSecret = jwt.sign({ p: id, u: "x" }, "some-other-secret", {
    audience: "workspace-preview",
    expiresIn: 600,
  });
  const forged = await preview(`${ORIGIN}/preview/${wrongSecret}/index.html`);
  check("token signed with another secret refused", forged.status === 401, String(forged.status));

  // A perfectly valid login token, reused as a preview token
  const loginToken = await preview(`${ORIGIN}/preview/${A}/index.html`);
  check("a login token is not a preview token", loginToken.status === 401, String(loginToken.status));

  const expired = jwt.sign({ p: id, u: String(leaderId) }, process.env.JWT_SECRET, {
    audience: "workspace-preview",
    expiresIn: -10,
  });
  const stale = await preview(`${ORIGIN}/preview/${expired}/index.html`);
  check("expired token refused", stale.status === 401, String(stale.status));
  check("and says so", /expired/i.test(stale.body), stale.body.slice(0, 80).replace(/\s+/g, " "));

  /* ------------------------------- a token for one project cannot reach another */

  console.log("\n=== a token names one project only ===");
  const other = await upload(A, buildZip([{ name: "index.html", content: "<h1>OTHER PROJECT</h1>" }]), {
    filename: "other.zip",
    name: "PHASE6 Other Project",
  });
  const otherId = other.data?.item?._id;
  check("second project created", other.status === 201);

  const crossToken = jwt.sign({ p: otherId, u: String(leaderId) }, process.env.JWT_SECRET, {
    audience: "workspace-preview",
    expiresIn: 600,
  });
  const crossed = await preview(`${ORIGIN}/preview/${crossToken}/index.html`);
  check(
    "a hand-made token for a project the user is not on is refused",
    crossed.status === 403,
    String(crossed.status)
  );

  const first = await preview(`${url}index.html`);
  check("the real token still only serves its own project", first.body === HELLO);

  /* ------------------------------------------------- live permission checks */

  console.log("\n=== permissions are re-checked on every request ===");
  const lMint = await json(L, "GET", `/leader/workspace/${id}/preview-token`);
  check("assigned leader can mint", lMint.status === 200, lMint.data?.message);
  const lUrl = `${ORIGIN}${lMint.data.path}`;
  check("and the link works", (await preview(lUrl)).status === 200);

  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: true, canCreateDelete: false, canRun: false },
  });
  const afterOff = await preview(lUrl);
  check("turning canRun off kills the live link", afterOff.status === 403, String(afterOff.status));
  check("with a readable reason", /turned off/i.test(afterOff.body));

  const lMint2 = await json(L, "GET", `/leader/workspace/${id}/preview-token`);
  check("and a new token cannot be minted", lMint2.status === 403, lMint2.data?.message);

  await json(A, "PUT", `/admin/code-projects/${id}`, {
    permissions: { canEdit: true, canCreateDelete: false, canRun: true },
  });
  check("switching it back on revives the same link", (await preview(lUrl)).status === 200);

  console.log("\n=== unassigning kills the link immediately ===");
  await json(A, "PUT", `/admin/code-projects/${id}`, { operationsManagers: [], employees: [] });
  const afterRemove = await preview(lUrl);
  check("removed leader's live link refused", afterRemove.status === 403, String(afterRemove.status));
  check("with a readable reason", /no longer assigned/i.test(afterRemove.body));

  /* ------------------------------------------------------ save then reload */

  console.log("\n=== change, save, preview shows it ===");
  await json(A, "PUT", `/admin/workspace/${id}/file`, {
    path: "index.html",
    content: "<!doctype html><html><body><h1>Welcome</h1></body></html>",
  });
  const afterSave = await preview(`${url}index.html`);
  check("preview serves the saved content", afterSave.body.includes("Welcome"), afterSave.body.slice(0, 60));
  check("and the old content is gone", !afterSave.body.includes("<h1>Hello</h1>"));

  /* ------------------------------------------------------- deleted project */

  console.log("\n=== deleting the project kills its previews ===");
  await purge(A, id);
  const afterDelete = await preview(`${url}index.html`);
  check("link to a deleted project refused", afterDelete.status >= 400, String(afterDelete.status));

  await purge(A, otherId);
  check("workspaces cleaned up", !fs.existsSync(path.resolve("uploads", "workspaces", id)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
};

main().catch((err) => {
  console.error("harness error:", err);
  process.exit(1);
});
