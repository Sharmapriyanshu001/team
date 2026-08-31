import mongoose from "mongoose";

import { lineItemSchema } from "../utils/billing.js";

/**
 * A bill, and what has been paid against it.
 *
 * Payments are embedded. A payment has no meaning apart from the invoice it
 * settles, they arrive in ones and twos rather than thousands, and every
 * screen that shows an invoice wants them — which is three separate reasons
 * not to make them a collection of their own.
 *
 * The status is derived from those payments rather than set by hand, so an
 * invoice can never be marked paid while money is outstanding. See
 * settleStatus() below.
 */

export const INVOICE_STATUS = ["draft", "sent", "partly_paid", "paid", "overdue", "cancelled"];

export const PAYMENT_MODES = ["upi", "bank_transfer", "cash", "cheque", "card", "gateway", "other"];

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    receivedOn: { type: Date, default: Date.now },
    mode: { type: String, enum: PAYMENT_MODES, default: "bank_transfer" },
    // UTR, cheque number, gateway id — whatever proves it arrived
    reference: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    recordedByName: { type: String, trim: true, default: "" },
  },
  { _id: true, timestamps: true }
);

const invoiceSchema = new mongoose.Schema(
  {
    number: { type: String, trim: true, unique: true },

    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: [true, "An invoice has to be addressed to a client"],
    },
    project: { type: mongoose.Schema.Types.ObjectId, ref: "Project" },
    seoProject: { type: mongoose.Schema.Types.ObjectId, ref: "SeoProject" },
    quotation: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation" },

    title: { type: String, trim: true, default: "" },

    /**
     * The client's details as they were when the invoice was raised.
     *
     * Copied, not referenced. An invoice is a legal document about a moment: if
     * the client moves office or corrects their GSTIN next year, last year's
     * invoice must still read the way it was filed.
     */
    billedTo: {
      name: { type: String, trim: true, default: "" },
      company: { type: String, trim: true, default: "" },
      address: { type: String, trim: true, default: "" },
      gstNumber: { type: String, trim: true, default: "" },
      email: { type: String, trim: true, default: "" },
      phone: { type: String, trim: true, default: "" },
    },

    lines: { type: [lineItemSchema], default: [] },
    discount: { type: Number, default: 0, min: 0 },

    subtotal: { type: Number, default: 0 },
    taxableValue: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    interState: { type: Boolean, default: false },

    payments: { type: [paymentSchema], default: [] },
    amountPaid: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },

    status: { type: String, enum: INVOICE_STATUS, default: "draft" },

    issuedOn: { type: Date, default: Date.now },
    dueOn: { type: Date },
    sentAt: { type: Date },
    paidAt: { type: Date },

    /** Set when this is one month of a retainer, so a series can be counted. */
    isRecurring: { type: Boolean, default: false },
    periodLabel: { type: String, trim: true, default: "" },

    terms: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/**
 * Work out where this invoice stands from what has actually been received.
 *
 * Called before every save. Status is therefore never something a person sets
 * to "paid" out of optimism — the only way to reach paid is for the payments
 * to add up, and the only way to leave it is for one to be removed.
 *
 * Draft and cancelled are left alone: neither is a statement about money.
 */
invoiceSchema.methods.settleStatus = function settleStatus(now = new Date()) {
  this.amountPaid = Math.round(
    (this.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0) * 100
  ) / 100;
  this.balance = Math.round((this.total - this.amountPaid) * 100) / 100;

  if (this.status === "draft" || this.status === "cancelled") return this;

  if (this.balance <= 0 && this.total > 0) {
    this.status = "paid";
    this.paidAt = this.paidAt || now;
  } else if (this.amountPaid > 0) {
    this.status = "partly_paid";
    this.paidAt = null;
  } else if (this.dueOn && new Date(this.dueOn) < now) {
    this.status = "overdue";
    this.paidAt = null;
  } else {
    this.status = "sent";
    this.paidAt = null;
  }

  return this;
};

invoiceSchema.index({ client: 1, issuedOn: -1 });
invoiceSchema.index({ status: 1, dueOn: 1 });
invoiceSchema.index({ issuedOn: -1 });

const Invoice = mongoose.model("Invoice", invoiceSchema);

export default Invoice;
