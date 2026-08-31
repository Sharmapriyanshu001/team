import mongoose from "mongoose";

import { lineItemSchema } from "../utils/billing.js";

/**
 * What was offered, to whom, and whether they said yes.
 *
 * Kept after it is accepted rather than turned into the invoice and thrown
 * away. Two reasons: a client who queries an invoice is querying what they
 * were quoted, and the ratio of quotes sent to quotes won is the only honest
 * measure of whether the pricing is right.
 */

export const QUOTATION_STATUS = ["draft", "sent", "accepted", "rejected", "expired"];

const quotationSchema = new mongoose.Schema(
  {
    number: { type: String, trim: true, unique: true },

    /** A quote goes to a lead before they are a client, and to a client after. */
    lead: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
    client: { type: mongoose.Schema.Types.ObjectId, ref: "Client" },

    title: { type: String, trim: true, default: "" },

    lines: { type: [lineItemSchema], default: [] },

    discount: { type: Number, default: 0, min: 0 },

    /* ------------------------------------------------------- the arithmetic */

    // Stored rather than computed on read: a quote is a statement made on a
    // date, and it must still show the same numbers after a tax rate changes.
    subtotal: { type: Number, default: 0 },
    taxableValue: { type: Number, default: 0 },
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },
    totalTax: { type: Number, default: 0 },
    roundOff: { type: Number, default: 0 },
    total: { type: Number, default: 0 },

    interState: { type: Boolean, default: false },

    status: { type: String, enum: QUOTATION_STATUS, default: "draft" },

    issuedOn: { type: Date, default: Date.now },
    validUntil: { type: Date },

    sentAt: { type: Date },
    respondedAt: { type: Date },

    terms: { type: String, trim: true, default: "" },
    notes: { type: String, trim: true, default: "" },

    /** Set once this quote has been turned into an invoice. */
    invoice: { type: mongoose.Schema.Types.ObjectId, ref: "Invoice" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

quotationSchema.index({ status: 1, createdAt: -1 });
quotationSchema.index({ client: 1 });
quotationSchema.index({ lead: 1 });

const Quotation = mongoose.model("Quotation", quotationSchema);

export default Quotation;
