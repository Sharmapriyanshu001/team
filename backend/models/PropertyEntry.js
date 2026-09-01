import mongoose from "mongoose";

/**
 * One line of a property's books: money earned, money spent, or money paid out
 * to a partner.
 *
 * One model with a `kind` rather than three, because every screen that asks
 * anything about a property asks it of all three at once — a month's profit is
 * revenue minus costs, and a partner's position is their share of that minus
 * what they have already been paid. Three collections would mean three queries
 * to answer one question.
 *
 * ── earned against received ──────────────────────────────────────────────
 * The distinction this model exists for. AdMob reports August's earnings in
 * early September and pays them in late September, once the balance clears
 * $100. So "what did August make" and "what has actually arrived" are
 * different questions with different answers, and a ledger that only knows one
 * of them cannot tell you whether you can afford next month's ad spend.
 *
 * `on` is when it was earned or incurred — the month it belongs to.
 * `settledOn` is when the money actually moved, and is null until it does.
 */

export const ENTRY_KINDS = ["revenue", "expense", "payout"];

export const REVENUE_SOURCES = [
  "admob",
  "adsense",
  "in_app_purchase",
  "subscription",
  "affiliate",
  "sponsorship",
  "direct_sale",
  "other",
];

export const EXPENSE_CATEGORIES = [
  "ad_spend",
  "hosting",
  "domain",
  "tools",
  "freelancer",
  "developer_account",
  "content",
  "assets",
  "other",
];

const propertyEntrySchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },

    kind: { type: String, enum: ENTRY_KINDS, required: true },

    /** A revenue source, an expense category, or "partner_payout". */
    category: { type: String, trim: true, required: true },

    /* ----------------------------------------------------------- the money */

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, uppercase: true, default: "INR" },

    /**
     * What one unit of `currency` was worth in the property's base currency
     * when this was recorded.
     *
     * Stored per entry rather than looked up, and never recalculated. AdMob
     * pays dollars at whatever the rate was on the day it landed; re-valuing
     * last year's earnings at today's rate would quietly rewrite last year's
     * profit every time the rupee moved.
     */
    fxRate: { type: Number, default: 1, min: 0 },

    /** amount × fxRate, so every sum can be done in one currency. */
    baseAmount: { type: Number, required: true, min: 0 },

    /* ------------------------------------------------------------ the dates */

    /** The day, or month, this belongs to. */
    on: { type: Date, required: true },

    /** When the money actually moved. Null means it has not yet. */
    settledOn: { type: Date, default: null },

    /* ----------------------------------------------------------- the detail */

    /** Which partner a payout went to. Only set when kind is "payout". */
    partner: { type: mongoose.Schema.Types.ObjectId },
    partnerName: { type: String, trim: true, default: "" },

    reference: { type: String, trim: true, default: "" },
    note: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

/** Every screen reads a property over a period, in that order. */
propertyEntrySchema.index({ property: 1, on: -1 });
propertyEntrySchema.index({ property: 1, kind: 1, on: -1 });
propertyEntrySchema.index({ kind: 1, settledOn: 1 });

const PropertyEntry = mongoose.model("PropertyEntry", propertyEntrySchema);

export default PropertyEntry;
