import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;
let employee;
let clientId;

const T = () => ({ token: admin.token });

/**
 * A day of the current month as "YYYY-MM-DD", built from local parts.
 *
 * Deliberately not toISOString(): on a Date at local midnight that converts to
 * UTC and, anywhere east of Greenwich, hands back the previous day — which is
 * how the first version of these tests fed the server dates a day off and then
 * blamed the server for the totals.
 */
const localDay = (day) => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
};

before(async () => {
  ({ api, stop } = await startHarness({ port: 5909 }));
  admin = await signIn(api, { role: "admin", name: "Ads Admin" });
  employee = await signIn(api, { role: "employee", name: "Ads Exec" });

  await api.put("/api/admin/settings", { gstNumber: "08ABCDE1234F1Z5" }, T());

  const { default: Client } = await import("../models/Client.js");
  const client = await Client.create({
    name: "Adverta",
    email: "adverta@example.com",
    gstNumber: "08ABCDE1234F1Z5",
  });
  clientId = String(client._id);
});

after(async () => {
  await stop();
});

const makeAccount = async (overrides = {}) => {
  const res = await api.post(
    "/api/admin/ads/accounts",
    { name: "Test account", platform: "meta", client: clientId, ...overrides },
    T()
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.item._id;
};

describe("accounts", () => {
  test("an account needs a client", async () => {
    const res = await api.post("/api/admin/ads/accounts", { name: "Homeless" }, T());
    assert.equal(res.status, 400);
    assert.match(res.body.message, /client/i);
  });

  test("a management fee above 100% of spend is refused as the typo it is", async () => {
    const res = await api.post(
      "/api/admin/ads/accounts",
      {
        name: "Fat fingers",
        client: clientId,
        feeType: "percent_of_spend",
        feeValue: 15000,
      },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /typo/i);
  });
});

describe("campaigns and their numbers", () => {
  let accountId;
  let campaignId;

  before(async () => {
    accountId = await makeAccount({ name: "Numbers account", monthlyBudget: 60000 });
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns`,
      { name: "Diwali leads", objective: "leads", dailyBudget: 2000 },
      T()
    );
    campaignId = res.body.item._id;
  });

  test("two campaigns on one account cannot share a name", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns`,
      { name: "Diwali leads" },
      T()
    );
    assert.equal(res.status, 409);
  });

  test("a day is recorded and the totals follow", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}/days`,
      { date: localDay(1), spend: 1800, impressions: 40000, clicks: 800, conversions: 20 },
      T()
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.item.totalSpend, 1800);
    assert.equal(res.body.item.totalClicks, 800);
  });

  test("re-entering the same day replaces it instead of doubling the spend", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}/days`,
      { date: localDay(1), spend: 1950, impressions: 41000, clicks: 810, conversions: 22 },
      T()
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.item.daily.length, 1, "one row for one date");
    assert.equal(res.body.item.totalSpend, 1950, "the corrected figure, not the sum of both");
  });

  test("the derived ratios come out of the stored five", async () => {
    const res = await api.get(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}`,
      T()
    );
    assert.equal(res.status, 200);

    const t = res.body.totals;
    assert.equal(t.spend, 1950);
    assert.equal(t.ctr, round2((810 / 41000) * 100));
    assert.equal(t.cpc, round2(1950 / 810));
    assert.equal(t.cpa, round2(1950 / 22));
  });

  test("a negative spend is refused", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}/days`,
      { date: localDay(2), spend: -100 },
      T()
    );
    assert.equal(res.status, 400);
  });
});

const round2 = (value) => Math.round(value * 100) / 100;

