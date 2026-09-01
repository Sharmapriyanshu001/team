import mongoose from "mongoose";

/**
 * One campaign, and one row per day of how it did.
 *
 * The daily rows are embedded, the same way a keyword keeps its rank history:
 * a campaign running for a year is 365 small rows, every screen that shows a
 * campaign wants the whole series, and nobody ever asks a question that spans
 * every client's campaigns on a single day.
 *
 * What is stored is only ever what the platform reported — spend, impressions,
 * clicks, conversions, value. Everything else people talk about (CTR, CPC,
 * CPA, ROAS) is arithmetic on those five, so it is computed on read rather
 * than stored. A stored ratio is a ratio that can disagree with its own
 * numerator after a correction.
 */

export const CAMPAIGN_STATUS = ["draft", "active", "paused", "ended", "rejected"];

export const CAMPAIGN_OBJECTIVES = [
  "awareness",
  "traffic",
  "engagement",
  "leads",
  "app_installs",
  "sales",
  "calls",
  "other",
];

const dailySchema = new mongoose.Schema(
  {
    date: { type: Date, required: true },

    spend: { type: Number, default: 0, min: 0 },
    impressions: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },

    /**
     * Whatever the client counts as a result — a lead, a purchase, a call.
     * What it means is a property of the campaign's objective, not of the
     * number, so it is not split into a column per kind.
     */
    conversions: { type: Number, default: 0, min: 0 },

    /** Revenue attributed to those conversions, where the client tracks it. */
    conversionValue: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const adCampaignSchema = new mongoose.Schema(
  {
    adAccount: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdAccount",
      required: true,
    },

    name: { type: String, required: [true, "A campaign name is required"], trim: true },

    /**
     * The platform's id, when somebody has copied it in. Not required: most of
     * this is reconciled by name, because a name is what a CSV export carries
     * and what a person recognises.
     */
    externalId: { type: String, trim: true, default: "" },

    objective: { type: String, enum: CAMPAIGN_OBJECTIVES, default: "leads" },
    status: { type: String, enum: CAMPAIGN_STATUS, default: "active" },

    dailyBudget: { type: Number, default: 0, min: 0 },
    totalBudget: { type: Number, default: 0, min: 0 },

    startedOn: { type: Date },
    endedOn: { type: Date },

    notes: { type: String, trim: true, default: "" },

    daily: { type: [dailySchema], default: [] },

    /**
     * Sums over the whole series, refreshed whenever a day is written.
     *
     * A list of forty campaigns would otherwise walk forty histories to show a
     * spend column. Recomputed from `daily` rather than incremented, so a
     * corrected day fixes the totals too.
     */
    totalSpend: { type: Number, default: 0 },
    totalImpressions: { type: Number, default: 0 },
    totalClicks: { type: Number, default: 0 },
    totalConversions: { type: Number, default: 0 },
    totalConversionValue: { type: Number, default: 0 },
    lastDataOn: { type: Date },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

/** Rebuild the cached totals from the series. Call before every save. */
adCampaignSchema.methods.refreshTotals = function refreshTotals() {
  const round = (value) => Math.round(value * 100) / 100;

  this.daily.sort((a, b) => new Date(a.date) - new Date(b.date));

  this.totalSpend = round(this.daily.reduce((sum, d) => sum + (d.spend || 0), 0));
  this.totalImpressions = this.daily.reduce((sum, d) => sum + (d.impressions || 0), 0);
  this.totalClicks = this.daily.reduce((sum, d) => sum + (d.clicks || 0), 0);
  this.totalConversions = round(this.daily.reduce((sum, d) => sum + (d.conversions || 0), 0));
  this.totalConversionValue = round(
    this.daily.reduce((sum, d) => sum + (d.conversionValue || 0), 0)
  );
  this.lastDataOn = this.daily.length ? this.daily[this.daily.length - 1].date : null;

  return this;
};

// One campaign name per account — this is what a CSV import reconciles against
adCampaignSchema.index({ adAccount: 1, name: 1 }, { unique: true });
adCampaignSchema.index({ adAccount: 1, status: 1 });

const AdCampaign = mongoose.model("AdCampaign", adCampaignSchema);

export default AdCampaign;
