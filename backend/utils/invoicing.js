import Client from "../models/Client.js";
import Invoice from "../models/Invoice.js";
import Setting from "../models/Setting.js";

import { computeTotals, stateCodeOf } from "./billing.js";

/**
 * Raising an invoice, in one place.
 *
 * Two parts of the app now bill clients — the CRM, and the ads module, which
 * charges back spend and a management fee. Both need the same numbering, the
 * same place-of-supply rule and the same arithmetic, and a second copy of any
 * of those is a second thing to be wrong about tax.
 */

/**
 * The Indian financial year a date falls in, as "2025-26".
 *
 * April to March, which is why this is not just the calendar year: an invoice
 * raised in February 2026 belongs to 2025-26, and numbering it 2026-27 would
 * put it in the wrong return.
 */
export const financialYear = (date = new Date()) => {
  const year = date.getFullYear();
  const start = date.getMonth() >= 3 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
};

export const settings = () => Setting.findOne({ key: "general" });

/**
 * The next number in this year's series.
 *
 * Derived from the highest number already issued rather than a counter
 * document, so there is nothing to drift out of step with reality if a record
 * is deleted or restored. Two people saving at the same instant can still land
 * on the same number — the unique index catches that, and saveNumbered
 * retries, which is why this takes an attempt offset.
 */
export const nextNumber = async (Model, prefix, offset = 0) => {
  const year = financialYear();
  const stem = `${prefix}/${year}/`;

  const latest = await Model.findOne({ number: new RegExp(`^${stem}`) })
    .sort({ number: -1 })
    .select("number");

  const current = latest ? parseInt(String(latest.number).split("/").pop(), 10) || 0 : 0;
  return `${stem}${String(current + 1 + offset).padStart(4, "0")}`;
};

/** Save something that carries a generated number, retrying past a clash. */
export const saveNumbered = async (doc, Model, prefix) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    doc.number = await nextNumber(Model, prefix, attempt);
    try {
      await doc.save();
      return doc;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new Error("Could not allocate a number — try again");
};

/**
 * Whether this supply crosses a state line.
 *
 * Both sides come from a GSTIN where there is one. If either side is unknown
 * the answer is "no" — a studio that has not filled in its own GST details is
 * almost certainly billing locally, and CGST+SGST is the guess that is right
 * more often. It is stored on the invoice either way, so a correction later
 * does not rewrite history.
 */
export const crossesState = async (client) => {
  const config = await settings();
  const ours = stateCodeOf(config?.gstNumber, config?.stateCode);
  const theirs = stateCodeOf(client?.gstNumber, client?.stateCode);
  if (!ours || !theirs) return false;
  return ours !== theirs;
};

/** Lines arrive from a form or are built in code; both are normalised here. */
export const readLines = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((line) => line && String(line.description || "").trim())
    .map((line) => ({
      service: line.service || undefined,
      description: String(line.description).trim(),
      hsnSac: line.hsnSac || "",
      quantity: Number(line.quantity) || 0,
      unit: line.unit || "fixed",
      rate: Number(line.rate) || 0,
      taxPercent: line.taxPercent === undefined ? 18 : Number(line.taxPercent),
    }));

/** Write the computed figures onto a quotation or an invoice. */
export const applyTotals = (doc, lines, interState) => {
  const totals = computeTotals(lines, { discount: Number(doc.discount) || 0, interState });

  doc.lines = totals.lines;
  doc.subtotal = totals.subtotal;
  doc.discount = totals.discount;
  doc.taxableValue = totals.taxableValue;
  doc.cgst = totals.cgst;
  doc.sgst = totals.sgst;
  doc.igst = totals.igst;
  doc.totalTax = totals.totalTax;
  doc.roundOff = totals.roundOff;
  doc.total = totals.total;
  doc.interState = interState;

  return doc;
};

/**
 * Build and save an invoice for a client from a set of lines.
 *
 * The client's details are copied onto it rather than referenced, because an
 * invoice is a legal document about a moment: if they move office or correct
 * their GSTIN next year, last year's invoice must still read as filed.
 */
export const raiseInvoice = async ({ clientId, lines, actor, ...fields }) => {
  const client = await Client.findById(clientId);
  if (!client) throw new Error("Client not found");

  const config = await settings();
  const normalised = readLines(lines);
  if (!normalised.length) throw new Error("An invoice needs at least one line");

  const invoice = new Invoice({
    client: client._id,
    billedTo: {
      name: client.name,
      company: client.company,
      address: client.address,
      gstNumber: client.gstNumber,
      email: client.email,
      phone: client.phone,
    },
    terms: fields.terms || config?.invoiceTerms || "",
    createdBy: actor?._id,
    ...fields,
  });

  applyTotals(invoice, normalised, await crossesState(client));
  invoice.settleStatus();

  await saveNumbered(invoice, Invoice, config?.invoicePrefix || "INV");
  return invoice;
};