describe("budget pacing", () => {
  test("it projects the month from what has gone so far", async () => {
    const accountId = await makeAccount({ name: "Pacing account", monthlyBudget: 30000 });
    const campaign = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns`,
      { name: "Always on" },
      T()
    );

    // Spend 2,000 a day on the first three days of the month
    for (const day of [1, 2, 3]) {
      await api.post(
        `/api/admin/ads/accounts/${accountId}/campaigns/${campaign.body.item._id}/days`,
        { date: localDay(day), spend: 2000, impressions: 1000, clicks: 50 },
        T()
      );
    }

    const res = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    assert.equal(res.status, 200);
    assert.equal(res.body.thisMonth.spend, 6000);

    const pacing = res.body.pacing;
    assert.equal(pacing.budget, 30000);
    assert.equal(pacing.spent, 6000);
    assert.equal(pacing.remaining, 24000);
    // The projection is spend-so-far over days-so-far, times days in the month
    const expected = round2((6000 / pacing.dayOfMonth) * pacing.daysInMonth);
    assert.equal(pacing.onPaceFor, expected);
    assert.equal(pacing.variance, round2(expected - 30000));
  });

  test("with no budget set there is no pacing figure rather than a misleading one", async () => {
    const accountId = await makeAccount({ name: "No budget" });
    const res = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    assert.equal(res.body.pacing, null);
  });
});

describe("importing a platform export", () => {
  let accountId;

  before(async () => {
    accountId = await makeAccount({ name: "Import account" });
  });

  test("unknown campaigns are created rather than refused", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/import`,
      {
        rows: [
          { campaign: "Brand — search", date: localDay(1), spend: 500, clicks: 30, impressions: 900 },
          { campaign: "Brand — search", date: localDay(2), spend: 620, clicks: 41, impressions: 1100 },
          { campaign: "Retargeting", date: localDay(1), spend: 220, clicks: 12, impressions: 4000 },
        ],
      },
      T()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.report.imported, 3);
    assert.equal(res.body.report.campaignsCreated.length, 2);
  });

  test("re-importing the same file updates rather than doubling", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/import`,
      {
        rows: [
          { campaign: "Brand — search", date: localDay(1), spend: 555, clicks: 33, impressions: 950 },
        ],
      },
      T()
    );

    assert.equal(res.body.report.updated, 1);
    assert.equal(res.body.report.imported, 0);

    const detail = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    // 555 (corrected) + 620 + 220
    assert.equal(detail.body.thisMonth.spend, 1395);
  });

  test("rows that cannot be read are skipped and reported, not written as zeroes", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/import`,
      {
        rows: [
          { campaign: "", date: localDay(3), spend: 100 },
          { campaign: "Retargeting", date: "not a date", spend: 100 },
          { campaign: "Retargeting", date: localDay(3), spend: "—" },
          { campaign: "Retargeting", date: localDay(3), spend: 310 },
        ],
      },
      T()
    );

    assert.equal(res.body.report.imported, 1);
    assert.equal(res.body.report.skipped.length, 3);
    assert.match(res.body.report.skipped[0].reason, /campaign name/);
    assert.match(res.body.report.skipped[1].reason, /date/);
    assert.match(res.body.report.skipped[2].reason, /spend/);
  });

  test("an empty import is refused", async () => {
    const res = await api.post(`/api/admin/ads/accounts/${accountId}/import`, { rows: [] }, T());
    assert.equal(res.status, 400);
  });
});

describe("prepaid accounts", () => {
  let accountId;
  let campaignId;

  before(async () => {
    accountId = await makeAccount({ name: "Prepaid account", funding: "prepaid" });
    const campaign = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns`,
      { name: "Burn" },
      T()
    );
    campaignId = campaign.body.item._id;
  });

  test("a top-up credits the balance", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/topups`,
      { amount: 25000, mode: "upi", reference: "UTR777" },
      T()
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.money.kind, "balance");
    assert.equal(res.body.money.balance, 25000);
  });

  test("spend draws it down", async () => {
    await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}/days`,
      { date: localDay(1), spend: 18000, impressions: 1, clicks: 1 },
      T()
    );

    const res = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    assert.equal(res.body.money.balance, 7000);
    assert.equal(res.body.money.exhausted, false);
  });

  test("and running past it is flagged", async () => {
    await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}/days`,
      { date: localDay(2), spend: 9000, impressions: 1, clicks: 1 },
      T()
    );

    const res = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    assert.equal(res.body.money.balance, -2000);
    assert.equal(res.body.money.exhausted, true, "the client's money has run out");
  });

  test("a top-up on a client-card account makes no sense and is refused", async () => {
    const other = await makeAccount({ name: "Their card", funding: "client_card" });
    const res = await api.post(`/api/admin/ads/accounts/${other}/topups`, { amount: 1000 }, T());
    assert.equal(res.status, 409);
  });
});

