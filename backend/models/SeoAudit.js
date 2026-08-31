import mongoose from "mongoose";

/**
 * A site audit, and the list of things it found.
 *
 * Issues are embedded because an audit is a single document in every sense
 * that matters: it is produced at one moment, read as a whole, and the issues
 * only mean anything beside the scores they came with. Working through them is
 * a status change on a sub-document, not a record with a life of its own.
 */

export const ISSUE_SEVERITY = ["critical", "high", "medium", "low", "notice"];

export const ISSUE_STATUS = ["open", "in_progress", "fixed", "wont_fix"];

const issueSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    detail: { type: String, trim: true, default: "" },
    // The page it is on, when it is about one page rather than the whole site
    url: { type: String, trim: true, default: "" },
    severity: { type: String, enum: ISSUE_SEVERITY, default: "medium" },
    status: { type: String, enum: ISSUE_STATUS, default: "open" },
    fixedAt: { type: Date },
  },
  { timestamps: true }
);

const seoAuditSchema = new mongoose.Schema(
  {
    seoProject: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "SeoProject",
      required: true,
    },

    title: { type: String, trim: true, default: "" },
    ranOn: { type: Date, default: Date.now },
    url: { type: String, trim: true, default: "" },

    /**
     * Lighthouse's four, out of 100 each. Stored as given rather than averaged
     * into one number, because "the SEO score is 95 and performance is 34" is
     * a sentence somebody can act on and "the score is 64" is not.
     */
    scores: {
      performance: { type: Number, min: 0, max: 100, default: null },
      seo: { type: Number, min: 0, max: 100, default: null },
      accessibility: { type: Number, min: 0, max: 100, default: null },
      bestPractices: { type: Number, min: 0, max: 100, default: null },
    },

    issues: { type: [issueSchema], default: [] },

    summary: { type: String, trim: true, default: "" },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdByName: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

seoAuditSchema.index({ seoProject: 1, ranOn: -1 });

const SeoAudit = mongoose.model("SeoAudit", seoAuditSchema);

export default SeoAudit;
