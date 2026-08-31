/**
 * The arithmetic the quote and invoice forms show while somebody is typing.
 *
 * A mirror of the server's utils/billing.js, and only a mirror: what gets
 * stored is always what the server computes from the lines that were posted.
 * Two implementations of tax arithmetic is one too many, so this one is only
 * ever allowed to be wrong on screen for a moment.
 *
 * In its own file because a component module that also exports helpers loses
 * fast refresh.
 */

export const BLANK_LINE = {
  description: "",
  hsnSac: "",
  quantity: 1,
  unit: "fixed",
  rate: "",
  taxPercent: 18,
};

export const money = (value) =>
  `₹${(Math.round((Number(value) || 0) * 100) / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

/** Whole rupees, for tables where the paise are noise. */
export const rupees = (value) => `₹${Math.round(Number(value) || 0).toLocaleString("en-IN")}`;

export const previewTotals = (lines, discount = 0, interState = false) => {
  const rows = lines.map((line) => ({
    ...line,
    amount: (Number(line.quantity) || 0) * (Number(line.rate) || 0),
  }));

  const subtotal = rows.reduce((sum, row) => sum + row.amount, 0);
  const off = Math.min(Number(discount) || 0, subtotal);

  let taxable = 0;
  let tax = 0;

  // The discount is spread across the lines in proportion to their value, the
  // same as on the server — lines can carry different tax rates, and taking it
  // off the total would tax the discount at whichever rate came last.
  rows.forEach((row) => {
    const share = subtotal > 0 ? row.amount / subtotal : 0;
    const lineTaxable = row.amount - off * share;
    taxable += lineTaxable;
    tax += (lineTaxable * (Number(row.taxPercent) || 0)) / 100;
  });

  const beforeRounding = taxable + tax;
  const total = Math.round(beforeRounding);

  return {
    rows,
    subtotal,
    discount: off,
    taxable,
    tax,
    cgst: interState ? 0 : tax / 2,
    sgst: interState ? 0 : tax / 2,
    igst: interState ? tax : 0,
    roundOff: total - beforeRounding,
    total,
  };
};
