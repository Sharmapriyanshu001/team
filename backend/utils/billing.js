import mongoose from "mongoose";

/**
 * Line items and what they add up to, shared by quotations and invoices.
 *
 * Shared rather than written twice because the one thing that must never
 * differ between a quote and the invoice that follows it is the arithmetic. A
 * client who is quoted ₹1,18,000 and invoiced ₹1,18,090 will ask why, and the
 * answer must never be "two functions rounded differently".
 */

export const lineItemSchema = new mongoose.Schema(
  {
    // Copied from the rate card at the moment of writing, not referenced.
    // A quote from March must still read correctly after the rate card changes
    // in April — this is a record of what was offered, not a live lookup.
    service: { type: mongoose.Schema.Types.ObjectId, ref: "ServiceItem" },

    description: { type: String, required: true, trim: true },
    hsnSac: { type: String, trim: true, default: "" },

    quantity: { type: Number, default: 1, min: 0 },
    unit: { type: String, trim: true, default: "fixed" },
    rate: { type: Number, default: 0, min: 0 },

    taxPercent: { type: Number, default: 18, min: 0, max: 100 },
  },
  { _id: true }
);

/** Rupees to two places, without the floating-point dust. */
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

/**
 * A GSTIN's first two digits are the state code, which is what decides whether
 * a supply is intra-state (CGST + SGST) or inter-state (IGST). Deriving it
 * beats asking for the state separately: the number is already on file, and a
 * separately typed state is one more thing to disagree with it.
 */
export const stateCodeOf = (gstin, fallback = "") => {
  const digits = String(gstin || "").trim().slice(0, 2);
  if (/^\d{2}$/.test(digits)) return digits;
  const fromFallback = String(fallback || "").trim().slice(0, 2);
  return /^\d{2}$/.test(fromFallback) ? fromFallback : "";
};

/**
 * What the lines come to, with tax split the way the return expects.
 *
 * A discount is spread across the lines in proportion to their value rather
 * than taken off the total, because lines can carry different tax rates —
 * subtracting at the end would tax the discount at whichever rate happened to
 * be last, which is both wrong and hard to spot.
 *
 * `interState` decides the split: IGST if the supply crosses a state line,
 * CGST and SGST at half each if it does not. Same total either way; only the
 * return differs.
 */
export const computeTotals = (lines = [], { discount = 0, interState = false } = {}) => {
  const rows = lines.map((line) => ({
    ...line,
    amount: money((Number(line.quantity) || 0) * (Number(line.rate) || 0)),
  }));

  const subtotal = money(rows.reduce((sum, row) => sum + row.amount, 0));
  const off = Math.min(money(discount), subtotal);

  let taxable = 0;
  let tax = 0;

  rows.forEach((row) => {
    const share = subtotal > 0 ? row.amount / subtotal : 0;
    const lineTaxable = money(row.amount - off * share);
    taxable += lineTaxable;
    tax += money((lineTaxable * (Number(row.taxPercent) || 0)) / 100);
  });

  taxable = money(taxable);
  tax = money(tax);

  const cgst = interState ? 0 : money(tax / 2);
  const sgst = interState ? 0 : money(tax - cgst);
  const igst = interState ? tax : 0;

  const beforeRounding = money(taxable + tax);
  const total = Math.round(beforeRounding);
  const roundOff = money(total - beforeRounding);

  return {
    lines: rows,
    subtotal,
    discount: off,
    taxableValue: taxable,
    cgst,
    sgst,
    igst,
    totalTax: tax,
    roundOff,
    total,
  };
};
