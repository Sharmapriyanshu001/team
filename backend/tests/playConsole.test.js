import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;
let leader;
let employee;

before(async () => {
  ({ api, stop } = await startHarness({ port: 5901 }));
  admin = await signIn(api, { role: "admin", name: "Play Admin" });
  leader = await signIn(api, { role: "team_leader", name: "Lead Dev" });
  employee = await signIn(api, { role: "employee", name: "App Dev" });
});

after(async () => {
  await stop();
});

const T = () => ({ token: admin.token });

describe("developer consoles", () => {
  test("a studio console is created and listed", async () => {
    const created = await api.post(
      "/api/admin/play/consoles",
      { name: "Studio Main", accountEmail: "Play@Studio.COM", developerId: "5512345678901234567" },
      T()
    );
    assert.equal(created.status, 201);
    assert.equal(created.body.item.ownership, "studio");
    assert.equal(created.body.item.accountEmail, "play@studio.com", "email is normalised");

    const list = await api.get("/api/admin/play/consoles", T());
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
  });

  test("a client-owned console must name the client", async () => {
    const res = await api.post(
      "/api/admin/play/consoles",
      { name: "Client Account", ownership: "client" },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /client this console belongs to/i);
  });

  test("switching back to studio clears the client", async () => {
    const { default: Client } = await import("../models/Client.js");
    const client = await Client.create({ name: "Acme", email: "acme@example.com" });

    const made = await api.post(
      "/api/admin/play/consoles",
      { name: "Acme Console", ownership: "client", client: client._id },
      T()
    );
    assert.equal(made.status, 201);
    assert.equal(String(made.body.item.client._id), String(client._id));

    const moved = await api.put(
      `/api/admin/play/consoles/${made.body.item._id}`,
      { ownership: "studio" },
      T()
    );
    assert.equal(moved.status, 200);
    assert.equal(moved.body.item.client, null);
  });
});

describe("apps", () => {
  let consoleId;

  before(async () => {
    const res = await api.post("/api/admin/play/consoles", { name: "Apps Console" }, T());
    consoleId = res.body.item._id;
  });

  test("a bad package name is refused with a useful message", async () => {
    const res = await api.post(
      "/api/admin/play/apps",
      { name: "Broken", packageName: "notapackage", console: consoleId },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /com\.company\.app/);
  });

  test("an app needs a console", async () => {
    const res = await api.post(
      "/api/admin/play/apps",
      { name: "Homeless", packageName: "com.test.homeless" },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /console/i);
  });

  test("the same package name cannot be used twice", async () => {
    const one = await api.post(
      "/api/admin/play/apps",
      { name: "First", packageName: "com.studio.taken", console: consoleId },
      T()
    );
    assert.equal(one.status, 201);

    const two = await api.post(
      "/api/admin/play/apps",
      { name: "Second", packageName: "COM.STUDIO.TAKEN", console: consoleId },
      T()
    );
    assert.equal(two.status, 400, "case difference must not defeat the check");
    assert.match(two.body.message, /already recorded as "First"/, two.body.message);
  });

  test("the store listing keeps Google's length limits", async () => {
    const res = await api.post(
      "/api/admin/play/apps",
      {
        name: "Listing Test",
        packageName: "com.studio.listing",
        console: consoleId,
        listing: { title: "x".repeat(31) },
      },
      T()
    );
    assert.equal(res.status, 400, "a 31-character title is refused before it reaches Play");
  });
});

describe("releases", () => {
  let appId;

  before(async () => {
    const c = await api.post("/api/admin/play/consoles", { name: "Release Console" }, T());
    const a = await api.post(
      "/api/admin/play/apps",
      { name: "Releaser", packageName: "com.studio.releaser", console: c.body.item._id },
      T()
    );
    appId = a.body.item._id;
  });

  test("a release is recorded and the version code must climb", async () => {
    const first = await api.post(
      `/api/admin/play/apps/${appId}/releases`,
      { versionName: "1.0.0", versionCode: 10, track: "production", status: "live" },
      T()
    );
    assert.equal(first.status, 201);

    const clash = await api.post(
      `/api/admin/play/apps/${appId}/releases`,
      { versionName: "1.0.1", versionCode: 10 },
      T()
    );
    assert.equal(clash.status, 400);
    assert.match(clash.body.message, /already used/i);
    assert.match(clash.body.message, /10/, "the message names the code it clashed with");
  });

  test("going live updates what the app says is live", async () => {
    const detail = await api.get(`/api/admin/play/apps/${appId}/detail`, T());
    assert.equal(detail.status, 200);
    assert.equal(detail.body.item.liveVersionName, "1.0.0");
    assert.equal(detail.body.item.liveVersionCode, 10);
    assert.ok(detail.body.item.lastReleaseAt, "and when it went out");
  });

  test("a rejection without a reason is refused", async () => {
    const made = await api.post(
      `/api/admin/play/apps/${appId}/releases`,
      { versionName: "1.1.0", versionCode: 11, status: "submitted" },
      T()
    );
    assert.equal(made.status, 201);
    assert.ok(made.body.item.submittedAt, "submitting stamps the date by itself");

    const bad = await api.put(
      `/api/admin/play/apps/${appId}/releases/${made.body.item._id}`,
      { status: "rejected" },
      T()
    );
    assert.equal(bad.status, 400);

    const good = await api.put(
      `/api/admin/play/apps/${appId}/releases/${made.body.item._id}`,
      { status: "rejected", rejectionReason: "Deceptive Behaviour — misleading screenshots" },
      T()
    );
    assert.equal(good.status, 200);
    assert.ok(good.body.item.rejectedAt);
  });

  test("deleting the live release rolls the app back to the previous one", async () => {
    const list = await api.get(`/api/admin/play/apps/${appId}/releases`, T());
    const live = list.body.items.find((r) => r.status === "live");

    const gone = await api.del(`/api/admin/play/apps/${appId}/releases/${live._id}`, T());
    assert.equal(gone.status, 200);

    const detail = await api.get(`/api/admin/play/apps/${appId}/detail`, T());
    assert.equal(detail.body.item.liveVersionCode, 0, "nothing is live any more, and it says so");
  });
});

