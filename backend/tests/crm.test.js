import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";

import { startHarness, signIn } from "./helpers/harness.js";

let api;
let stop;
let admin;
let clientId;

const T = () => ({ token: admin.token });

/** A client in Rajasthan (state code 08), which is where the studio also is. */
const LOCAL_GSTIN = "08ABCDE1234F1Z5";
/** Maharashtra (27) — a different state, so IGST. */
const FAR_GSTIN = "27ABCDE1234F1Z5";

before(async () => {
  ({ api, stop } = await startHarness({ port: 5905 }));
  admin = await signIn(api, { role: "admin", name: "Billing Admin" });

  // The studio's own GST details decide the tax split on every invoice
  await api.put(
    "/api/admin/settings",
    { gstNumber: LOCAL_GSTIN, invoicePrefix: "INV", quotationPrefix: "QT" },
    T()
  );

  const { default: Client } = await import("../models/Client.js");
  const client = await Client.create({
    name: "Acme Ltd",
    company: "Acme Ltd",
    email: "acme@example.com",
    gstNumber: LOCAL_GSTIN,
    address: "Jaipur",
  });
  clientId = String(client._id);
});

after(async () => {
  await stop();
});

const LINES = [
  { description: "Website build", quantity: 1, rate: 50000, taxPercent: 18 },
  { description: "SEO retainer", quantity: 3, rate: 10000, taxPercent: 18 },
];

describe("leads", () => {
  test("winning and losing stamp their dates, and reopening clears them", async () => {
    const made = await api.post(
      "/api/admin/crm/leads",
      { name: "Ravi", company: "Ravi Traders", source: "referral", estimatedValue: 80000 },
      T()
    );
    assert.equal(made.status, 201);

    const won = await api.put(`/api/admin/crm/leads/${made.body.item._id}`, { stage: "won" }, T());
    assert.ok(won.body.item.wonAt);

    const back = await api.put(
      `/api/admin/crm/leads/${made.body.item._id}`,
      { stage: "negotiating" },
      T()
    );
    assert.equal(back.body.item.wonAt, null, "a reopened lead must not still count as won");
    assert.equal(back.body.item.lostAt, null);
  });

  test("logging a call adds a note and sets the next follow-up in one go", async () => {
    const made = await api.post("/api/admin/crm/leads", { name: "Sunita" }, T());

    const noted = await api.post(
      `/api/admin/crm/leads/${made.body.item._id}/notes`,
      { body: "Asked for a quote by Friday", followUpOn: "2026-09-05", stage: "qualified" },
      T()
    );
    assert.equal(noted.status, 200);
    assert.equal(noted.body.item.notes.length, 1);
    assert.equal(noted.body.item.notes[0].byName, "Billing Admin");
    assert.equal(noted.body.item.stage, "qualified");
    assert.ok(noted.body.item.followUpOn);
  });

  test("an empty note is refused", async () => {
    const made = await api.post("/api/admin/crm/leads", { name: "Blank" }, T());
    const res = await api.post(
      `/api/admin/crm/leads/${made.body.item._id}/notes`,
      { body: "   " },
      T()
    );
    assert.equal(res.status, 400);
  });

  test("converting produces a client and keeps the lead as history", async () => {
    const made = await api.post(
      "/api/admin/crm/leads",
      { name: "Vikram", company: "VK Foods", email: "vk@example.com", phone: "9876543210" },
      T()
    );

    const res = await api.post(`/api/admin/crm/leads/${made.body.item._id}/convert`, {}, T());
    assert.equal(res.status, 201);
    assert.equal(res.body.client.name, "Vikram");
    assert.equal(res.body.client.portalAccess, true, "a phone number becomes the portal password");
    assert.equal(res.body.lead.stage, "won");
    assert.ok(res.body.lead.convertedClient, "the lead is kept and linked, not deleted");

    const again = await api.post(`/api/admin/crm/leads/${made.body.item._id}/convert`, {}, T());
    assert.equal(again.status, 409, "converting twice would make a duplicate client");
  });

  test("converting without an email is refused", async () => {
    const made = await api.post("/api/admin/crm/leads", { name: "No Email" }, T());
    const res = await api.post(`/api/admin/crm/leads/${made.body.item._id}/convert`, {}, T());
    assert.equal(res.status, 400);
  });

  test("the pipeline counts by stage and flags what is overdue", async () => {
    await api.post(
      "/api/admin/crm/leads",
      { name: "Forgotten", stage: "contacted", followUpOn: "2020-01-01", estimatedValue: 5000 },
      T()
    );

    const res = await api.get("/api/admin/crm/pipeline", T());
    assert.equal(res.status, 200);
    assert.ok(res.body.stages.contacted.count >= 1);
    assert.ok(res.body.overdue >= 1, "a follow-up date in 2020 is overdue");
  });
});