describe("billing back what the studio fronted", () => {
  let accountId;
  let campaignId;

  before(async () => {
    accountId = await makeAccount({
      name: "Pass-through account",
      funding: "studio_card",
      feeType: "percent_of_spend",
      feeValue: 15,
    });
    const campaign = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns`,
      { name: "Performance" },
      T()
    );
    campaignId = campaign.body.item._id;

    for (const day of [1, 2, 3, 4]) {
      await api.post(
        `/api/admin/ads/accounts/${accountId}/campaigns/${campaignId}/days`,
        { date: localDay(day), spend: 5000, impressions: 10000, clicks: 200, conversions: 10 },
        T()
      );
    }
  });

  test("unbilled spend is what the studio is owed", async () => {
    const res = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    assert.equal(res.body.money.kind, "recoverable");
    assert.equal(res.body.money.unrecovered, 20000);
  });

  test("billing the period produces an invoice with the spend and the fee", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/bill`,
      { from: localDay(1), to: localDay(4) },
      T()
    );

    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.spend, 20000);
    assert.equal(res.body.fee, 3000, "15% of 20,000");

    const invoice = res.body.invoice;
    assert.equal(invoice.lines.length, 2);
    assert.match(invoice.lines[0].description, /Ad spend/);
    assert.match(invoice.lines[1].description, /management fee \(15% of spend\)/);
    assert.equal(invoice.status, "draft", "raised as a draft so it is read before it is sent");

    // Spend carries no GST by default (it is a reimbursement); the fee carries 18%
    assert.equal(invoice.total, 23540);
  });

  test("once billed, nothing is outstanding", async () => {
    const res = await api.get(`/api/admin/ads/accounts/${accountId}/detail`, T());
    assert.equal(res.body.money.unrecovered, 0);
    assert.ok(res.body.money.recoveredTo);
  });

  test("billing an overlapping period is refused, and says which invoice covered it", async () => {
    const res = await api.post(
      `/api/admin/ads/accounts/${accountId}/bill`,
      { from: localDay(3), to: localDay(6) },
      T()
    );
    assert.equal(res.status, 409);
    assert.match(res.body.message, /overlaps one already billed/i);
    assert.match(res.body.message, /INV\//);
  });

  test("a period with nothing in it is refused", async () => {
    const clean = await makeAccount({ name: "Nothing spent", funding: "studio_card", feeType: "none" });
    const res = await api.post(
      `/api/admin/ads/accounts/${clean}/bill`,
      { from: localDay(1), to: localDay(5) },
      T()
    );
    assert.equal(res.status, 400);
  });

  test("a client-card account is never invoiced for the spend itself", async () => {
    const theirs = await makeAccount({
      name: "Their money",
      funding: "client_card",
      feeType: "flat_monthly",
      feeValue: 10000,
    });
    const campaign = await api.post(
      `/api/admin/ads/accounts/${theirs}/campaigns`,
      { name: "Their campaign" },
      T()
    );
    await api.post(
      `/api/admin/ads/accounts/${theirs}/campaigns/${campaign.body.item._id}/days`,
      { date: localDay(1), spend: 40000, impressions: 1, clicks: 1 },
      T()
    );

    const res = await api.post(
      `/api/admin/ads/accounts/${theirs}/bill`,
      { from: localDay(1), to: localDay(28) },
      T()
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.invoice.lines.length, 1, "the fee only — the spend was never the studio's");
    assert.match(res.body.invoice.lines[0].description, /management fee/i);
    assert.equal(res.body.fee, 10000);
  });
});

