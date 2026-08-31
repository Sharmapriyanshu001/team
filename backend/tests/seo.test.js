import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;
let employee;
let clientId;

const T = () => ({ token: admin.token });

const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
};

before(async () => {
  ({ api, stop } = await startHarness({ port: 5903 }));
  admin = await signIn(api, { role: "admin", name: "SEO Admin" });
  employee = await signIn(api, { role: "employee", name: "SEO Exec" });

  const { default: Client } = await import("../models/Client.js");
  const client = await Client.create({ name: "Rank Co", email: "rank@example.com" });
  clientId = String(client._id);
});

after(async () => {
  await stop();
});

describe("engagements", () => {
  test("an engagement needs a client", async () => {
    const res = await api.post("/api/admin/seo/projects", { name: "Nobody's SEO" }, T());
    assert.equal(res.status, 400);
    assert.match(res.body.message, /client/i);
  });

  test("ending stamps the date and reopening clears it", async () => {
    const made = await api.post(
      "/api/admin/seo/projects",
      { name: "Temp", client: clientId },
      T()
    );
    assert.equal(made.status, 201);

    const ended = await api.put(
      `/api/admin/seo/projects/${made.body.item._id}`,
      { status: "ended" },
      T()
    );
    assert.ok(ended.body.item.endedOn);

    const back = await api.put(
      `/api/admin/seo/projects/${made.body.item._id}`,
      { status: "active" },
      T()
    );
    assert.equal(back.body.item.endedOn, null);
  });
});

describe("keywords", () => {
  let projectId;

  before(async () => {
    const res = await api.post(
      "/api/admin/seo/projects",
      { name: "Rank Co SEO", client: clientId, website: "https://rank.example.com" },
      T()
    );
    projectId = res.body.item._id;
  });

  test("keywords are added in bulk and duplicates are skipped, not refused", async () => {
    const first = await api.post(
      `/api/admin/seo/projects/${projectId}/keywords`,
      { terms: ["plumber jaipur", "best plumber", "  plumber jaipur  "] },
      T()
    );
    assert.equal(first.status, 201);
    assert.equal(first.body.items.length, 2, "the repeat inside one paste is collapsed");

    const again = await api.post(
      `/api/admin/seo/projects/${projectId}/keywords`,
      { terms: ["plumber jaipur", "emergency plumber"] },
      T()
    );
    assert.equal(again.status, 201);
    assert.equal(again.body.items.length, 1);
    assert.deepEqual(again.body.skipped, ["plumber jaipur"]);
  });

  test("a rank is recorded and the caches follow the series", async () => {
    const list = await api.get(`/api/admin/seo/projects/${projectId}/keywords`, T());
    const keyword = list.body.items.find((k) => k.term === "plumber jaipur");

    await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${keyword._id}/rank`,
      { position: 40, date: daysAgo(40) },
      T()
    );
    await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${keyword._id}/rank`,
      { position: 12, date: daysAgo(10) },
      T()
    );
    const latest = await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${keyword._id}/rank`,
      { position: 7, date: daysAgo(1) },
      T()
    );

    assert.equal(latest.body.item.currentPosition, 7);
    assert.equal(latest.body.item.previousPosition, 12);
    assert.equal(latest.body.item.bestPosition, 7);
    assert.equal(latest.body.item.history.length, 3);
  });

  test("re-checking the same day replaces that reading instead of adding one", async () => {
    const list = await api.get(`/api/admin/seo/projects/${projectId}/keywords`, T());
    const keyword = list.body.items.find((k) => k.term === "best plumber");

    await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${keyword._id}/rank`,
      { position: 30, date: daysAgo(2) },
      T()
    );
    const fixed = await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${keyword._id}/rank`,
      { position: 25, date: daysAgo(2) },
      T()
    );

    assert.equal(fixed.body.item.history.length, 1);
    assert.equal(fixed.body.item.currentPosition, 25);
  });

  test("'not ranking' is a real reading, not a missing one", async () => {
    const list = await api.get(`/api/admin/seo/projects/${projectId}/keywords`, T());
    const keyword = list.body.items.find((k) => k.term === "emergency plumber");

    const res = await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${keyword._id}/rank`,
      { position: null },
      T()
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.item.currentPosition, null);
    assert.equal(res.body.item.history.length, 1, "the observation is kept");
  });

  test("a nonsense position is refused", async () => {
    const list = await api.get(`/api/admin/seo/projects/${projectId}/keywords`, T());
    const res = await api.post(
      `/api/admin/seo/projects/${projectId}/keywords/${list.body.items[0]._id}/rank`,
      { position: 0 },
      T()
    );
    assert.equal(res.status, 400);
  });
});