describe("quotations", () => {
  test("a quote is numbered by financial year and taxed intra-state", async () => {
    const res = await api.post(
      "/api/admin/crm/quotations",
      { client: clientId, title: "Website + SEO", lines: LINES },
      T()
    );
    assert.equal(res.status, 201);

    const quote = res.body.item;
    assert.match(quote.number, /^QT\/\d{4}-\d{2}\/0001$/, quote.number);
    assert.equal(quote.subtotal, 80000);
    assert.equal(quote.cgst, 7200);
    assert.equal(quote.sgst, 7200);
    assert.equal(quote.igst, 0, "same state, so no IGST");
    assert.equal(quote.total, 94400);
  });

  test("numbers keep climbing", async () => {
    const res = await api.post(
      "/api/admin/crm/quotations",
      { client: clientId, lines: LINES },
      T()
    );
    assert.match(res.body.item.number, /0002$/);
  });

  test("a quote with no lines is refused", async () => {
    const res = await api.post("/api/admin/crm/quotations", { client: clientId, lines: [] }, T());
    assert.equal(res.status, 400);
  });

  test("a quote to a client in another state is taxed IGST", async () => {
    const { default: Client } = await import("../models/Client.js");
    const far = await Client.create({
      name: "Mumbai Co",
      email: "mumbai@example.com",
      gstNumber: FAR_GSTIN,
    });

    const res = await api.post(
      "/api/admin/crm/quotations",
      { client: String(far._id), lines: LINES },
      T()
    );
    assert.equal(res.body.item.igst, 14400);
    assert.equal(res.body.item.cgst, 0);
    assert.equal(res.body.item.sgst, 0);
    assert.equal(res.body.item.total, 94400, "the client pays the same either way");
  });
});

