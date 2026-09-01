import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;

const T = () => ({ token: admin.token });

const localDay = (day) => {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth(), day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
};

before(async () => {
  ({ api, stop } = await startHarness({ port: 5911 }));
  admin = await signIn(api, { role: "admin", name: "Owner" });
});

after(async () => {
  await stop();
});

const makeProperty = async (overrides = {}) => {
  const res = await api.post(
    "/api/admin/portfolio/properties",
    { name: "Test app", kind: "android_app", ...overrides },
    T()
  );
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.item;
};

const addEntry = (id, body) =>
  api.post(`/api/admin/portfolio/properties/${id}/entries`, body, T());

describe("properties and their shares", () => {
  test("shares adding to more than the whole thing are refused", async () => {
    const res = await api.post(
      "/api/admin/portfolio/properties",
      {
        name: "Overshared",
        partners: [
          { name: "A", sharePercent: 60 },
          { name: "B", sharePercent: 60 },
        ],
      },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /120% — more than the whole thing/);
  });

  test("shares adding to less are fine — the studio keeps the rest", async () => {
    const property = await makeProperty({
      name: "Part owned",
      partners: [{ name: "Ramesh", sharePercent: 30 }],
    });

    const res = await api.get(`/api/admin/portfolio/properties/${property._id}/detail`, T());
    assert.equal(res.status, 200);
    assert.equal(res.body.pnl.studio.sharePercent, 70);
  });
});