describe("backlinks", () => {
  let projectId;

  before(async () => {
    const res = await api.post(
      "/api/admin/seo/projects",
      { name: "Link Building", client: clientId },
      T()
    );
    projectId = res.body.item._id;
  });

  test("the domain is derived from the URL, www stripped", async () => {
    const res = await api.post(
      "/api/admin/seo/backlinks",
      {
        seoProject: projectId,
        sourceUrl: "https://www.Example.COM/blog/post-1",
        anchorText: "best plumber",
        status: "live",
        acquiredOn: daysAgo(5),
      },
      T()
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.item.sourceDomain, "example.com");
  });

  test("a URL that is not one is refused", async () => {
    const res = await api.post(
      "/api/admin/seo/backlinks",
      { seoProject: projectId, sourceUrl: "not a url at all" },
      T()
    );
    assert.equal(res.status, 400);
  });

  test("marking a batch lost stamps when", async () => {
    const made = await api.post(
      "/api/admin/seo/backlinks",
      { seoProject: projectId, sourceUrl: "https://gone.example.org/x", status: "live" },
      T()
    );

    const res = await api.post(
      "/api/admin/seo/backlinks/check",
      { ids: [made.body.item._id], status: "lost" },
      T()
    );
    assert.equal(res.status, 200);

    const after = await api.get(`/api/admin/seo/backlinks/${made.body.item._id}`, T());
    assert.equal(after.body.item.status, "lost");
    assert.ok(after.body.item.lostAt);
  });
});

describe("the monthly report", () => {
  let projectId;

  before(async () => {
    const made = await api.post(
      "/api/admin/seo/projects",
      { name: "Report Co", client: clientId, website: "https://report.example.com" },
      T()
    );
    projectId = made.body.item._id;

    await api.post(
      `/api/admin/seo/projects/${projectId}/keywords`,
      { terms: ["climbed", "slipped", "brand new"] },
      T()
    );

    const list = await api.get(`/api/admin/seo/projects/${projectId}/keywords`, T());
    const by = (term) => list.body.items.find((k) => k.term === term)._id;
    const rank = (id, position, when) =>
      api.post(
        `/api/admin/seo/projects/${projectId}/keywords/${id}/rank`,
        { position, date: when },
        T()
      );

    // A reading before the window, and one inside it
    await rank(by("climbed"), 20, daysAgo(45));
    await rank(by("climbed"), 8, daysAgo(3));

    await rank(by("slipped"), 5, daysAgo(45));
    await rank(by("slipped"), 14, daysAgo(3));

    // Nothing before the window at all — this is a term that newly ranks
    await rank(by("brand new"), 30, daysAgo(3));

    await api.post(
      "/api/admin/seo/social-accounts",
      { client: clientId, seoProject: projectId, platform: "instagram", handle: "@reportco" },
      T()
    );
  });

  test("movement is measured from before the window, not from inside it", async () => {
    const res = await api.get(
      `/api/admin/seo/projects/${projectId}/report?from=${daysAgo(30).slice(0, 10)}`,
      T()
    );
    assert.equal(res.status, 200);

    const rows = res.body.keywords.rows;
    const climbed = rows.find((r) => r.term === "climbed");
    const slipped = rows.find((r) => r.term === "slipped");

    assert.equal(climbed.startPosition, 20, "the reading in force when the month opened");
    assert.equal(climbed.currentPosition, 8);
    assert.equal(climbed.change, 12, "up twelve places — lower number, higher rank");

    assert.equal(slipped.change, -9, "and down nine is negative");
  });

  test("the summary counts what a client is shown", async () => {
    const res = await api.get(
      `/api/admin/seo/projects/${projectId}/report?from=${daysAgo(30).slice(0, 10)}`,
      T()
    );
    const s = res.body.keywords.summary;

    assert.equal(s.tracked, 3);
    assert.equal(s.improved, 1);
    assert.equal(s.declined, 1);
    assert.equal(s.topTen, 1, "only 'climbed' at 8 is in the top ten");
    assert.equal(s.newlyRanking, 1, "'brand new' had no reading before the window");
  });

  test("the biggest movers come out sorted", async () => {
    const res = await api.get(
      `/api/admin/seo/projects/${projectId}/report?from=${daysAgo(30).slice(0, 10)}`,
      T()
    );
    assert.equal(res.body.keywords.gained[0].term, "climbed");
    assert.equal(res.body.keywords.lost[0].term, "slipped");
  });

  test("follower growth is reported per account", async () => {
    const accounts = await api.get(`/api/admin/seo/social-accounts?seoProject=${projectId}`, T());
    const id = accounts.body.items[0]._id;

    await api.post(`/api/admin/seo/social-accounts/${id}/followers`, { followers: 1000, date: daysAgo(45) }, T());
    await api.post(`/api/admin/seo/social-accounts/${id}/followers`, { followers: 1240, date: daysAgo(2) }, T());

    const res = await api.get(
      `/api/admin/seo/projects/${projectId}/report?from=${daysAgo(30).slice(0, 10)}`,
      T()
    );
    const account = res.body.social.followers[0];
    assert.equal(account.start, 1000);
    assert.equal(account.current, 1240);
    assert.equal(account.gained, 240);
  });
});