describe("invoices", () => {
  let invoiceId;

  test("an invoice copies the client's details as they are today", async () => {
    const res = await api.post(
      "/api/admin/crm/invoices",
      { client: clientId, title: "March work", lines: LINES, status: "sent", dueOn: "2030-01-01" },
      T()
    );
    assert.equal(res.status, 201);

    const invoice = res.body.item;
    invoiceId = invoice._id;

    assert.match(invoice.number, /^INV\/\d{4}-\d{2}\/0001$/);
    assert.equal(invoice.billedTo.company, "Acme Ltd");
    assert.equal(invoice.billedTo.gstNumber, LOCAL_GSTIN);
    assert.equal(invoice.total, 94400);
    assert.equal(invoice.balance, 94400);
    assert.equal(invoice.status, "sent");
  });

  test("a payment moves it to partly paid, and settling moves it to paid", async () => {
    const part = await api.post(
      `/api/admin/crm/invoices/${invoiceId}/payments`,
      { amount: 40000, mode: "upi", reference: "UTR123" },
      T()
    );
    assert.equal(part.status, 200);
    assert.equal(part.body.item.status, "partly_paid");
    assert.equal(part.body.item.balance, 54400);

    const rest = await api.post(
      `/api/admin/crm/invoices/${invoiceId}/payments`,
      { amount: 54400, mode: "bank_transfer" },
      T()
    );
    assert.equal(rest.body.item.status, "paid");
    assert.equal(rest.body.item.balance, 0);
    assert.ok(rest.body.item.paidAt);
  });

  test("removing a payment puts it back to unpaid", async () => {
    const invoice = await api.get(`/api/admin/crm/invoices/${invoiceId}`, T());
    const payment = invoice.body.item.payments[0];

    const res = await api.del(
      `/api/admin/crm/invoices/${invoiceId}/payments/${payment._id}`,
      T()
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.item.status, "partly_paid");
    assert.equal(res.body.item.paidAt, null, "it is no longer paid, so the date goes");
  });

  test("overpaying is refused rather than silently accepted", async () => {
    const res = await api.post(
      `/api/admin/crm/invoices/${invoiceId}/payments`,
      { amount: 999999 },
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /more than/i);
  });

  test("an issued invoice cannot have its figures changed", async () => {
    const res = await api.put(
      `/api/admin/crm/invoices/${invoiceId}`,
      { lines: [{ description: "Cheaper", quantity: 1, rate: 1 }] },
      T()
    );
    assert.equal(res.status, 409);
    assert.match(res.body.message, /cancel it and raise a new one/i);
  });

  test("but a draft can", async () => {
    const draft = await api.post(
      "/api/admin/crm/invoices",
      { client: clientId, lines: LINES, status: "draft" },
      T()
    );
    assert.equal(draft.body.item.total, 94400);

    const changed = await api.put(
      `/api/admin/crm/invoices/${draft.body.item._id}`,
      { lines: [{ description: "Just the site", quantity: 1, rate: 50000, taxPercent: 18 }] },
      T()
    );
    assert.equal(changed.status, 200);
    assert.equal(changed.body.item.total, 59000);
  });

  test("a payment against a draft is refused — it has not been sent to anybody", async () => {
    const draft = await api.post(
      "/api/admin/crm/invoices",
      { client: clientId, lines: LINES, status: "draft" },
      T()
    );

    const res = await api.post(
      `/api/admin/crm/invoices/${draft.body.item._id}/payments`,
      { amount: 100 },
      T()
    );
    assert.equal(res.status, 409);
  });

  test("receivables add up what is owed and what came in", async () => {
    const res = await api.get("/api/admin/crm/receivables", T());
    assert.equal(res.status, 200);
    assert.match(res.body.financialYear, /^\d{4}-\d{2}$/);
    assert.ok(res.body.outstanding.amount > 0);
    assert.ok(res.body.receivedThisMonth > 0);
    assert.ok(res.body.drafts >= 1);
  });
});

describe("quote to invoice", () => {
  test("the quote's lines carry across and the quote locks", async () => {
    const quote = await api.post(
      "/api/admin/crm/quotations",
      { client: clientId, title: "Rebuild", lines: LINES, discount: 5000 },
      T()
    );

    const res = await api.post(
      `/api/admin/crm/quotations/${quote.body.item._id}/invoice`,
      { dueOn: "2030-06-01" },
      T()
    );
    assert.equal(res.status, 201);
    assert.equal(res.body.item.total, quote.body.item.total, "billed exactly what was accepted");
    assert.equal(res.body.item.lines.length, 2);

    const after = await api.get(`/api/admin/crm/quotations/${quote.body.item._id}`, T());
    assert.equal(after.body.item.status, "accepted");
    assert.ok(after.body.item.invoice);

    const twice = await api.post(
      `/api/admin/crm/quotations/${quote.body.item._id}/invoice`,
      {},
      T()
    );
    assert.equal(twice.status, 409, "one quote, one invoice");

    const edit = await api.put(
      `/api/admin/crm/quotations/${quote.body.item._id}`,
      { title: "Changed my mind" },
      T()
    );
    assert.equal(edit.status, 409, "an invoiced quote is a record, not a draft");
  });

  test("a quote to a lead cannot be invoiced until the lead is a client", async () => {
    const lead = await api.post("/api/admin/crm/leads", { name: "Maybe Co" }, T());
    const quote = await api.post(
      "/api/admin/crm/quotations",
      { lead: lead.body.item._id, lines: LINES },
      T()
    );
    assert.equal(quote.status, 201);

    const res = await api.post(
      `/api/admin/crm/quotations/${quote.body.item._id}/invoice`,
      {},
      T()
    );
    assert.equal(res.status, 400);
    assert.match(res.body.message, /convert the lead/i);
  });
});