describe("the report", () => {
  test("it totals the period and compares it with the one before", async () => {
    const accountId = await makeAccount({ name: "Report account", monthlyBudget: 20000 });
    const campaign = await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns`,
      { name: "Reported" },
      T()
    );

    await api.post(
      `/api/admin/ads/accounts/${accountId}/campaigns/${campaign.body.item._id}/days`,
      { date: localDay(10), spend: 4000, impressions: 100000, clicks: 2000, conversions: 40, conversionValue: 120000 },
      T()
    );

    const res = await api.get(
      `/api/admin/ads/accounts/${accountId}/report?from=${localDay(1)}&to=${localDay(28)}`,
      T()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.totals.spend, 4000);
    assert.equal(res.body.totals.roas, 30, "120,000 back on 4,000 spent");
    assert.equal(res.body.totals.cpa, 100);
    assert.equal(res.body.campaigns.length, 1);
    assert.equal(res.body.campaigns[0].name, "Reported");
    assert.ok(Array.isArray(res.body.daily));
    assert.ok(res.body.previous, "the window before is there to compare against");
  });
});

describe("what staff can see", () => {
  let mineId;
  let theirsId;

  before(async () => {
    mineId = await makeAccount({
      name: "Assigned to me",
      funding: "studio_card",
      employees: [employee.user._id],
    });
    theirsId = await makeAccount({ name: "Somebody else's" });
  });

  test("an employee sees only the accounts they are on", async () => {
    const res = await api.get("/api/employee/ads/my-work", { token: employee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.accounts.length, 1);
    assert.equal(res.body.accounts[0].name, "Assigned to me");
  });

  test("and is refused one they are not", async () => {
    const res = await api.get(`/api/employee/ads/accounts/${theirsId}`, { token: employee.token });
    assert.equal(res.status, 403);
  });

  test("their view carries the budget but never the money position", async () => {
    const res = await api.get(`/api/employee/ads/accounts/${mineId}`, { token: employee.token });
    assert.equal(res.status, 200);
    assert.equal(res.body.money, undefined, "what the studio is owed is not theirs to see");
    assert.equal(res.body.item.topups, undefined);
    assert.equal(res.body.item.recoveries, undefined);
    assert.equal(res.body.item.feeValue, undefined);
  });

  test("an assigned employee can record a day", async () => {
    const campaign = await api.post(
      `/api/admin/ads/accounts/${mineId}/campaigns`,
      { name: "Theirs to run" },
      T()
    );

    const res = await api.post(
      `/api/employee/ads/campaigns/${campaign.body.item._id}/days`,
      { date: localDay(5), spend: 750, impressions: 5000, clicks: 60 },
      { token: employee.token }
    );
    assert.equal(res.status, 200);
  });

  test("an unassigned one cannot", async () => {
    const campaign = await api.post(
      `/api/admin/ads/accounts/${theirsId}/campaigns`,
      { name: "Not theirs" },
      T()
    );

    const res = await api.post(
      `/api/employee/ads/campaigns/${campaign.body.item._id}/days`,
      { date: localDay(5), spend: 1 },
      { token: employee.token }
    );
    assert.equal(res.status, 403);
  });

  test("staff cannot reach the admin's ads routes at all", async () => {
    const res = await api.get("/api/admin/ads/overview", { token: employee.token });
    assert.equal(res.status, 403);
  });
});

describe("the morning overview", () => {
  test("it flags what is overspending and what has run dry", async () => {
    const res = await api.get("/api/admin/ads/overview", T());
    assert.equal(res.status, 200);
    assert.ok(res.body.accounts.length > 0);
    assert.ok(typeof res.body.totals.spendThisMonth === "number");
    assert.ok(Array.isArray(res.body.alerts.overspending));
    assert.ok(
      res.body.alerts.outOfMoney.some((row) => row.name === "Prepaid account"),
      "the prepaid account that went past its balance is named"
    );
  });
});