describe("policy alerts", () => {
  let consoleId;

  before(async () => {
    const c = await api.post("/api/admin/play/consoles", { name: "Alert Console" }, T());
    consoleId = c.body.item._id;
  });

  test("a notice must be about something", async () => {
    const res = await api.post("/api/admin/play/alerts", { title: "Floating" }, T());
    assert.equal(res.status, 400);
    assert.match(res.body.message, /which console or app/i);
  });

  test("resolving records who and when, and un-resolving clears it", async () => {
    const made = await api.post(
      "/api/admin/play/alerts",
      { title: "Data safety form out of date", console: consoleId, severity: "high" },
      T()
    );
    assert.equal(made.status, 201);

    const done = await api.put(
      `/api/admin/play/alerts/${made.body.item._id}`,
      { status: "resolved", resolution: "Form resubmitted" },
      T()
    );
    assert.equal(done.status, 200);
    assert.ok(done.body.item.resolvedAt);
    assert.ok(done.body.item.resolvedBy);

    const reopened = await api.put(
      `/api/admin/play/alerts/${made.body.item._id}`,
      { status: "open" },
      T()
    );
    assert.equal(reopened.body.item.resolvedAt, null);
    assert.equal(reopened.body.item.resolvedBy, null);
  });
});

describe("deleting", () => {
  test("a console holding apps refuses to go, and says how many", async () => {
    const c = await api.post("/api/admin/play/consoles", { name: "Busy Console" }, T());
    await api.post(
      "/api/admin/play/apps",
      { name: "Occupant", packageName: "com.studio.occupant", console: c.body.item._id },
      T()
    );

    const res = await api.del(`/api/admin/play/consoles/${c.body.item._id}`, T());
    assert.equal(res.status, 409);
    assert.match(res.body.message, /1 app/);
  });

  test("deleting an app takes its releases with it", async () => {
    const c = await api.post("/api/admin/play/consoles", { name: "Doomed Console" }, T());
    const a = await api.post(
      "/api/admin/play/apps",
      { name: "Doomed", packageName: "com.studio.doomed", console: c.body.item._id },
      T()
    );
    await api.post(
      `/api/admin/play/apps/${a.body.item._id}/releases`,
      { versionName: "1.0", versionCode: 1 },
      T()
    );

    const res = await api.del(`/api/admin/play/apps/${a.body.item._id}`, T());
    assert.equal(res.status, 200);

    const { default: AppRelease } = await import("../models/AppRelease.js");
    assert.equal(await AppRelease.countDocuments({ app: a.body.item._id }), 0);
  });
});

describe("what staff can see", () => {
  let consoleId;
  let mineId;
  let theirsId;

  before(async () => {
    const c = await api.post(
      "/api/admin/play/consoles",
      { name: "Team Console", teamLeaders: [leader.user._id] },
      T()
    );
    consoleId = c.body.item._id;

    const mine = await api.post(
      "/api/admin/play/apps",
      {
        name: "Assigned App",
        packageName: "com.studio.assigned",
        console: consoleId,
        employees: [employee.user._id],
      },
      T()
    );
    mineId = mine.body.item._id;

    const theirs = await api.post(
      "/api/admin/play/apps",
      { name: "Somebody Else", packageName: "com.studio.notmine", console: consoleId },
      T()
    );
    theirsId = theirs.body.item._id;
  });

  test("an employee sees only the app they are named on", async () => {
    const res = await api.get("/api/employee/play/my-work", { token: employee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.apps.length, 1);
    assert.equal(res.body.apps[0].name, "Assigned App");
  });

  test("an employee is refused an app they are not on", async () => {
    const res = await api.get(`/api/employee/play/apps/${theirsId}`, { token: employee.token });
    assert.equal(res.status, 403);
  });

  test("a team leader sees every app on the console they lead", async () => {
    const res = await api.get("/api/leader/play/my-work", { token: leader.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.consoles.length, 1);
    assert.equal(res.body.apps.length, 2, "including the one nobody was named on");
  });

  test("an assigned employee can record a release", async () => {
    const res = await api.post(
      `/api/employee/play/apps/${mineId}/releases`,
      { versionName: "2.0.0", versionCode: 20, status: "submitted" },
      { token: employee.token }
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.item.createdByName, "App Dev", "authorship is the staff member, not the admin");
  });

  test("an unassigned employee cannot", async () => {
    const res = await api.post(
      `/api/employee/play/apps/${theirsId}/releases`,
      { versionName: "9.9.9", versionCode: 99 },
      { token: employee.token }
    );
    assert.equal(res.status, 403);
  });

  test("staff cannot reach the admin's console list at all", async () => {
    const res = await api.get("/api/admin/play/consoles", { token: employee.token });
    assert.equal(res.status, 403);
  });
});

describe("overview", () => {
  test("counts what the section leads with", async () => {
    const res = await api.get("/api/admin/play/overview", T());
    assert.equal(res.status, 200);
    assert.ok(res.body.consoles.total > 0);
    assert.ok(res.body.apps.total > 0);
    assert.equal(typeof res.body.alerts.open, "number");
    assert.ok(Array.isArray(res.body.releases.recent));
  });
});