describe("the post calendar", () => {
  let projectId;

  before(async () => {
    const made = await api.post(
      "/api/admin/seo/projects",
      { name: "Social Co", client: clientId, service: "smo" },
      T()
    );
    projectId = made.body.item._id;
  });

  test("approving and publishing stamp their own dates", async () => {
    const made = await api.post(
      "/api/admin/seo/posts",
      { client: clientId, seoProject: projectId, title: "Diwali offer", hashtags: ["#sale", "diwali"] },
      T()
    );
    assert.equal(made.status, 201);
    assert.deepEqual(made.body.item.hashtags, ["sale", "diwali"], "the hash is stripped");

    const approved = await api.put(
      `/api/admin/seo/posts/${made.body.item._id}`,
      { status: "approved" },
      T()
    );
    assert.ok(approved.body.item.approvedAt);
    assert.equal(approved.body.item.approvedByName, "SEO Admin");

    const published = await api.put(
      `/api/admin/seo/posts/${made.body.item._id}`,
      { status: "published" },
      T()
    );
    assert.ok(published.body.item.publishedAt);
  });

  test("the calendar filters to one month", async () => {
    const when = new Date();
    when.setDate(15);
    const month = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, "0")}`;

    await api.post(
      "/api/admin/seo/posts",
      { client: clientId, seoProject: projectId, title: "This month", scheduledFor: when.toISOString() },
      T()
    );

    const res = await api.get(`/api/admin/seo/posts?month=${month}`, T());
    assert.equal(res.status, 200);
    assert.ok(res.body.items.some((p) => p.title === "This month"));

    const empty = await api.get("/api/admin/seo/posts?month=1999-01", T());
    assert.equal(empty.body.total, 0);
  });
});

describe("audits", () => {
  test("a finding can be walked to fixed, and unfixing clears the date", async () => {
    const project = await api.post(
      "/api/admin/seo/projects",
      { name: "Audit Co", client: clientId },
      T()
    );

    const made = await api.post(
      "/api/admin/seo/audits",
      {
        seoProject: project.body.item._id,
        title: "First crawl",
        scores: { performance: 41, seo: 88 },
        issues: [{ title: "Missing meta descriptions", severity: "high" }],
      },
      T()
    );
    assert.equal(made.status, 201);

    const issueId = made.body.item.issues[0]._id;

    const fixed = await api.put(
      `/api/admin/seo/audits/${made.body.item._id}/issues/${issueId}`,
      { status: "fixed" },
      T()
    );
    assert.equal(fixed.status, 200);
    assert.ok(fixed.body.item.issues[0].fixedAt);

    const reopened = await api.put(
      `/api/admin/seo/audits/${made.body.item._id}/issues/${issueId}`,
      { status: "open" },
      T()
    );
    assert.equal(reopened.body.item.issues[0].fixedAt, null);
  });
});

describe("what staff can see", () => {
  test("an employee sees only the engagements they are on", async () => {
    const mine = await api.post(
      "/api/admin/seo/projects",
      { name: "Mine", client: clientId, employees: [employee.user._id] },
      T()
    );
    assert.equal(mine.status, 201);

    const res = await api.get("/api/employee/seo/my-work", { token: employee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.engagements.length, 1);
    assert.equal(res.body.engagements[0].name, "Mine");
  });

  test("and cannot reach the admin's list", async () => {
    const res = await api.get("/api/admin/seo/projects", { token: employee.token });
    assert.equal(res.status, 403);
  });
});