describe("the books", () => {
  let id;

  before(async () => {
    id = (await makeProperty({ name: "Solo app" }))._id;
  });

  test("revenue and costs make a profit", async () => {
    await addEntry(id, {
      kind: "revenue",
      category: "admob",
      amount: 40000,
      on: localDay(1),
      settledOn: localDay(1),
    });
    await addEntry(id, { kind: "expense", category: "hosting", amount: 2000, on: localDay(1) });
    await addEntry(id, { kind: "expense", category: "tools", amount: 3000, on: localDay(1) });

    const res = await api.get(`/api/admin/portfolio/properties/${id}/detail`, T());
    const pnl = res.body.pnl;

    assert.equal(pnl.revenue.earned, 40000);
    assert.equal(pnl.expenses.total, 5000);
    assert.equal(pnl.profit, 35000);
    assert.equal(pnl.margin, 87.5);
  });

  test("earned and received are different questions", async () => {
    // AdMob reports the month now and pays it weeks later
    await addEntry(id, { kind: "revenue", category: "admob", amount: 12000, on: localDay(2) });

    const res = await api.get(`/api/admin/portfolio/properties/${id}/detail`, T());
    const revenue = res.body.pnl.revenue;

    assert.equal(revenue.earned, 52000, "everything the month made");
    assert.equal(revenue.received, 40000, "only what has actually arrived");
    assert.equal(revenue.pending, 12000, "still waiting on Google");
  });

  test("marking money as arrived moves it across", async () => {
    const entries = await api.get(
      `/api/admin/portfolio/properties/${id}/entries?kind=revenue`,
      T()
    );
    const pending = entries.body.items.find((row) => row.settledOn === null);

    const res = await api.put(
      `/api/admin/portfolio/properties/${id}/entries/${pending._id}`,
      { settledOn: localDay(3) },
      T()
    );
    assert.equal(res.status, 200);

    const after = await api.get(`/api/admin/portfolio/properties/${id}/detail`, T());
    assert.equal(after.body.pnl.revenue.received, 52000);
    assert.equal(after.body.pnl.revenue.pending, 0);
  });

  test("an entry needs an amount above zero, a date and a category", async () => {
    for (const body of [
      { kind: "revenue", category: "admob", amount: 0, on: localDay(1) },
      { kind: "revenue", category: "admob", amount: 100 },
      { kind: "revenue", amount: 100, on: localDay(1) },
    ]) {
      const res = await addEntry(id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });

  test("a payout cannot be slipped in as an ordinary entry", async () => {
    const res = await addEntry(id, {
      kind: "payout",
      category: "partner_payout",
      amount: 500,
      on: localDay(1),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /partners section/i);
  });
});

describe("foreign currency", () => {
  let id;

  before(async () => {
    id = (await makeProperty({ name: "Dollar earner" }))._id;
  });

  test("a foreign amount without a rate is refused rather than counted as rupees", async () => {
    const res = await addEntry(id, {
      kind: "revenue",
      category: "admob",
      amount: 500,
      currency: "USD",
      on: localDay(1),
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /rate you were paid at/i);
  });

  test("with a rate it converts, and the rate is kept with the row", async () => {
    const res = await addEntry(id, {
      kind: "revenue",
      category: "admob",
      amount: 500,
      currency: "USD",
      fxRate: 88.5,
      on: localDay(1),
      settledOn: localDay(1),
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.item.baseAmount, 44250);
    assert.equal(res.body.item.fxRate, 88.5, "kept, so last year's profit is not re-valued today");

    const detail = await api.get(`/api/admin/portfolio/properties/${id}/detail`, T());
    assert.equal(detail.body.pnl.revenue.earned, 44250);
  });
});

describe("ad spend comes from the ads module", () => {
  let propertyId;

  before(async () => {
    const { default: Client } = await import("../models/Client.js");
    const client = await Client.create({ name: "Ourselves", email: "us@example.com" });

    const account = await api.post(
      "/api/admin/ads/accounts",
      { name: "Promoting our app", client: String(client._id), funding: "studio_card" },
      T()
    );
    const campaign = await api.post(
      `/api/admin/ads/accounts/${account.body.item._id}/campaigns`,
      { name: "Installs" },
      T()
    );
    await api.post(
      `/api/admin/ads/accounts/${account.body.item._id}/campaigns/${campaign.body.item._id}/days`,
      { date: localDay(1), spend: 9000, impressions: 100, clicks: 10 },
      T()
    );

    propertyId = (
      await makeProperty({
        name: "Promoted app",
        adAccounts: [account.body.item._id],
      })
    )._id;
  });

  test("spend on a linked account counts as a cost without being typed twice", async () => {
    await addEntry(propertyId, {
      kind: "revenue",
      category: "in_app_purchase",
      amount: 20000,
      on: localDay(1),
      settledOn: localDay(1),
    });

    const res = await api.get(`/api/admin/portfolio/properties/${propertyId}/detail`, T());
    const pnl = res.body.pnl;

    assert.equal(pnl.expenses.linkedAdSpend, 9000);
    assert.equal(pnl.expenses.entered, 0, "nothing was typed by hand");
    assert.equal(pnl.expenses.total, 9000);
    assert.equal(pnl.profit, 11000);
  });
});

describe("partners", () => {
  let property;

  before(async () => {
    property = await makeProperty({
      name: "Joint venture",
      partners: [
        // Takes a slice of the profit, and carries a share of the costs
        { name: "Suresh", sharePercent: 40, sharesCosts: true },
        // Takes a slice off the top and pays nothing towards costs
        { name: "Investor", sharePercent: 10, sharesCosts: false },
      ],
    });

    await addEntry(property._id, {
      kind: "revenue",
      category: "admob",
      amount: 100000,
      on: localDay(1),
      settledOn: localDay(1),
    });
    await addEntry(property._id, {
      kind: "expense",
      category: "ad_spend",
      amount: 20000,
      on: localDay(1),
    });
  });

  test("the two kinds of deal are worked out differently", async () => {
    const res = await api.get(`/api/admin/portfolio/properties/${property._id}/detail`, T());
    const pnl = res.body.pnl;

    assert.equal(pnl.profit, 80000);

    const suresh = pnl.partners.find((p) => p.name === "Suresh");
    const investor = pnl.partners.find((p) => p.name === "Investor");

    assert.equal(suresh.share, 32000, "40% of the 80,000 profit");
    assert.equal(suresh.shareOf, "profit");

    assert.equal(investor.share, 10000, "10% of the 100,000 revenue, costs be damned");
    assert.equal(investor.shareOf, "revenue");
  });

  test("the studio's take is whatever is left, not a stored number", async () => {
    const res = await api.get(`/api/admin/portfolio/properties/${property._id}/detail`, T());
    // 80,000 profit − 32,000 − 10,000
    assert.equal(res.body.pnl.studio.take, 38000);
    assert.equal(res.body.pnl.studio.sharePercent, 50);
  });

  test("paying a partner reduces what they are owed", async () => {
    const detail = await api.get(`/api/admin/portfolio/properties/${property._id}/detail`, T());
    const suresh = detail.body.pnl.partners.find((p) => p.name === "Suresh");
    assert.equal(suresh.owed, 32000);

    const paid = await api.post(
      `/api/admin/portfolio/properties/${property._id}/partners/${suresh._id}/pay`,
      { amount: 20000, reference: "UTR900", on: localDay(2) },
      T()
    );
    assert.equal(paid.status, 201);

    const after = await api.get(`/api/admin/portfolio/properties/${property._id}/detail`, T());
    const updated = after.body.pnl.partners.find((p) => p.name === "Suresh");

    assert.equal(updated.paid, 20000);
    assert.equal(updated.owed, 12000);
  });

  test("a payout does not count as a cost of the business", async () => {
    const res = await api.get(`/api/admin/portfolio/properties/${property._id}/detail`, T());
    assert.equal(res.body.pnl.expenses.total, 20000, "still just the ad spend");
    assert.equal(res.body.pnl.profit, 80000, "paying a partner is dividing profit, not spending it");
  });

  test("payouts are listed with who and when", async () => {
    const res = await api.get(`/api/admin/portfolio/properties/${property._id}/payouts`, T());
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].partnerName, "Suresh");
    assert.equal(res.body.items[0].reference, "UTR900");
  });

  test("paying somebody who is not on the property is refused", async () => {
    const res = await api.post(
      `/api/admin/portfolio/properties/${property._id}/partners/507f1f77bcf86cd799439011/pay`,
      { amount: 100 },
      T()
    );
    assert.equal(res.status, 404);
  });
});

describe("the portfolio view", () => {
  test("it totals every property and names the ones losing money", async () => {
    const sinking = await makeProperty({ name: "Money pit" });
    await addEntry(sinking._id, {
      kind: "revenue",
      category: "admob",
      amount: 3000,
      on: localDay(1),
    });
    await addEntry(sinking._id, {
      kind: "expense",
      category: "ad_spend",
      amount: 15000,
      on: localDay(1),
    });

    const res = await api.get("/api/admin/portfolio", T());
    assert.equal(res.status, 200);

    assert.ok(res.body.properties.length > 0);
    assert.ok(res.body.totals.revenue > 0);
    assert.ok(Array.isArray(res.body.best));

    const losing = res.body.losing.find((row) => row.name === "Money pit");
    assert.ok(losing, "an app spending five times what it makes is named");
    assert.equal(losing.profit, -12000);
  });

  test("a retired property drops out of the view", async () => {
    const gone = await makeProperty({ name: "Dead app", status: "retired" });

    const res = await api.get("/api/admin/portfolio", T());
    assert.ok(!res.body.properties.some((row) => row._id === gone._id));
  });
});

describe("month by month", () => {
  test("the history is what a decision is actually made from", async () => {
    const property = await makeProperty({ name: "Long runner" });

    await addEntry(property._id, {
      kind: "revenue",
      category: "adsense",
      amount: 5000,
      on: localDay(1),
    });

    const res = await api.get(
      `/api/admin/portfolio/properties/${property._id}/history?months=6`,
      T()
    );

    assert.equal(res.status, 200);
    assert.equal(res.body.series.length, 6);
    assert.match(res.body.series[0].month, /^\d{4}-\d{2}$/);

    const thisMonth = res.body.series[res.body.series.length - 1];
    assert.equal(thisMonth.revenue, 5000);
  });
});
